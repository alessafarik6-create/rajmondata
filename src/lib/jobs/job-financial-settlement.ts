/**
 * Jednotný výpočet hodnoty zakázky, záloh a konečného vyúčtování (bez duplicit).
 */

import type { WorkContractLike } from "@/lib/job-billing-invoices";
import { computeDepositAmountKc } from "@/lib/work-contract-deposit";
import { parseJobContractManual } from "@/lib/job-contract-manual";
import {
  computeExpenseAmountsFromInput,
  normalizeVatRate,
  roundMoney2,
  type JobBudgetBreakdown,
  type VatRatePercent,
} from "@/lib/vat-calculations";
import {
  aggregateBudgetItemAmounts,
  computeWorkBudgetFinancialOverview,
  type MoneyTriple,
} from "@/lib/work-budget-financial-overview";
import type { JobWorkBudgetAdvanceDoc } from "@/lib/work-budget-advances";
import {
  defaultIncludeAdvanceInFinalInvoice,
  isAdvanceAvailableForDeduction,
} from "@/lib/work-budget-advances";
import {
  isApprovedExtraWorkItem,
  isNormalBudgetItem,
  type JobWorkBudgetItemDoc,
} from "@/lib/work-budget-types";

const INVOICE_TYPE_ADVANCE = "advance_invoice";
const INVOICE_TYPE_FINAL = "final_invoice";
const INVOICE_TYPE_TAX_RECEIPT = "tax_receipt_received_payment";

function depositGrossKcFromContract(
  contract: WorkContractLike,
  budgetGross: number | null
): number {
  const amt = String(contract.depositAmount ?? contract.zalohovaCastka ?? "").trim();
  const pct = String(contract.depositPercentage ?? contract.zalohovaProcenta ?? "").trim();
  return computeDepositAmountKc({
    depositAmountStr: amt,
    depositPercentStr: pct,
    budgetKc: budgetGross,
  });
}

export const JOB_VAT_REGIME = {
  STANDARD: "standard",
  REVERSE_CHARGE: "reverse_charge",
  EXEMPT: "exempt",
} as const;

export type JobVatRegime = (typeof JOB_VAT_REGIME)[keyof typeof JOB_VAT_REGIME];

export const REVERSE_CHARGE_INVOICE_NOTE_CS =
  "Daň odvede zákazník. Přenesení daňové povinnosti dle § 92e zákona o DPH.";

export type JobCurrentValueSnapshot = {
  contractBase: MoneyTriple;
  extraWorkApproved: MoneyTriple;
  deductions: MoneyTriple;
  current: MoneyTriple;
  /** Odkud pochází „aktuální cena“. */
  source: "work_budget" | "contract_manual" | "job_budget";
  warnings: string[];
};

export type AdvanceCreditLine = {
  id: string;
  label: string;
  paidGross: number;
  paidNet: number;
  paidVat: number;
  vatRate: VatRatePercent | null;
  source: "advance_invoice" | "work_budget_advance" | "contract_estimate";
};

export type JobSettlementComputation = {
  currentValue: JobCurrentValueSnapshot;
  vatRegime: JobVatRegime;
  totalContractGross: number;
  totalContractNet: number;
  totalContractVat: number;
  totalAdvancePaid: number;
  advanceCreditNet: number;
  advanceCreditVat: number;
  alreadyInvoicedGross: number;
  performanceGross: number;
  amountToPay: number;
  amountToPayNet: number;
  amountToPayVat: number;
  advanceSource: "invoices" | "contract" | "mixed" | "none";
  relatedAdvanceInvoiceIds: string[];
  advanceLines: AdvanceCreditLine[];
  advanceRowsForHtml: Array<{ label: string; amountGross: number }>;
  validationErrors: string[];
  validationWarnings: string[];
};

function emptyTriple(): MoneyTriple {
  return { net: 0, vat: 0, gross: 0 };
}

function tripleFromGross(gross: number, vatRate: VatRatePercent): MoneyTriple {
  const g = roundMoney2(Math.max(0, gross));
  if (g <= 0) return emptyTriple();
  const { amountNet, vatAmount, amountGross } = computeExpenseAmountsFromInput({
    amountInput: g,
    amountType: "gross",
    vatRate,
  });
  return { net: amountNet, vat: vatAmount, gross: amountGross };
}

