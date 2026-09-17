import type { InvoiceAdvanceSettlement } from "@/lib/invoice-a4-html";
import {
  computePortalManualInvoiceTotals,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";

export type WorkBudgetAdvancesAppliedRow = {
  advanceId: string;
  label: string;
  amountGross: number;
};

/** PDF patička: mezisoučet položek, zálohy a částka k úhradě. */
export function buildWorkBudgetAdvanceSettlement(params: {
  subtotalGross: number;
  deductionGross: number;
  amountDueGross: number;
  amountDueNet: number;
  amountDueVat: number;
  advancesApplied: WorkBudgetAdvancesAppliedRow[];
  overpaymentGross?: number;
  invoiceLines: PortalManualFormItem[];
}): InvoiceAdvanceSettlement | null {
  if (params.deductionGross <= 0 || params.advancesApplied.length === 0) {
    return null;
  }
  const lineTotals = computePortalManualInvoiceTotals(params.invoiceLines);
  return {
    linesGrossTotal: params.subtotalGross,
    linesAmountNet: lineTotals.amountNet,
    linesVatAmount: lineTotals.vatAmount,
    linesVatBreakdown: lineTotals.vatBreakdown.map((b) => ({
      rate: b.rate,
      base: b.base,
      vat: b.vat,
    })),
    advances: params.advancesApplied.map((a) => ({
      label: a.label,
      amountGross: a.amountGross,
    })),
    advanceTotalGross: params.deductionGross,
    amountDueGross: params.amountDueGross,
    amountDueNet: params.amountDueNet,
    amountDueVat: params.amountDueVat,
    overpaymentGross:
      params.overpaymentGross && params.overpaymentGross > 0
        ? params.overpaymentGross
        : undefined,
  };
}
