/**
 * Zálohy navázané na položkový rozpočet / fakturaci zakázky.
 */

import { roundMoney2 } from "@/lib/vat-calculations";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";

export const WORK_BUDGET_ADVANCES_COLLECTION = "workBudgetAdvances";

export const WORK_BUDGET_ADVANCE_SOURCE = {
  INVOICE: "invoice",
  MANUAL: "manual",
} as const;

export type WorkBudgetAdvanceSource =
  (typeof WORK_BUDGET_ADVANCE_SOURCE)[keyof typeof WORK_BUDGET_ADVANCE_SOURCE];

export const WORK_BUDGET_ADVANCE_PAYMENT_STATUS = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
} as const;

export type WorkBudgetAdvancePaymentStatus =
  (typeof WORK_BUDGET_ADVANCE_PAYMENT_STATUS)[keyof typeof WORK_BUDGET_ADVANCE_PAYMENT_STATUS];

export type JobWorkBudgetAdvanceDoc = {
  id: string;
  companyId: string;
  jobId: string;
  sourceType: WorkBudgetAdvanceSource;
  invoiceId: string | null;
  label: string;
  documentNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  paymentStatus: WorkBudgetAdvancePaymentStatus;
  includeInFinalInvoice: boolean;
  appliedToInvoiceId: string | null;
  note: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string | null;
};

export function parseWorkBudgetAdvanceFromFirestore(
  raw: Record<string, unknown>,
  id: string
): JobWorkBudgetAdvanceDoc {
  const sourceRaw = String(raw.sourceType ?? "").trim();
  const sourceType: WorkBudgetAdvanceSource =
    sourceRaw === WORK_BUDGET_ADVANCE_SOURCE.INVOICE
      ? WORK_BUDGET_ADVANCE_SOURCE.INVOICE
      : WORK_BUDGET_ADVANCE_SOURCE.MANUAL;
  const payRaw = String(raw.paymentStatus ?? "").trim();
  let paymentStatus: WorkBudgetAdvancePaymentStatus =
    WORK_BUDGET_ADVANCE_PAYMENT_STATUS.UNPAID;
  if (payRaw === WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PAID) {
    paymentStatus = WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PAID;
  } else if (payRaw === WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PARTIAL) {
    paymentStatus = WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PARTIAL;
  }
  return {
    id,
    companyId: String(raw.companyId ?? ""),
    jobId: String(raw.jobId ?? ""),
    sourceType,
    invoiceId: raw.invoiceId != null ? String(raw.invoiceId) : null,
    label: String(raw.label ?? "").trim() || "Záloha",
    documentNumber: raw.documentNumber != null ? String(raw.documentNumber) : null,
    variableSymbol: raw.variableSymbol != null ? String(raw.variableSymbol) : null,
    issueDate: raw.issueDate != null ? String(raw.issueDate) : null,
    amountNet: roundMoney2(Number(raw.amountNet) || 0),
    vatAmount: roundMoney2(Number(raw.vatAmount) || 0),
    amountGross: roundMoney2(Number(raw.amountGross) || 0),
    paymentStatus,
    includeInFinalInvoice: raw.includeInFinalInvoice !== false,
    appliedToInvoiceId:
      raw.appliedToInvoiceId != null ? String(raw.appliedToInvoiceId) : null,
    note: raw.note != null ? String(raw.note) : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdBy: raw.createdBy != null ? String(raw.createdBy) : null,
  };
}

export function isAdvanceAvailableForDeduction(row: JobWorkBudgetAdvanceDoc): boolean {
  return isAdvanceAvailableForInvoice(row, null);
}

/** Záloha volitelná pro fakturu (nová) nebo pro přegenerování stejné faktury. */
export function isAdvanceAvailableForInvoice(
  row: JobWorkBudgetAdvanceDoc,
  regenerateInvoiceId: string | null | undefined
): boolean {
  if (row.amountGross <= 0) return false;
  const applied = row.appliedToInvoiceId;
  if (!applied) return true;
  const reg = String(regenerateInvoiceId ?? "").trim();
  return reg.length > 0 && applied === reg;
}

export function defaultIncludeAdvanceInFinalInvoice(
  row: JobWorkBudgetAdvanceDoc
): boolean {
  if (row.includeInFinalInvoice === false) return false;
  return (
    row.paymentStatus === WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PAID ||
    row.paymentStatus === WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PARTIAL
  );
}

export function sumAdvancesGross(
  rows: JobWorkBudgetAdvanceDoc[],
  filter?: (row: JobWorkBudgetAdvanceDoc) => boolean
): number {
  let sum = 0;
  for (const row of rows) {
    if (filter && !filter(row)) continue;
    sum += row.amountGross;
  }
  return roundMoney2(sum);
}

/** Zálohy započítané do „zbývá k fakturaci“ (nezapočtené na faktuře, určené k odečtu). */
export function sumAdvancesForRemainingInvoice(rows: JobWorkBudgetAdvanceDoc[]): number {
  return sumAdvancesGross(rows, (row) => {
    if (!isAdvanceAvailableForDeduction(row)) return false;
    if (row.includeInFinalInvoice === false) return false;
    return defaultIncludeAdvanceInFinalInvoice(row);
  });
}

export type WorkBudgetAdvanceTotals = {
  totalGross: number;
  forDeductionGross: number;
};

export function computeWorkBudgetAdvanceTotals(
  rows: JobWorkBudgetAdvanceDoc[]
): WorkBudgetAdvanceTotals {
  return {
    totalGross: sumAdvancesGross(rows),
    forDeductionGross: sumAdvancesForRemainingInvoice(rows),
  };
}

export type JobInvoiceAdvanceCandidate = {
  id: string;
  invoiceNumber: string;
  issueDate: string | null;
  amountGross: number;
  amountNet: number;
  vatAmount: number;
  paymentStatus: string;
  paidGross: number;
};

export function filterAdvanceInvoiceCandidates(params: {
  invoices: Array<Record<string, unknown> & { id: string }>;
  linkedInvoiceIds: Set<string>;
}): JobInvoiceAdvanceCandidate[] {
  const out: JobInvoiceAdvanceCandidate[] = [];
  for (const inv of params.invoices) {
    const type = String(inv.type ?? "").trim();
    if (type !== JOB_INVOICE_TYPES.ADVANCE) continue;
    if (params.linkedInvoiceIds.has(inv.id)) continue;
    const amountGross = roundMoney2(Number(inv.amountGross ?? inv.totalAmount) || 0);
    if (amountGross <= 0) continue;
    const paidGross = roundMoney2(Number(inv.paidGrossReceived ?? 0) || 0);
    out.push({
      id: inv.id,
      invoiceNumber: String(inv.invoiceNumber ?? inv.documentNumber ?? inv.id),
      issueDate: String(inv.issueDate ?? "").trim() || null,
      amountGross,
      amountNet: roundMoney2(Number(inv.amountNet) || 0),
      vatAmount: roundMoney2(Number(inv.vatAmount) || 0),
      paymentStatus: String(inv.paymentStatus ?? "unpaid"),
      paidGross,
    });
  }
  return out;
}

export function newManualAdvanceId(): string {
  return `adv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
