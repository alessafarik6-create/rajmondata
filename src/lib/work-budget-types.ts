/**
 * Položkový rozpočet prací u zakázky.
 */

import {
  computeExpenseAmountsFromInput,
  normalizeVatRate,
  roundMoney2,
  type VatRatePercent,
} from "@/lib/vat-calculations";

export const WORK_BUDGET_ITEMS_COLLECTION = "workBudgetItems";
export const WORK_BUDGET_TEMPLATES_COLLECTION = "workBudgetTemplates";

export type JobWorkBudgetItemDoc = {
  id: string;
  companyId: string;
  jobId: string;
  sortOrder: number;
  /** Název práce */
  title: string;
  description: string;
  quantity: number;
  unit: string;
  /** Cena za jednotku bez DPH */
  unitPriceNet: number;
  vatRate: VatRatePercent;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  done: boolean;
  doneAt: string | null;
  note: string | null;
  invoiced: boolean;
  invoicedAt: string | null;
  linkedInvoiceId: string | null;
  createdBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type WorkBudgetTemplateItem = {
  title: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceNet: number;
  vatRate: VatRatePercent;
  note?: string | null;
};

export type WorkBudgetTemplateContent = {
  items: WorkBudgetTemplateItem[];
};

export type WorkBudgetTemplateDoc = {
  id: string;
  companyId: string;
  name: string;
  content: WorkBudgetTemplateContent;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string | null;
};

export type WorkBudgetSummary = {
  totalNet: number;
  totalGross: number;
  doneNet: number;
  doneGross: number;
  remainingNet: number;
  remainingGross: number;
  billableNet: number;
  billableGross: number;
};

export function computeWorkBudgetLineAmounts(params: {
  quantity: number;
  unitPriceNet: number;
  vatRate: VatRatePercent;
}): { amountNet: number; vatAmount: number; amountGross: number } {
  const qty = Math.max(0, Number(params.quantity) || 0);
  const unitNet = Math.max(0, Number(params.unitPriceNet) || 0);
  const vatRate = normalizeVatRate(params.vatRate);
  const lineNet = roundMoney2(unitNet * qty);
  const unitGross = computeExpenseAmountsFromInput({
    amountInput: unitNet,
    amountType: "net",
    vatRate,
  });
  const vatPerUnit = roundMoney2(unitGross.vatAmount);
  const grossPerUnit = roundMoney2(unitGross.amountGross);
  return {
    amountNet: lineNet,
    vatAmount: roundMoney2(vatPerUnit * qty),
    amountGross: roundMoney2(grossPerUnit * qty),
  };
}

export function parseJobWorkBudgetItemFromFirestore(
  raw: Record<string, unknown>,
  id: string
): JobWorkBudgetItemDoc {
  const qty = Number(raw.quantity) || 0;
  const unitPriceNet = Number(raw.unitPriceNet) || 0;
  const vatRate = normalizeVatRate(raw.vatRate);
  const amounts = computeWorkBudgetLineAmounts({ quantity: qty, unitPriceNet, vatRate });
  return {
    id,
    companyId: String(raw.companyId ?? ""),
    jobId: String(raw.jobId ?? ""),
    sortOrder: Number(raw.sortOrder) || 0,
    title: String(raw.title ?? "").trim(),
    description: String(raw.description ?? "").trim(),
    quantity: qty,
    unit: String(raw.unit ?? "ks").trim() || "ks",
    unitPriceNet,
    vatRate,
    amountNet: Number(raw.amountNet) || amounts.amountNet,
    vatAmount: Number(raw.vatAmount) || amounts.vatAmount,
    amountGross: Number(raw.amountGross) || amounts.amountGross,
    done: raw.done === true,
    doneAt: raw.doneAt != null ? String(raw.doneAt) : null,
    note: raw.note != null ? String(raw.note) : null,
    invoiced: raw.invoiced === true,
    invoicedAt: raw.invoicedAt != null ? String(raw.invoicedAt) : null,
    linkedInvoiceId: raw.linkedInvoiceId != null ? String(raw.linkedInvoiceId) : null,
    createdBy: raw.createdBy != null ? String(raw.createdBy) : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function workBudgetTemplateContentFromItems(
  items: JobWorkBudgetItemDoc[]
): WorkBudgetTemplateContent {
  return {
    items: items.map((row) => ({
      title: row.title,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPriceNet: row.unitPriceNet,
      vatRate: row.vatRate,
      note: row.note,
    })),
  };
}

export function newEmptyWorkBudgetItemFields(): Omit<
  JobWorkBudgetItemDoc,
  "id" | "companyId" | "jobId" | "createdAt" | "updatedAt" | "createdBy"
> {
  const amounts = computeWorkBudgetLineAmounts({
    quantity: 1,
    unitPriceNet: 0,
    vatRate: 21,
  });
  return {
    sortOrder: 0,
    title: "",
    description: "",
    quantity: 1,
    unit: "ks",
    unitPriceNet: 0,
    vatRate: 21,
    amountNet: amounts.amountNet,
    vatAmount: amounts.vatAmount,
    amountGross: amounts.amountGross,
    done: false,
    doneAt: null,
    note: null,
    invoiced: false,
    invoicedAt: null,
    linkedInvoiceId: null,
  };
}
