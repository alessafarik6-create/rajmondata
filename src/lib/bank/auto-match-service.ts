import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { bankConnectionsCol, bankTransactionsCol } from "@/lib/bank/collections";
import { applyBankTransactionMatch } from "@/lib/bank/apply-match";
import type { BankAutomationSettings } from "@/lib/bank/types";
import {
  findDeterministicIssuedInvoiceMatch,
  invoiceListFromFirestoreDocs,
} from "@/lib/bank/deterministic-auto-match";
import { appendBankAutomationLog } from "@/lib/bank/automation-log";
import { writeBankAuditLog } from "@/lib/bank/audit";
import {
  buildPaymentConfirmationDraft,
  isVerifiedCustomerInvoiceEmail,
  sendPaymentConfirmationForMatch,
} from "@/lib/bank/payment-confirmation";
import { automationSettingsFromConnection, computeNextScheduledSyncAt } from "@/lib/bank/automation-settings";
import { loadBankConnection } from "@/lib/bank/connection-store";

export type AutoMatchRunResult = {
  processed: number;
  autoMatched: number;
  confirmationsSent: number;
};

async function loadIssuedInvoices(db: Firestore, organizationId: string) {
  const snap = await db
    .collection("companies")
    .doc(organizationId)
    .collection("invoices")
    .limit(400)
    .get();
  return invoiceListFromFirestoreDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })));
}

export async function runDeterministicAutoMatchForOrganization(
  db: Firestore,
  organizationId: string,
  actorUserId: string,
  opts?: {
    transactionIds?: string[];
    settings?: BankAutomationSettings;
    importedCount?: number;
  }
): Promise<AutoMatchRunResult> {
  const conn = await loadBankConnection(db, organizationId);
  const settings = opts?.settings ?? automationSettingsFromConnection(conn);
  if (!settings.autoMatchEnabled) {
    return { processed: 0, autoMatched: 0, confirmationsSent: 0 };
  }

  const todayIso = new Date().toISOString().split("T")[0];
  const invoices = await loadIssuedInvoices(db, organizationId);
  let processed = 0;
  let autoMatched = 0;
  let confirmationsSent = 0;

  const companySnap = await db.collection("companies").doc(organizationId).get();
  const companyName = String(
    companySnap.data()?.name ?? companySnap.data()?.companyName ?? ""
  ).trim();

  const txDocs: DocumentSnapshot[] = [];

  if (opts?.transactionIds?.length) {
    for (const id of opts.transactionIds.slice(0, 100)) {
      const snap = await bankTransactionsCol(db, organizationId).doc(id).get();
      if (snap.exists) txDocs.push(snap);
    }
  } else {
    const snap = await bankTransactionsCol(db, organizationId)
      .where("classification", "==", "unmatched")
      .orderBy("bookingDate", "desc")
      .limit(80)
      .get()
      .catch(() => null);
    if (snap) txDocs.push(...snap.docs);
  }

  for (const tDoc of txDocs) {
    const t = tDoc.data();
    if (!t) continue;
    if (t.direction !== "incoming") continue;
    if (Number(t.matchedAmountTotal ?? 0) > 0.009) continue;
    processed += 1;

    const match = findDeterministicIssuedInvoiceMatch(
      {
        direction: "incoming",
        amount: Number(t.amount),
        currency: String(t.currency ?? "CZK"),
        variableSymbol: t.variableSymbol as string | null,
        counterpartyName: t.counterpartyName as string | null,
        counterpartyAccount: t.counterpartyAccount as string | null,
        bookingDate: String(t.bookingDate),
        message: t.message as string | null,
        reference: t.reference as string | null,
      },
      invoices,
      todayIso
    );

    if (!match) continue;

    try {
      const { matchId } = await applyBankTransactionMatch(db, {
        organizationId,
        transactionId: tDoc.id,
        userId: actorUserId,
        matchedAmount: match.matchedAmount,
        matchType: "auto",
        confidence: null,
        issuedInvoiceId: match.invoiceId,
      });
      autoMatched += 1;

      await writeBankAuditLog(db, {
        organizationId,
        userId: actorUserId,
        action: "BANK_AUTO_MATCH_APPLIED",
        entityId: tDoc.id,
        metadata: {
          matchId,
          invoiceId: match.invoiceId,
          reasons: match.reasons,
          isFullPayment: match.isFullPayment,
        },
      });

      const invSnap = await db
        .collection("companies")
        .doc(organizationId)
        .collection("invoices")
        .doc(match.invoiceId)
        .get();
      const inv = invSnap.data() as Record<string, unknown> | undefined;
      const customerEmail = isVerifiedCustomerInvoiceEmail(inv?.customerEmail);

      const mayAutoEmail =
        settings.autoPaymentConfirmationEnabled &&
        customerEmail &&
        settings.paymentConfirmationEmailAccountId &&
        (match.isFullPayment || settings.autoPartialPaymentConfirmation);

      if (mayAutoEmail) {
        const draft = buildPaymentConfirmationDraft({
          organizationName: companyName,
          invoiceNumber: match.invoiceNumber,
          customerName: String(inv?.customerName ?? ""),
          customerEmail,
          amount: match.matchedAmount,
          currency: String(t.currency ?? "CZK"),
          paidAtIso: String(t.bookingDate),
          isFullPayment: match.isFullPayment,
        });
        const sendResult = await sendPaymentConfirmationForMatch(db, {
          organizationId,
          matchId,
          emailAccountId: settings.paymentConfirmationEmailAccountId!,
          actorUserId,
          draft,
        });
        if (sendResult.sent) confirmationsSent += 1;
      }
    } catch (e) {
      await appendBankAutomationLog(db, {
        organizationId,
        kind: "auto_match",
        success: false,
        message: e instanceof Error ? e.message : "Auto párování selhalo.",
        metadata: { transactionId: tDoc.id },
      });
    }
  }

  const pendingSnap = await bankTransactionsCol(db, organizationId)
    .where("classification", "==", "unmatched")
    .limit(500)
    .get()
    .catch(() => null);
  const pendingReviewCount = pendingSnap?.size ?? 0;

  const prevStats = conn?.automationStats ?? {};
  const prevConfirmTotal = Number(prevStats.confirmationsSentTotal ?? 0);

  await bankConnectionsCol(db, organizationId).doc(conn?.id ?? "raiffeisen").set(
    {
      automationStats: {
        ...prevStats,
        lastAutoMatchAt: new Date().toISOString(),
        lastRunImported: opts?.importedCount ?? prevStats.lastRunImported ?? 0,
        lastRunAutoMatched: autoMatched,
        pendingReviewCount,
        confirmationsSentTotal: prevConfirmTotal + confirmationsSent,
        lastConfirmationSentAt:
          confirmationsSent > 0
            ? new Date().toISOString()
            : prevStats.lastConfirmationSentAt ?? null,
        nextScheduledSyncAt: computeNextScheduledSyncAt(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await appendBankAutomationLog(db, {
    organizationId,
    kind: "auto_match",
    success: true,
    message: `Automaticky spárováno ${autoMatched} z ${processed} zkontrolovaných transakcí.`,
    metadata: { processed, autoMatched, confirmationsSent },
  });

  return { processed, autoMatched, confirmationsSent };
}
