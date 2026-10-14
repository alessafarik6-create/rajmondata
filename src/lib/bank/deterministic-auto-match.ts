import {
  getPortalInvoicePaymentState,
  portalInvoiceTotalAmountGross,
  type PaymentStateRow,
} from "@/lib/invoice-payment-state";
import { roundMoney2 } from "@/lib/vat-calculations";
import type { BankTxnMatchInput, MatchCandidateInvoice } from "@/lib/bank/matching";

function normalizeVs(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/\s/g, "")
    .replace(/^0+/, "")
    .trim();
}

function amountClose(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(roundMoney2(a) - roundMoney2(b)) <= tolerance;
}

export type DeterministicInvoiceMatch = {
  invoiceId: string;
  invoiceNumber: string;
  matchedAmount: number;
  isFullPayment: boolean;
  reasons: string[];
};

/**
 * Jednoznačná shoda — bez AI skóre. Vyžaduje VS nebo číslo faktury v popisu + přesnou částku/měnu.
 */
export function findDeterministicIssuedInvoiceMatch(
  txn: BankTxnMatchInput,
  invoices: MatchCandidateInvoice[],
  todayIso: string
): DeterministicInvoiceMatch | null {
  if (txn.direction !== "incoming") return null;

  const txnAmt = Math.abs(roundMoney2(txn.amount));
  if (txnAmt <= 0.009) return null;

  const vsTxn = normalizeVs(txn.variableSymbol);
  const textBlob = [txn.message, txn.reference].filter(Boolean).join(" ").toLowerCase();
  const txnCur = String(txn.currency ?? "CZK").toUpperCase();

  const candidates: DeterministicInvoiceMatch[] = [];

  for (const inv of invoices) {
    const row = inv as PaymentStateRow;
    const state = getPortalInvoicePaymentState(row, todayIso);
    if (state.remainingAmount <= 0.009) continue;

    const invCur = String(inv.currency ?? txnCur).toUpperCase();
    if (invCur !== txnCur) continue;

    const vsInv = normalizeVs(inv.variableSymbol ?? inv.invoiceNumber);
    const invNum = String(inv.invoiceNumber ?? "").trim();
    const reasons: string[] = [];

    const vsMatch = Boolean(vsTxn && vsInv && vsTxn === vsInv);
    const numInText =
      invNum.length >= 4 && textBlob.includes(invNum.toLowerCase());

    if (!vsMatch && !numInText) continue;
    if (vsMatch) reasons.push("Variabilní symbol");
    if (numInText) reasons.push("Číslo faktury v popisu");

    const remaining = state.remainingAmount;
    const exactRemaining = amountClose(txnAmt, remaining);
    const partial =
      txnAmt > 0.009 && txnAmt < remaining - 0.009 && txnAmt <= remaining + 0.02;

    if (exactRemaining) {
      reasons.push("Přesná částka");
    } else if (partial) {
      reasons.push("Částečná úhrada");
    } else {
      continue;
    }

    const matchedAmount = exactRemaining ? remaining : roundMoney2(txnAmt);
    candidates.push({
      invoiceId: inv.id,
      invoiceNumber: invNum || String(inv.id),
      matchedAmount,
      isFullPayment: exactRemaining,
      reasons,
    });
  }

  if (candidates.length !== 1) return null;
  return candidates[0] ?? null;
}

export function invoiceListFromFirestoreDocs(
  docs: Array<{ id: string; data: Record<string, unknown> }>
): MatchCandidateInvoice[] {
  return docs.map(({ id, data }) => ({
    id,
    invoiceNumber: data.invoiceNumber as string | null,
    variableSymbol: data.variableSymbol as string | null,
    amountGross: portalInvoiceTotalAmountGross(data as PaymentStateRow),
    currency: data.currency as string | null,
    customerName: data.customerName as string | null,
    status: data.status as string | null,
    ...data,
  }));
}