function tripleFromManualGross(gross: number, vatRate: VatRatePercent): MoneyTriple {
  return tripleFromGross(gross, vatRate);
}

export function parseJobVatRegime(job?: Record<string, unknown> | null): JobVatRegime {
  const raw = String(job?.vatRegime ?? job?.vatMode ?? "").trim().toLowerCase();
  if (
    raw === JOB_VAT_REGIME.REVERSE_CHARGE ||
    raw === "pdp" ||
    raw.includes("přenes") ||
    raw.includes("reverse")
  ) {
    return JOB_VAT_REGIME.REVERSE_CHARGE;
  }
  if (raw === JOB_VAT_REGIME.EXEMPT || raw === "osvobozeno" || raw === "exempt") {
    return JOB_VAT_REGIME.EXEMPT;
  }
  return JOB_VAT_REGIME.STANDARD;
}

/** Schválené odpočty / méněpráce — záporné částky v rozpočtu. */
export function aggregateApprovedDeductions(items: JobWorkBudgetItemDoc[]): MoneyTriple {
  const rows = items.filter(
    (row) =>
      (isNormalBudgetItem(row) || isApprovedExtraWorkItem(row)) &&
      row.amountGross < -0.009
  );
  const t = aggregateBudgetItemAmounts(rows);
  return {
    net: roundMoney2(Math.abs(t.net)),
    vat: roundMoney2(Math.abs(t.vat)),
    gross: roundMoney2(Math.abs(t.gross)),
  };
}

export function resolveJobCurrentValue(params: {
  job?: Record<string, unknown> | null;
  jobBudget: JobBudgetBreakdown | null;
  workBudgetItems?: JobWorkBudgetItemDoc[];
}): JobCurrentValueSnapshot {
  const warnings: string[] = [];
  const items = params.workBudgetItems ?? [];
  const jobBudget = params.jobBudget;
  const manual = parseJobContractManual(params.job ?? {});
  const vatRate = normalizeVatRate(jobBudget?.vatRate ?? 21);

  const hasWorkBudgetLines = items.length > 0;
  const overview = hasWorkBudgetLines
    ? computeWorkBudgetFinancialOverview({ items, jobBudget })
    : null;

  const deductions = hasWorkBudgetLines ? aggregateApprovedDeductions(items) : emptyTriple();

  if (overview) {
    let current = overview.currentPrice;
    if (deductions.gross > 0) {
      current = {
        net: roundMoney2(Math.max(0, current.net - deductions.net)),
        vat: roundMoney2(Math.max(0, current.vat - deductions.vat)),
        gross: roundMoney2(Math.max(0, current.gross - deductions.gross)),
      };
    }
    const manualTotal = manual.totalPriceGross;
    if (manualTotal != null && Number.isFinite(manualTotal) && manualTotal > 0) {
      const manualGross = roundMoney2(manualTotal);
      if (Math.abs(manualGross - current.gross) > 1) {
        warnings.push(
          `Ruční celková cena ve smlouvě (${manualGross.toLocaleString("cs-CZ")} Kč s DPH) se liší od položkového rozpočtu (${current.gross.toLocaleString("cs-CZ")} Kč). Pro vyúčtování se používá položkový rozpočet včetně schválených víceprací.`
        );
      }
    }
    if (
      jobBudget &&
      Math.abs(overview.contractBase.gross - jobBudget.budgetGross) > 1 &&
      overview.extraWorkApproved.gross < 0.01
    ) {
      warnings.push(
        "Základ rozpočtu z položek se liší od hlavičky zakázky — ověřte synchronizaci rozpočtu."
      );
    }
    return {
      contractBase: overview.contractBase,
      extraWorkApproved: overview.extraWorkApproved,
      deductions,
      current,
      source: "work_budget",
      warnings,
    };
  }

  if (manual.totalPriceGross != null && Number.isFinite(manual.totalPriceGross)) {
    const current = tripleFromManualGross(manual.totalPriceGross, vatRate);
    const base = jobBudget
      ? { net: jobBudget.budgetNet, vat: jobBudget.budgetVat, gross: jobBudget.budgetGross }
      : current;
    return {
      contractBase: base,
      extraWorkApproved: emptyTriple(),
      deductions: emptyTriple(),
      current,
      source: "contract_manual",
      warnings,
    };
  }

  if (jobBudget) {
    const current = {
      net: jobBudget.budgetNet,
      vat: jobBudget.budgetVat,
      gross: jobBudget.budgetGross,
    };
    return {
      contractBase: current,
      extraWorkApproved: emptyTriple(),
      deductions: emptyTriple(),
      current,
      source: "job_budget",
      warnings,
    };
  }

  return {
    contractBase: emptyTriple(),
    extraWorkApproved: emptyTriple(),
    deductions: emptyTriple(),
    current: emptyTriple(),
    source: "job_budget",
    warnings: ["Chybí rozpočet zakázky."],
  };
}

