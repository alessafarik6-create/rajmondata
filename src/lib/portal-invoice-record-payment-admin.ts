/**
 * Server: záznam úhrady vystavené faktury (Admin SDK).
 */

import type { Firestore as AdminFirestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  getPortalInvoicePaymentState,
  portalInvoiceTotalAmountGross,
} from "@/lib/invoice-payment-state";
import { roundMoney2 } from "@/lib/vat-calculations";
import {
  isIssuedInvoiceEligibleForQuickPay,
  type InvoicePaymentMethod,
} from "@/lib/portal-invoice-payment-eligibility";

export type { InvoicePaymentMethod } from "@/lib/portal-invoice-payment-eligibility";

export type RecordPortalInvoicePaymentInput = {
  organizationId: string;
  invoiceId: string;
  userId: string;
  amount: number;
  paidAt: string;
  method: InvoicePaymentMethod;
  note?: string | null;
};

export type RecordPortalInvoicePaymentResult = {
  paymentId: string;
  amount: number;
  paidAmountTotal: number;
  remainingAmount: number;
  status: "paid" | "partially_paid";
};

async function syncMirrorDocumentsAdmin(
  db: AdminFirestore,
  organizationId: string,
  invoiceId: string,
  invoiceAfter: Record<string, unknown>
): Promise<void> {
  const gross = portalInvoiceTotalAmountGross(invoiceAfter);
  const paid = Number(
    invoiceAfter.paidAmount ?? invoiceAfter.paidGrossReceived ?? 0
  );
  const status = String(invoiceAfter.status ?? "").trim().toLowerCase();
  const ps = String(invoiceAfter.paymentStatus ?? "").trim().toLowerCase();
  const fullyPaid =
    status === "paid" ||
    ps === "paid" ||
    (gross > 0 && paid >= gross - 0.009);

  const docsSnap = await db
    .collection("companies")
    .doc(organizationId)
    .collection("documents")
    .where("sourceInvoiceId", "==", invoiceId)
    .limit(12)
    .get();

  for (const d of docsSnap.docs) {
    const data = d.data();
    if (data.isDeleted === true) continue;
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (fullyPaid) {
      patch.paymentStatus = "paid";
      patch.paidAmount = gross > 0 ? gross : paid;
      patch.paid = true;
      patch.paidAt =
        String(invoiceAfter.paidAt ?? "").trim() ||
        new Date().toISOString().split("T")[0];
      patch.paymentMethod = invoiceAfter.lastPaymentMethod ?? null;
      patch.paymentNote = invoiceAfter.lastPaymentNote ?? null;
    } else if (paid > 0) {
      patch.paymentStatus = "partial";
      patch.paidAmount = paid;
      patch.paid = false;
    } else {
      patch.paymentStatus = "unpaid";
      patch.paidAmount = null;
      patch.paid = false;
      patch.paidAt = null;
    }
    await d.ref.update(patch);
  }
}

export async function recordPortalInvoicePaymentAdmin(
  db: AdminFirestore,
  input: RecordPortalInvoicePaymentInput
): Promise<RecordPortalInvoicePaymentResult> {
  const organizationId = String(input.organizationId ?? "").trim();
  const invoiceId = String(input.invoiceId ?? "").trim();
  const userId = String(input.userId ?? "").trim();
  if (!organizationId || !invoiceId || !userId) {
    throw new Error("Chybí organizace, faktura nebo uživatel.");
  }

  const paidAt = String(input.paidAt ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    throw new Error("Neplatné datum úhrady.");
  }

  const amount = roundMoney2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Částka platby musí být větší než 0.");
  }

  const invRef = db
    .collection("companies")
    .doc(organizationId)
    .collection("invoices")
    .doc(invoiceId);

  const invSnap = await invRef.get();
  if (!invSnap.exists) {
    throw new Error("Faktura nebyla nalezena.");
  }
  const invData = invSnap.data() as Record<string, unknown>;
  if (invData.isDeleted === true) {
    throw new Error("Faktura je v koši.");
  }
  if (!isIssuedInvoiceEligibleForQuickPay({ ...invData, id: invoiceId }, paidAt)) {
    throw new Error("Tuto fakturu nelze označit jako uhrazenou.");
  }

  const before = getPortalInvoicePaymentState({ ...invData, id: invoiceId }, paidAt);
  if (before.remainingAmount <= 0.009) {
    throw new Error("Faktura je již uhrazena.");
  }
  if (amount > before.remainingAmount + 0.01) {
    throw new Error("Částka platby překračuje zbývající zůstatek.");
  }

  const paymentRef = invRef.collection("payments").doc();
  const newPaid = roundMoney2(before.paidAmount + amount);
  const total = before.totalAmount;
  const remaining = Math.max(0, roundMoney2(total - newPaid));
  const fullyPaid = total > 0 && remaining <= 0.009;
  const nextStatus = fullyPaid ? "paid" : "partially_paid";
  const nextPaymentStatus = fullyPaid ? "paid" : "partial";

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists) throw new Error("Faktura nebyla nalezena.");
    tx.set(paymentRef, {
      organizationId,
      companyId: organizationId,
      invoiceId,
      amount,
      paidAt,
      method: input.method,
      note: input.note?.trim() ? String(input.note).trim().slice(0, 500) : null,
      createdBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      kind: fullyPaid ? "full_settlement" : "partial",
    });
    tx.update(invRef, {
      paidAmount: newPaid,
      paidGrossReceived: newPaid,
      paymentStatus: nextPaymentStatus,
      status: nextStatus,
      paidAt,
      lastPaymentMethod: input.method,
      lastPaymentNote: input.note?.trim() ? String(input.note).trim().slice(0, 500) : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const invoiceAfter = {
    ...invData,
    paidAmount: newPaid,
    paidGrossReceived: newPaid,
    paymentStatus: nextPaymentStatus,
    status: nextStatus,
    paidAt,
    lastPaymentMethod: input.method,
    lastPaymentNote: input.note?.trim() ?? null,
  };
  await syncMirrorDocumentsAdmin(db, organizationId, invoiceId, invoiceAfter);

  await db.collection("companies").doc(organizationId).collection("activityLogs").add({
    organizationId,
    companyId: organizationId,
    userId,
    createdBy: userId,
    actionType: "INVOICE_MARKED_PAID",
    actionLabel: "Úhrada vystavené faktury",
    entityType: "invoice",
    entityId: invoiceId,
    entityName: String(
      invData.invoiceNumber ?? invData.documentNumber ?? invoiceId
    ).slice(0, 500),
    sourceModule: "documents",
    route: "/portal/documents?view=issued",
    metadata: {
      paymentId: paymentRef.id,
      amount,
      paidAt,
      method: input.method,
      paidAmountTotal: newPaid,
      remainingAmount: remaining,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    paymentId: paymentRef.id,
    amount,
    paidAmountTotal: newPaid,
    remainingAmount: remaining,
    status: nextStatus,
  };
}
