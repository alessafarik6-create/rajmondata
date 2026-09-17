import type { InvoiceAdvanceSettlement } from "@/lib/invoice-a4-html";
import {
  computePortalManualInvoiceTotals,
  type PortalManualFormItem,
} from "@/lib/portal-manual-invoice";
import { roundMoney2 } from "@/lib/vat-calculations";

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

export function parseWorkBudgetAdvancesAppliedFromInvoice(
  data: Record<string, unknown>
): WorkBudgetAdvancesAppliedRow[] {
  const raw = Array.isArray(data.workBudgetAdvancesApplied)
    ? data.workBudgetAdvancesApplied
    : [];
  return raw
    .map((row) => {
      const r = row as Record<string, unknown>;
      const amountGross = roundMoney2(Number(r.amountGross) || 0);
      if (amountGross <= 0) return null;
      return {
        advanceId: String(r.advanceId ?? "").trim() || "advance",
        label: String(r.label ?? "Záloha").trim() || "Záloha",
        amountGross,
      };
    })
    .filter((a): a is WorkBudgetAdvancesAppliedRow => a != null);
}

/** Settlement z uložené faktury (editace hlavičky bez změny položek/záloh). */
export function buildWorkBudgetAdvanceSettlementFromInvoiceDoc(
  inv: Record<string, unknown>,
  invoiceLines: PortalManualFormItem[]
): InvoiceAdvanceSettlement | null {
  if (inv.workBudgetSource !== true) return null;
  const deduction = roundMoney2(Number(inv.workBudgetAdvanceDeductionGross) || 0);
  if (deduction <= 0) return null;
  const subtotalGross = roundMoney2(Number(inv.workBudgetSubtotalGross) || 0);
  const grossTotal =
    subtotalGross > 0
      ? subtotalGross
      : roundMoney2(Number(inv.amountGross) + deduction);
  let advancesApplied = parseWorkBudgetAdvancesAppliedFromInvoice(inv);
  if (advancesApplied.length === 0) {
    advancesApplied = [
      { advanceId: "advances", label: "Započtené zálohy", amountGross: deduction },
    ];
  }
  const rawDeduction = advancesApplied.reduce(
    (s, a) => roundMoney2(s + a.amountGross),
    0
  );
  return buildWorkBudgetAdvanceSettlement({
    subtotalGross: grossTotal,
    deductionGross: deduction,
    amountDueGross: roundMoney2(Number(inv.amountGross) || 0),
    amountDueNet: roundMoney2(Number(inv.amountNet) || 0),
    amountDueVat: roundMoney2(Number(inv.vatAmount) || 0),
    advancesApplied,
    overpaymentGross:
      rawDeduction > grossTotal ? roundMoney2(rawDeduction - grossTotal) : undefined,
    invoiceLines,
  });
}
