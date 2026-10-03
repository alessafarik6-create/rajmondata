import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  bankMatchesCol,
  bankTransactionsCol,
} from "@/lib/bank/collections";
import { recordPortalInvoicePaymentAdmin } from "@/lib/portal-invoice-record-payment-admin";
import {
  getDocumentPaymentState,
  getPortalInvoicePaymentState,
} from "@/lib/invoice-payment-state";
import { roundMoney2 } from "@/lib/vat-calculations";
import type { BankMatchType } from "@/lib/bank/types";
import { writeBankAuditLog } from "@/lib/bank/audit";
import { recomputeTransactionMatchTotals } from "@/lib/bank/match-totals";

export type ApplyBankMatchInput = {
  organizationId: string;
  transactionId: string;
  userId: string;
  matchedAmount: number;
  matchType: BankMatchType;
  confidence?: number | null;
  issuedInvoiceId?: string | null;
  receivedDocumentId?: string | null;
};

async function applyReceivedDocumentPayment(
  db: Firestore,
  organizationId: string,
  documentId: string,
  amount: number,
  paidAt: string
): Promise<void> {
  const docRef = db.collection("companies").doc(organizationId).collection("documents").doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error("Doklad nebyl nalezen.");
  const data = snap.data() as Record<string, unknown>;
  if (data.isDeleted === true) throw new Error("Doklad je v koši.");

  const before = getDocumentPaymentState(data, paidAt);
  if (before.remainingAmount <= 0.009) throw new Error("Doklad je již uhrazen.");
  if (amount > before.remainingAmount + 0.01) {
    throw new Error("Částka překračuje zbývající zůstatek dokladu.");
  }

  const newPaid = roundMoney2(before.paidAmount + amount);
  const total = before.totalAmount;
  const remaining = Math.max(0, roundMoney2(total - newPaid));
  const fullyPaid = total > 0 && remaining <= 0.009;

  await docRef.update({
    paidAmount: newPaid,
    paymentStatus: fullyPaid ? "paid" : "partial",
    paid: fullyPaid,
    paidAt: fullyPaid ? paidAt : data.paidAt ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function applyBankTransactionMatch(
  db: Firestore,
  input: ApplyBankMatchInput
): Promise<{ matchId: string }> {
  const organizationId = String(input.organizationId ?? "").trim();
  const transactionId = String(input.transactionId ?? "").trim();
  const amount = roundMoney2(Number(input.matchedAmount));
  if (!organizationId || !transactionId || amount <= 0) {
    throw new Error("Neplatná platba nebo transakce.");
  }

  const txnRef = bankTransactionsCol(db, organizationId).doc(transactionId);
  const txnSnap = await txnRef.get();
  if (!txnSnap.exists) throw new Error("Transakce nebyla nalezena.");
  const txn = txnSnap.data() as Record<string, unknown>;
  if (String(txn.organizationId) !== organizationId) throw new Error("Neplatná organizace.");

  const bookingDate = String(txn.bookingDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    throw new Error("Neplatné datum transakce.");
  }

  const txnAmount = Math.abs(roundMoney2(Number(txn.amount)));
  const already = roundMoney2(Number(txn.matchedAmountTotal ?? 0));
  if (already + amount > txnAmount + 0.01) {
    throw new Error("Součet párování překračuje částku transakce.");
  }

  const invoiceId = String(input.issuedInvoiceId ?? "").trim() || null;
  const documentId = String(input.receivedDocumentId ?? "").trim() || null;
  if (!invoiceId && !documentId) throw new Error("Chybí cíl párování.");
  if (invoiceId && documentId) throw new Error("Zadejte pouze fakturu nebo doklad.");

  if (invoiceId) {
    await recordPortalInvoicePaymentAdmin(db, {
      organizationId,
      invoiceId,
      userId: input.userId,
      amount,
      paidAt: bookingDate,
      method: "bank",
      note: `Bankovní transakce ${transactionId}`,
    });
  } else if (documentId) {
    await applyReceivedDocumentPayment(db, organizationId, documentId, amount, bookingDate);
  }

  const matchRef = bankMatchesCol(db, organizationId).doc();
  await matchRef.set({
    organizationId,
    transactionId,
    invoiceId,
    documentId,
    matchedAmount: amount,
    matchedBy: input.userId,
    matchedAt: new Date().toISOString(),
    matchType: input.matchType,
    confidence: input.confidence ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await recomputeTransactionMatchTotals(db, organizationId, transactionId);

  const invLabel = invoiceId ? `faktura ${invoiceId}` : `doklad ${documentId}`;
  await writeBankAuditLog(db, {
    organizationId,
    userId: input.userId,
    action: "BANK_TRANSACTION_MATCHED",
    entityId: transactionId,
    metadata: {
      matchId: matchRef.id,
      matchedAmount: amount,
      target: invLabel,
      matchType: input.matchType,
    },
  });

  return { matchId: matchRef.id };
}

export async function removeBankTransactionMatch(
  db: Firestore,
  organizationId: string,
  matchId: string,
  userId: string
): Promise<void> {
  const matchRef = bankMatchesCol(db, organizationId).doc(matchId);
  const snap = await matchRef.get();
  if (!snap.exists) throw new Error("Párování nebylo nalezeno.");
  const data = snap.data() as Record<string, unknown>;
  const transactionId = String(data.transactionId ?? "");
  await matchRef.delete();
  if (transactionId) {
    await recomputeTransactionMatchTotals(db, organizationId, transactionId);
  }
  await writeBankAuditLog(db, {
    organizationId,
    userId,
    action: "BANK_TRANSACTION_UNMATCHED",
    entityId: transactionId || matchId,
    metadata: { matchId },
  });
}

/** Přepočet matchedAmountTotal na transakci (bez reverze faktury — ruční úprava stavu faktury zůstává na účetním). */
export async function previewInvoiceRemaining(
  db: Firestore,
  organizationId: string,
  invoiceId: string,
  todayIso: string
): Promise<number> {
  const invSnap = await db
    .collection("companies")
    .doc(organizationId)
    .collection("invoices")
    .doc(invoiceId)
    .get();
  if (!invSnap.exists) return 0;
  const state = getPortalInvoicePaymentState(invSnap.data() as Record<string, unknown>, todayIso);
  return state.remainingAmount;
}
