import { roundMoney2 } from "@/lib/vat-calculations";
import {
  getDocumentPaymentState,
  getPortalInvoicePaymentState,
  portalInvoiceTotalAmountGross,
  documentTotalAmountGross,
  type PaymentStateRow,
} from "@/lib/invoice-payment-state";
import type { BankMatchSuggestion, BankTransactionDirection } from "@/lib/bank/types";

export const AUTO_MATCH_MIN_CONFIDENCE = 85;

export type MatchCandidateInvoice = {
  id: string;
  invoiceNumber?: string | null;
  variableSymbol?: string | null;
  amountGross?: number | null;
  currency?: string | null;
  customerName?: string | null;
  status?: string | null;
};

export type MatchCandidateDocument = {
  id: string;
  number?: string | null;
  variableSymbol?: string | null;
  nazev?: string | null;
  supplierName?: string | null;
  type?: string | null;
  documentKind?: string | null;
};

export type BankTxnMatchInput = {
  direction: BankTransactionDirection;
  amount: number;
  currency: string;
  variableSymbol?: string | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  bookingDate: string;
};

function normalizeVs(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/\s/g, "")
    .replace(/^0+/, "")
    .trim();
}

function amountClose(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(roundMoney2(a) - roundMoney2(b)) <= tolerance;
}

function scoreIssuedInvoice(
  txn: BankTxnMatchInput,
  inv: MatchCandidateInvoice,
  todayIso: string
): BankMatchSuggestion | null {
  const row = inv as PaymentStateRow;
  const total = portalInvoiceTotalAmountGross(row);
  if (total <= 0) return null;
  const state = getPortalInvoicePaymentState(row, todayIso);
  if (state.remainingAmount <= 0.009) return null;

  const txnAmt = Math.abs(roundMoney2(txn.amount));
  const vsTxn = normalizeVs(txn.variableSymbol);
  const vsInv = normalizeVs(inv.variableSymbol ?? inv.invoiceNumber);
  const reasons: string[] = [];
  let confidence = 0;

  if (vsTxn && vsInv && vsTxn === vsInv) {
    confidence += 55;
    reasons.push("Shoda variabilního symbolu");
  }
  if (amountClose(txnAmt, state.remainingAmount)) {
    confidence += 45;
    reasons.push("Přesná částka");
  } else if (amountClose(txnAmt, state.remainingAmount, 1)) {
    confidence += 30;
    reasons.push("Částka s malou tolerancí");
  } else if (amountClose(txnAmt, total)) {
    confidence += 25;
    reasons.push("Částka odpovídá celku faktury");
  }

  const name = String(inv.customerName ?? "").trim().toLowerCase();
  const cp = String(txn.counterpartyName ?? "").trim().toLowerCase();
  if (name && cp && (name.includes(cp) || cp.includes(name))) {
    confidence += 15;
    reasons.push("Protistrana");
  }

  if (confidence < 40) return null;

  return {
    targetKind: "issued_invoice",
    targetId: inv.id,
    label: String(inv.invoiceNumber ?? inv.id),
    variableSymbol: inv.variableSymbol ?? null,
    amount: total,
    currency: String(inv.currency ?? txn.currency ?? "CZK"),
    confidence: Math.min(100, confidence),
    reasons,
  };
}

function scoreReceivedDocument(
  txn: BankTxnMatchInput,
  doc: MatchCandidateDocument,
  todayIso: string
): BankMatchSuggestion | null {
  const row = doc as PaymentStateRow;
  const total = documentTotalAmountGross(row);
  if (total <= 0) return null;
  const state = getDocumentPaymentState(row, todayIso);
  if (state.remainingAmount <= 0.009) return null;

  const txnAmt = Math.abs(roundMoney2(txn.amount));
  const vsTxn = normalizeVs(txn.variableSymbol);
  const vsDoc = normalizeVs(doc.variableSymbol ?? doc.number);
  const reasons: string[] = [];
  let confidence = 0;

  if (vsTxn && vsDoc && vsTxn === vsDoc) {
    confidence += 55;
    reasons.push("Shoda variabilního symbolu");
  }
  if (amountClose(txnAmt, state.remainingAmount)) {
    confidence += 45;
    reasons.push("Přesná částka");
  } else if (amountClose(txnAmt, state.remainingAmount, 1)) {
    confidence += 30;
    reasons.push("Částka s malou tolerancí");
  }

  const supplier = String(doc.supplierName ?? doc.nazev ?? "").trim().toLowerCase();
  const cp = String(txn.counterpartyName ?? "").trim().toLowerCase();
  if (supplier && cp && (supplier.includes(cp) || cp.includes(supplier))) {
    confidence += 15;
    reasons.push("Dodavatel");
  }

  if (confidence < 40) return null;

  return {
    targetKind: "received_document",
    targetId: doc.id,
    label: String(doc.number ?? doc.nazev ?? doc.id),
    variableSymbol: doc.variableSymbol ?? null,
    amount: total,
    currency: txn.currency ?? "CZK",
    confidence: Math.min(100, confidence),
    reasons,
  };
}

export function suggestBankTransactionMatches(
  txn: BankTxnMatchInput,
  opts: {
    todayIso: string;
    issuedInvoices: MatchCandidateInvoice[];
    receivedDocuments: MatchCandidateDocument[];
  }
): BankMatchSuggestion[] {
  const out: BankMatchSuggestion[] = [];
  if (txn.direction === "incoming") {
    for (const inv of opts.issuedInvoices) {
      const s = scoreIssuedInvoice(txn, inv, opts.todayIso);
      if (s) out.push(s);
    }
  } else {
    for (const doc of opts.receivedDocuments) {
      const kind = String(doc.documentKind ?? doc.type ?? "").toLowerCase();
      if (kind && !["prijate", "received", "invoice"].includes(kind) && doc.type !== "received") {
        continue;
      }
      const s = scoreReceivedDocument(txn, doc, opts.todayIso);
      if (s) out.push(s);
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

export function pickAutoMatch(suggestions: BankMatchSuggestion[]): BankMatchSuggestion | null {
  const top = suggestions.filter((s) => s.confidence >= AUTO_MATCH_MIN_CONFIDENCE);
  if (top.length !== 1) return null;
  return top[0] ?? null;
}