function advancePaidNetVatFromInvoice(params: {
  paidGross: number;
  invoiceNet: number;
  invoiceVat: number;
  invoiceGross: number;
  invoiceVatRate: VatRatePercent;
}): { net: number; vat: number } {
  const paid = roundMoney2(Math.max(0, params.paidGross));
  if (paid <= 0) return { net: 0, vat: 0 };
  const invGross = roundMoney2(Math.max(0, params.invoiceGross));
  if (invGross <= 0) {
    const split = computeExpenseAmountsFromInput({
      amountInput: paid,
      amountType: "gross",
      vatRate: params.invoiceVatRate,
    });
    return { net: split.amountNet, vat: split.vatAmount };
  }
  const ratio = Math.min(1, paid / invGross);
  return {
    net: roundMoney2(params.invoiceNet * ratio),
    vat: roundMoney2(params.invoiceVat * ratio),
  };
}

export function sumAlreadyInvoicedFromWorkBudget(params: {
  invoices: Array<Record<string, unknown> & { id: string }>;
}): number {
  let sum = 0;
  for (const inv of params.invoices) {
    const type = String(inv.type ?? "").trim();
    if (type === INVOICE_TYPE_FINAL) continue;
    if (type === INVOICE_TYPE_ADVANCE) continue;
    if (type === INVOICE_TYPE_TAX_RECEIPT) continue;
    if (inv.workBudgetSource !== true && inv.workBudgetSource !== "true") continue;
    if (inv.isDeleted === true) continue;
    sum += roundMoney2(Number(inv.amountGross ?? inv.totalAmount) || 0);
  }
  return roundMoney2(sum);
}

