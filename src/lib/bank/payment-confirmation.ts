import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { sendEmailFromAccount } from "@/lib/email-mailbox/send-service";
import { bankMatchesCol } from "@/lib/bank/collections";
import { writeBankAuditLog } from "@/lib/bank/audit";
import { appendBankAutomationLog } from "@/lib/bank/automation-log";
import { formatBankMoneyCs } from "@/lib/bank/payment-confirmation-format";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function isVerifiedCustomerInvoiceEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}

export type PaymentConfirmationDraft = {
  to: string;
  customerName: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  invoiceNumber: string;
  amountFormatted: string;
  paidAtFormatted: string;
  organizationName: string;
};

export function buildPaymentConfirmationDraft(input: {
  organizationName: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  paidAtIso: string;
  isFullPayment: boolean;
}): PaymentConfirmationDraft {
  const paidAtFormatted = formatPaidDateCs(input.paidAtIso);
  const amountFormatted = formatBankMoneyCs(input.amount, input.currency);
  const inv = input.invoiceNumber.trim();
  const org = input.organizationName.trim() || "Vaše firma";
  const greetingName = input.customerName.trim() || "vážený zákazníku";

  const subject = `Potvrzení přijetí platby – faktura ${inv}`;

  const paidLine = input.isFullPayment
    ? "Platba byla úspěšně přiřazena k Vaší faktuře a evidujeme ji jako uhrazenou."
    : "Platba byla přiřazena k Vaší faktuře. Faktura zatím není plně uhrazena — zbývá doplatit rozdíl.";

  const textBody = `Dobrý den${greetingName !== "vážený zákazníku" ? `, ${greetingName}` : ""},

potvrzujeme, že jsme dne ${paidAtFormatted} přijali Vaši platbu ve výši ${amountFormatted} k faktuře ${inv}.

${paidLine}

Děkujeme za úhradu a spolupráci.

S pozdravem

${org}

RAJMONDATA – firemní portál`;

  const htmlBody = textBody
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return {
    to: input.customerEmail,
    customerName: greetingName,
    subject,
    textBody,
    htmlBody,
    invoiceNumber: inv,
    amountFormatted,
    paidAtFormatted,
    organizationName: org,
  };
}

function formatPaidDateCs(isoDate: string): string {
  const d = isoDate.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return isoDate;
  return `${Number(day)}. ${Number(m)}. ${y}`;
}

export function paymentConfirmationSendDisabled(): boolean {
  return (
    process.env.BANK_PAYMENT_CONFIRMATION_DISABLE_SEND === "1" ||
    process.env.NODE_ENV === "test"
  );
}

export async function sendPaymentConfirmationForMatch(
  db: Firestore,
  input: {
    organizationId: string;
    matchId: string;
    emailAccountId: string;
    actorUserId: string;
    draft: PaymentConfirmationDraft;
    dryRun?: boolean;
  }
): Promise<{ sent: boolean; skippedReason?: string }> {
  const matchRef = bankMatchesCol(db, input.organizationId).doc(input.matchId);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) return { sent: false, skippedReason: "match_missing" };
  const match = matchSnap.data() as Record<string, unknown>;
  if (match.paymentConfirmationSentAt) {
    return { sent: false, skippedReason: "already_sent" };
  }

  if (input.dryRun || paymentConfirmationSendDisabled()) {
    await matchRef.update({
      paymentConfirmationSentAt: new Date().toISOString(),
      paymentConfirmationEmailAccountId: input.emailAccountId,
      paymentConfirmationRecipient: input.draft.to,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { sent: false, skippedReason: "dry_run" };
  }

  try {
    const sent = await sendEmailFromAccount(db, input.organizationId, input.emailAccountId, {
      to: [input.draft.to],
      subject: input.draft.subject,
      textBody: input.draft.textBody,
      htmlBody: input.draft.htmlBody,
    });

    await matchRef.update({
      paymentConfirmationSentAt: new Date().toISOString(),
      paymentConfirmationEmailAccountId: input.emailAccountId,
      paymentConfirmationRecipient: input.draft.to,
      paymentConfirmationError: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeBankAuditLog(db, {
      organizationId: input.organizationId,
      userId: input.actorUserId,
      action: "BANK_PAYMENT_CONFIRMATION_SENT",
      entityId: String(match.transactionId ?? input.matchId),
      metadata: {
        matchId: input.matchId,
        to: input.draft.to,
        messageDocId: sent.messageDocId,
      },
    });

    await appendBankAutomationLog(db, {
      organizationId: input.organizationId,
      kind: "payment_confirmation",
      success: true,
      message: `Potvrzení odesláno na ${input.draft.to}`,
      metadata: { matchId: input.matchId, invoiceNumber: input.draft.invoiceNumber },
    });

    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odeslání selhalo.";
    await matchRef.update({
      paymentConfirmationError: msg.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await appendBankAutomationLog(db, {
      organizationId: input.organizationId,
      kind: "payment_confirmation",
      success: false,
      message: msg,
      metadata: { matchId: input.matchId },
    });
    throw e;
  }
}