export function computeJobSettlement(params: {
  job?: Record<string, unknown> | null;
  jobBudget: JobBudgetBreakdown | null;
  workBudgetItems?: JobWorkBudgetItemDoc[];
  workBudgetAdvances?: JobWorkBudgetAdvanceDoc[];
  advanceInvoices: Array<{
    id: string;
    type?: string;
    invoiceNumber?: string;
    paidGrossReceived?: unknown;
    amountGross?: unknown;
    amountNet?: unknown;
    vatAmount?: unknown;
    vatRate?: unknown;
  }>;
  allJobInvoices?: Array<Record<string, unknown> & { id: string }>;
  contractFallback: WorkContractLike | null;
}): JobSettlementComputation {
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  const currentValue = resolveJobCurrentValue({
    job: params.job,
    jobBudget: params.jobBudget,
    workBudgetItems: params.workBudgetItems,
  });
  validationWarnings.push(...currentValue.warnings);

  const vatRegime = parseJobVatRegime(params.job);
  const jobVatRate = normalizeVatRate(params.jobBudget?.vatRate ?? 21);

  const linkedAdvanceInvoiceIds = new Set<string>();
  for (const adv of params.workBudgetAdvances ?? []) {
    if (adv.invoiceId) linkedAdvanceInvoiceIds.add(adv.invoiceId);
  }

  const advanceLines: AdvanceCreditLine[] = [];
  const advanceRowsForHtml: Array<{ label: string; amountGross: number }> = [];
  let totalAdvancePaid = 0;
  let advanceCreditNet = 0;
  let advanceCreditVat = 0;
  let advanceSource: JobSettlementComputation["advanceSource"] = "none";
  const relatedAdvanceInvoiceIds: string[] = [];

  const zfRows = params.advanceInvoices.filter((x) => x.type === INVOICE_TYPE_ADVANCE);
  if (zfRows.length > 0) {
    advanceSource = "invoices";
    for (const a of zfRows) {
      relatedAdvanceInvoiceIds.push(a.id);
      const cap = roundMoney2(Number(a.amountGross) || 0);
      const paidRaw = roundMoney2(Number(a.paidGrossReceived) || 0);
      const paid = cap > 0 ? Math.min(paidRaw, cap) : paidRaw;
      if (paid <= 0) continue;
      const invNet = roundMoney2(Number(a.amountNet) || 0);
      const invVat = roundMoney2(Number(a.vatAmount) || 0);
      const invRate = normalizeVatRate(Number(a.vatRate) || jobVatRate);
      const { net, vat } = advancePaidNetVatFromInvoice({
        paidGross: paid,
        invoiceNet: invNet,
        invoiceVat: invVat,
        invoiceGross: cap,
        invoiceVatRate: invRate,
      });
      totalAdvancePaid = roundMoney2(totalAdvancePaid + paid);
      advanceCreditNet = roundMoney2(advanceCreditNet + net);
      advanceCreditVat = roundMoney2(advanceCreditVat + vat);
      const label = `Uhrazená záloha — ${String(a.invoiceNumber ?? a.id)}`;
      advanceLines.push({
        id: a.id,
        label,
        paidGross: paid,
        paidNet: net,
        paidVat: vat,
        vatRate: invRate,
        source: "advance_invoice",
      });
      advanceRowsForHtml.push({ label, amountGross: paid });
    }
  }

  for (const row of params.workBudgetAdvances ?? []) {
    if (!isAdvanceAvailableForDeduction(row)) continue;
    if (!defaultIncludeAdvanceInFinalInvoice(row)) continue;
    if (row.invoiceId && linkedAdvanceInvoiceIds.has(row.invoiceId)) {
      const already = advanceLines.some((l) => l.id === row.invoiceId);
      if (already) continue;
    }
    if (row.invoiceId && advanceLines.some((l) => l.id === row.invoiceId)) continue;
    const paidGross = row.amountGross;
    if (paidGross <= 0) continue;
    totalAdvancePaid = roundMoney2(totalAdvancePaid + paidGross);
    advanceCreditNet = roundMoney2(advanceCreditNet + row.amountNet);
    advanceCreditVat = roundMoney2(advanceCreditVat + row.vatAmount);
    const label = row.documentNumber
      ? `Záloha ${row.documentNumber} — ${row.label}`
      : row.label;
    advanceLines.push({
      id: row.id,
      label,
      paidGross,
      paidNet: row.amountNet,
      paidVat: row.vatAmount,
      vatRate: null,
      source: "work_budget_advance",
    });
    advanceRowsForHtml.push({ label, amountGross: paidGross });
    if (advanceSource === "none") advanceSource = "mixed";
    else if (advanceSource === "invoices") advanceSource = "mixed";
  }

  if (
    totalAdvancePaid <= 0 &&
    params.contractFallback &&
    params.jobBudget?.budgetGross != null &&
    params.jobBudget.budgetGross > 0 &&
    zfRows.length === 0
  ) {
    const dep = depositGrossKcFromContract(
      params.contractFallback,
      params.jobBudget.budgetGross
    );
    if (dep > 0) {
      advanceSource = "contract";
      const split = tripleFromGross(dep, jobVatRate);
      totalAdvancePaid = dep;
      advanceCreditNet = split.net;
      advanceCreditVat = split.vat;
      const label = "Záloha dle smlouvy o dílo (bez vystavené zálohové faktury)";
      advanceLines.push({
        id: "contract-fallback",
        label,
        paidGross: dep,
        paidNet: split.net,
        paidVat: split.vat,
        vatRate: jobVatRate,
        source: "contract_estimate",
      });
      advanceRowsForHtml.push({ label, amountGross: dep });
      validationWarnings.push(
        "Záloha je odhadnuta ze smlouvy — pro správné daňové vypořádání vystavte zálohovou fakturu a daňový doklad k platbě."
      );
    }
  }

  const alreadyInvoicedGross = sumAlreadyInvoicedFromWorkBudget({
    invoices: params.allJobInvoices ?? [],
  });
  if (alreadyInvoicedGross > 0.01) {
    validationWarnings.push(
      `Na zakázce jsou faktury z položkového rozpočtu celkem ${alreadyInvoicedGross.toLocaleString("cs-CZ")} Kč s DPH — doplatek je snížen, aby nedošlo k dvojímu účtování.`
    );
  }

  const totalContractGross = currentValue.current.gross;
  const totalContractNet = currentValue.current.net;
  const totalContractVat = currentValue.current.vat;

  const performanceGross = Math.max(
    0,
    roundMoney2(totalContractGross - alreadyInvoicedGross)
  );

  let amountToPay = 0;
  let amountToPayNet = 0;
  let amountToPayVat = 0;

  if (vatRegime === JOB_VAT_REGIME.REVERSE_CHARGE) {
    const performanceNet = Math.max(
      0,
      roundMoney2(totalContractNet - (alreadyInvoicedGross > 0 ? alreadyInvoicedGross : 0))
    );
    amountToPay = Math.max(0, roundMoney2(performanceNet - totalAdvancePaid));
    amountToPayNet = amountToPay;
    amountToPayVat = 0;
    if (advanceCreditVat > 0.01) {
      validationWarnings.push(
        "Přijatá záloha obsahuje DPH, konečné plnění je v režimu přenesené daňové povinnosti — ověřte vypořádání DPH s daňovým poradcem (případně opravný daňový doklad)."
      );
    }
  } else if (vatRegime === JOB_VAT_REGIME.EXEMPT) {
    amountToPay = Math.max(0, roundMoney2(performanceGross - totalAdvancePaid));
    amountToPayNet = amountToPay;
    amountToPayVat = 0;
  } else {
    amountToPay = Math.max(0, roundMoney2(performanceGross - totalAdvancePaid));
    const perfNet = roundMoney2(Math.max(0, totalContractNet - advanceCreditNet));
    const perfVat = roundMoney2(Math.max(0, totalContractVat - advanceCreditVat));
    if (alreadyInvoicedGross > 0) {
      const ratio =
        totalContractGross > 0 ? performanceGross / totalContractGross : 1;
      amountToPayNet = roundMoney2(perfNet * ratio);
      amountToPayVat = roundMoney2(perfVat * ratio);
    } else {
      amountToPayNet = roundMoney2(Math.max(0, totalContractNet - advanceCreditNet));
      amountToPayVat = roundMoney2(Math.max(0, totalContractVat - advanceCreditVat));
    }
    const reconstructed = roundMoney2(amountToPayNet + amountToPayVat);
    if (Math.abs(reconstructed - amountToPay) > 0.05) {
      const split = computeExpenseAmountsFromInput({
        amountInput: amountToPay,
        amountType: "gross",
        vatRate: jobVatRate,
      });
      amountToPayNet = split.amountNet;
      amountToPayVat = split.vatAmount;
    }
  }

  if (currentValue.current.gross <= 0) {
    validationErrors.push("Aktuální hodnota zakázky je nulová — nelze vystavit vyúčtování.");
  }

  const checkLeft = roundMoney2(totalContractGross);
  const checkRight = roundMoney2(totalAdvancePaid + alreadyInvoicedGross + amountToPay);
  if (Math.abs(checkLeft - checkRight) > 0.1) {
    validationWarnings.push(
      `Kontrola součtu: hodnota zakázky ${checkLeft.toLocaleString("cs-CZ")} Kč vs. zálohy + faktury + doplatek ${checkRight.toLocaleString("cs-CZ")} Kč (rozdíl ${roundMoney2(checkLeft - checkRight).toLocaleString("cs-CZ")} Kč).`
    );
  }

  return {
    currentValue,
    vatRegime,
    totalContractGross,
    totalContractNet,
    totalContractVat,
    totalAdvancePaid,
    advanceCreditNet,
    advanceCreditVat,
    alreadyInvoicedGross,
    performanceGross,
    amountToPay,
    amountToPayNet,
    amountToPayVat,
    advanceSource,
    relatedAdvanceInvoiceIds,
    advanceLines,
    advanceRowsForHtml:
      advanceRowsForHtml.length > 0
        ? advanceRowsForHtml
        : [{ label: "Žádná uhrazená záloha", amountGross: 0 }],
    validationErrors,
    validationWarnings,
  };
}

export function assertSettlementCanBeIssued(computation: JobSettlementComputation): void {
  if (computation.validationErrors.length > 0) {
    throw new Error(computation.validationErrors.join(" "));
  }
}
