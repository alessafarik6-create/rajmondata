/**
 * Jednotný výpočet zálohy zakázky — detail, karta Smlouva a záloha, export PDF.
 */

import {
  computeSettlementAmounts,
  depositGrossKcFromContract,
  JOB_INVOICE_TYPES,
  selectPrimaryWorkContractForBilling,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import {
  buildManualDepositPaymentLabels,
  formatContractManualDateLabel,
  normalizeContractedAtToIso,
  parseJobContractManual,
  resolveManualDepositGross,
} from "@/lib/job-contract-manual";
import { resolveJobBudgetFromFirestore, resolveJobPaidFromFirestore, roundMoney2 } from "@/lib/vat-calculations";
import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";

export type DepositPaymentStatus =
  | "nezaplaceno"
  | "částečně uhrazeno"
  | "zaplaceno"
  | "—";

export type JobInvoiceForDeposit = {
  id: string;
  type?: string;
  relatedInvoiceId?: string | null;
  amountGross?: unknown;
  paidGrossReceived?: unknown;
  paymentDate?: string | null;
  issueDate?: string | null;
  taxSupplyDate?: string | null;
  documentNumber?: string | null;
  invoiceNumber?: string | null;
  status?: string | null;
};

export type JobIncomeForDeposit = {
  amountGross?: unknown;
  amountNet?: unknown;
  date?: string | null;
  source?: string | null;
  note?: string | null;
  number?: string | null;
};

export type JobDepositSummary = {
  requiredDepositGross: number;
  manualDepositGross: number;
  paymentsDepositGross: number;
  totalDepositPaidGross: number;
  depositRemainingGross: number;
  depositStatus: DepositPaymentStatus;
  paymentDateLabels: string[];
  otherPaymentsLabels: string[];
};

export type JobDepositTimelineEvent = {
  paidAtIso: string | null;
  paidAtLabel: string;
  amountGross: number;
  sourceLabel: string;
};

export function formatMoneyKc(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export function resolveDepositPaymentStatus(
  requiredGross: number,
  receivedGross: number
): DepositPaymentStatus {
  if (requiredGross <= 0.009) return "—";
  if (receivedGross <= 0.009) return "nezaplaceno";
  if (receivedGross >= requiredGross - 0.01) return "zaplaceno";
  return "částečně uhrazeno";
}

function formatPaymentDateLabel(inv: JobInvoiceForDeposit): string {
  const raw =
    String(inv.paymentDate ?? "").trim() ||
    String(inv.taxSupplyDate ?? "").trim() ||
    String(inv.issueDate ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split("-");
    if (y && m && d) return `${Number(d)}. ${Number(m)}. ${y}`;
  }
  return raw;
}

function resolveInvoicePaymentDateIso(inv: JobInvoiceForDeposit): string | null {
  const raw =
    String(inv.paymentDate ?? "").trim() ||
    String(inv.taxSupplyDate ?? "").trim() ||
    String(inv.issueDate ?? "").trim();
  if (!raw) return null;
  return normalizeContractedAtToIso(raw.slice(0, 10)) ?? normalizeContractedAtToIso(raw);
}

function resolveIncomePaymentDateIso(inc: JobIncomeForDeposit): string | null {
  return normalizeContractedAtToIso(String(inc.date ?? "").trim() || null);
}

function resolveRequiredDepositGross(params: {
  job: Record<string, unknown>;
  workContracts: WorkContractLike[];
  budgetGross: number | null;
}): number {
  const manual = parseJobContractManual(params.job);
  if (
    manual.requiredDepositGross != null &&
    Number.isFinite(manual.requiredDepositGross)
  ) {
    return roundMoney2(Math.max(0, manual.requiredDepositGross));
  }
  const primary = selectPrimaryWorkContractForBilling(
    params.workContracts,
    params.budgetGross
  );
  if (primary) {
    return roundMoney2(
      Math.max(0, depositGrossKcFromContract(primary, params.budgetGross))
    );
  }
  return 0;
}

function buildAdvancePaymentLabels(
  invoices: JobInvoiceForDeposit[]
): string[] {
  const labels: string[] = [];
  const advances = invoices.filter(
    (i) => String(i.type ?? "") === JOB_INVOICE_TYPES.ADVANCE
  );
  for (const a of advances) {
    const cap = roundMoney2(Number(a.amountGross) || 0);
    const paidRaw = roundMoney2(Number(a.paidGrossReceived) || 0);
    const paid = cap > 0 ? Math.min(paidRaw, cap) : paidRaw;
    if (paid <= 0.009) continue;
    const no = String(a.invoiceNumber ?? a.documentNumber ?? a.id).trim();
    const st = String(a.status ?? "").trim();
    labels.push(
      `ZF ${no || a.id}: ${formatMoneyKc(paid)}${st ? ` (${st})` : ""}`
    );
  }
  return labels;
}

function sumJobIncomesGross(incomes: JobIncomeForDeposit[]): {
  total: number;
  labels: string[];
} {
  let total = 0;
  const labels: string[] = [];
  for (const inc of incomes) {
    const gross = roundMoney2(Number(inc.amountGross) || 0);
    if (gross <= 0) continue;
    total = roundMoney2(total + gross);
    const date = String(inc.date ?? "").trim();
    const note = String(inc.note ?? inc.number ?? "").trim();
    labels.push(
      date
        ? `Příjem ${formatMoneyKc(gross)} · ${date}${note ? ` · ${note}` : ""}`
        : `Příjem ${formatMoneyKc(gross)}${note ? ` · ${note}` : ""}`
    );
  }
  return { total, labels };
}

/**
 * Společný výpočet zálohy — ruční údaje, zálohové faktury, DD, příjmy u zakázky,
 * soulad s `paidAmountGross` na zakázce (finanční přehled) bez dvojího započtení.
 */
export function calculateJobDepositSummary(params: {
  job: Record<string, unknown>;
  invoices?: JobInvoiceForDeposit[];
  workContracts?: WorkContractDoc[] | WorkContractLike[];
  jobIncomes?: JobIncomeForDeposit[];
}): JobDepositSummary {
  const job = params.job;
  const invoices = params.invoices ?? [];
  const incomes = params.jobIncomes ?? [];

  const manual = parseJobContractManual(job);
  const manualDepositGross = resolveManualDepositGross(manual);
  const manualPaymentLabels = buildManualDepositPaymentLabels(
    manual.manualDepositPayments,
    formatMoneyKc
  );

  const budget = resolveJobBudgetFromFirestore(job);
  const budgetGross = budget?.budgetGross ?? null;

  const contractLikes: WorkContractLike[] = (params.workContracts ?? []).map((c) => ({
    id: String((c as { id?: string }).id ?? ""),
    contractNumber: (c as WorkContractLike).contractNumber,
    depositAmount: (c as WorkContractLike).depositAmount,
    depositPercentage: (c as WorkContractLike).depositPercentage,
    zalohovaCastka: (c as WorkContractLike).zalohovaCastka,
    zalohovaProcenta: (c as WorkContractLike).zalohovaProcenta,
    documentRole: (c as WorkContractLike).documentRole,
  }));

  const requiredDepositGross = resolveRequiredDepositGross({
    job,
    workContracts: contractLikes,
    budgetGross,
  });

  const incomePaid = sumJobIncomesGross(incomes);
  const paymentDateLabels: string[] = [
    ...manualPaymentLabels,
    ...buildAdvancePaymentLabels(invoices),
  ];
  const otherPaymentsLabels: string[] = [];

  for (const inv of invoices) {
    if (String(inv.type ?? "") !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    const gross = roundMoney2(Number(inv.amountGross) || 0);
    if (gross <= 0) continue;
    const related = String(inv.relatedInvoiceId ?? "").trim();
    const advances = invoices.filter(
      (i) => String(i.type ?? "") === JOB_INVOICE_TYPES.ADVANCE
    );
    const advanceIds = new Set(advances.map((a) => a.id));
    const dateLabel = formatPaymentDateLabel(inv);
    const docNo =
      String(inv.documentNumber ?? inv.invoiceNumber ?? "").trim() || inv.id;

    if (related && advanceIds.has(related)) {
      paymentDateLabels.push(
        dateLabel
          ? `DD ${docNo}: ${formatMoneyKc(gross)} · ${dateLabel}`
          : `DD ${docNo}: ${formatMoneyKc(gross)}`
      );
    } else {
      otherPaymentsLabels.push(
        dateLabel
          ? `${docNo}: ${formatMoneyKc(gross)} · ${dateLabel}`
          : `${docNo}: ${formatMoneyKc(gross)}`
      );
    }
  }

  for (const label of incomePaid.labels) {
    paymentDateLabels.push(label);
  }

  const settlement = computeSettlementAmounts({
    budgetGross,
    advanceInvoices: invoices
      .filter((i) => String(i.type ?? "") === JOB_INVOICE_TYPES.ADVANCE)
      .map((a) => ({
        id: a.id,
        type: a.type,
        invoiceNumber: a.invoiceNumber ?? undefined,
        paidGrossReceived: a.paidGrossReceived,
        amountGross: a.amountGross,
      })),
    contractFallback: null,
  });

  let paymentsDepositGross = 0;
  if (settlement.advanceSource === "invoices") {
    paymentsDepositGross = roundMoney2(settlement.totalAdvancePaid);
  }
  paymentsDepositGross = roundMoney2(paymentsDepositGross + incomePaid.total);

  const { paidGross: jobPaidGross } = resolveJobPaidFromFirestore(job);
  const countedSoFar = roundMoney2(manualDepositGross + paymentsDepositGross);
  if (jobPaidGross > countedSoFar + 0.009) {
    const residualCap =
      requiredDepositGross > 0.009
        ? roundMoney2(
            Math.max(0, requiredDepositGross - manualDepositGross - paymentsDepositGross)
          )
        : roundMoney2(jobPaidGross - manualDepositGross - paymentsDepositGross);
    const residual = roundMoney2(
      Math.min(jobPaidGross - manualDepositGross - paymentsDepositGross, residualCap)
    );
    if (residual > 0.009) {
      paymentsDepositGross = roundMoney2(paymentsDepositGross + residual);
      paymentDateLabels.push(
        `Z finančního přehledu zakázky: ${formatMoneyKc(residual)}`
      );
    }
  }

  const totalDepositPaidGross = roundMoney2(
    manualDepositGross + paymentsDepositGross
  );
  const depositRemainingGross = Math.max(
    0,
    roundMoney2(requiredDepositGross - totalDepositPaidGross)
  );

  return {
    requiredDepositGross,
    manualDepositGross,
    paymentsDepositGross,
    totalDepositPaidGross,
    depositRemainingGross,
    depositStatus: resolveDepositPaymentStatus(
      requiredDepositGross,
      totalDepositPaidGross
    ),
    paymentDateLabels,
    otherPaymentsLabels,
  };
}

export function depositStatusLabelCs(status: DepositPaymentStatus): string {
  if (status === "nezaplaceno") return "Nezaplaceno";
  if (status === "částečně uhrazeno") return "Částečně uhrazeno";
  if (status === "zaplaceno") return "Zaplaceno";
  return "—";
}

/** Strukturované položky časové osy záloh (export PDF, mobilní přehled). */
export function collectJobDepositTimelineEvents(params: {
  job: Record<string, unknown>;
  invoices?: JobInvoiceForDeposit[];
  workContracts?: WorkContractDoc[] | WorkContractLike[];
  jobIncomes?: JobIncomeForDeposit[];
}): JobDepositTimelineEvent[] {
  const job = params.job;
  const invoices = params.invoices ?? [];
  const incomes = params.jobIncomes ?? [];
  const events: JobDepositTimelineEvent[] = [];

  const manual = parseJobContractManual(job);
  for (const p of manual.manualDepositPayments ?? []) {
    if (p.amountGross <= 0.009) continue;
    const paidAtIso = normalizeContractedAtToIso(p.paidAt);
    const note = p.note?.trim();
    events.push({
      paidAtIso,
      paidAtLabel: paidAtIso ? formatContractManualDateLabel(paidAtIso) : "—",
      amountGross: p.amountGross,
      sourceLabel: note ? `Ruční platba zálohy · ${note}` : "Ruční platba zálohy",
    });
  }

  const advances = invoices.filter(
    (i) => String(i.type ?? "") === JOB_INVOICE_TYPES.ADVANCE
  );
  for (const a of advances) {
    const cap = roundMoney2(Number(a.amountGross) || 0);
    const paidRaw = roundMoney2(Number(a.paidGrossReceived) || 0);
    const paid = cap > 0 ? Math.min(paidRaw, cap) : paidRaw;
    if (paid <= 0.009) continue;
    const paidAtIso = resolveInvoicePaymentDateIso(a);
    const no = String(a.invoiceNumber ?? a.documentNumber ?? a.id).trim();
    const st = String(a.status ?? "").trim();
    events.push({
      paidAtIso,
      paidAtLabel: paidAtIso ? formatContractManualDateLabel(paidAtIso) : "—",
      amountGross: paid,
      sourceLabel: `Zálohová faktura (ZF ${no || a.id})${st ? ` · ${st}` : ""}`,
    });
  }

  const advanceIds = new Set(advances.map((a) => a.id));
  for (const inv of invoices) {
    if (String(inv.type ?? "") !== JOB_INVOICE_TYPES.TAX_RECEIPT) continue;
    const gross = roundMoney2(Number(inv.amountGross) || 0);
    if (gross <= 0.009) continue;
    const related = String(inv.relatedInvoiceId ?? "").trim();
    if (!related || !advanceIds.has(related)) continue;
    const paidAtIso = resolveInvoicePaymentDateIso(inv);
    const docNo =
      String(inv.documentNumber ?? inv.invoiceNumber ?? "").trim() || inv.id;
    events.push({
      paidAtIso,
      paidAtLabel: paidAtIso ? formatContractManualDateLabel(paidAtIso) : "—",
      amountGross: gross,
      sourceLabel: `Daňový doklad (DD ${docNo})`,
    });
  }

  for (const inc of incomes) {
    const gross = roundMoney2(Number(inc.amountGross) || 0);
    if (gross <= 0.009) continue;
    const paidAtIso = resolveIncomePaymentDateIso(inc);
    const source = String(inc.source ?? "").trim();
    const note = String(inc.note ?? inc.number ?? "").trim();
    const sourceParts = [source, note].filter(Boolean);
    events.push({
      paidAtIso,
      paidAtLabel: paidAtIso ? formatContractManualDateLabel(paidAtIso) : "—",
      amountGross: gross,
      sourceLabel:
        sourceParts.length > 0
          ? `Příjem u zakázky · ${sourceParts.join(" · ")}`
          : "Příjem u zakázky",
    });
  }

  const budget = resolveJobBudgetFromFirestore(job);
  const budgetGross = budget?.budgetGross ?? null;
  const contractLikes: WorkContractLike[] = (params.workContracts ?? []).map((c) => ({
    id: String((c as { id?: string }).id ?? ""),
    contractNumber: (c as WorkContractLike).contractNumber,
    depositAmount: (c as WorkContractLike).depositAmount,
    depositPercentage: (c as WorkContractLike).depositPercentage,
    zalohovaCastka: (c as WorkContractLike).zalohovaCastka,
    zalohovaProcenta: (c as WorkContractLike).zalohovaProcenta,
    documentRole: (c as WorkContractLike).documentRole,
  }));
  const requiredDepositGross = resolveRequiredDepositGross({
    job,
    workContracts: contractLikes,
    budgetGross,
  });
  const manualDepositGross = resolveManualDepositGross(manual);

  const settlement = computeSettlementAmounts({
    budgetGross,
    advanceInvoices: advances.map((a) => ({
      id: a.id,
      type: a.type,
      invoiceNumber: a.invoiceNumber ?? undefined,
      paidGrossReceived: a.paidGrossReceived,
      amountGross: a.amountGross,
    })),
    contractFallback: null,
  });

  let paymentsDepositGross = 0;
  if (settlement.advanceSource === "invoices") {
    paymentsDepositGross = roundMoney2(settlement.totalAdvancePaid);
  }
  const incomeTotal = incomes.reduce((sum, inc) => {
    const gross = roundMoney2(Number(inc.amountGross) || 0);
    return gross > 0 ? roundMoney2(sum + gross) : sum;
  }, 0);
  paymentsDepositGross = roundMoney2(paymentsDepositGross + incomeTotal);

  const { paidGross: jobPaidGross } = resolveJobPaidFromFirestore(job);
  const countedSoFar = roundMoney2(manualDepositGross + paymentsDepositGross);
  if (jobPaidGross > countedSoFar + 0.009) {
    const residualCap =
      requiredDepositGross > 0.009
        ? roundMoney2(
            Math.max(0, requiredDepositGross - manualDepositGross - paymentsDepositGross)
          )
        : roundMoney2(jobPaidGross - manualDepositGross - paymentsDepositGross);
    const residual = roundMoney2(
      Math.min(jobPaidGross - manualDepositGross - paymentsDepositGross, residualCap)
    );
    if (residual > 0.009) {
      events.push({
        paidAtIso: null,
        paidAtLabel: "—",
        amountGross: residual,
        sourceLabel: "Z finančního přehledu zakázky",
      });
    }
  }

  return events;
}
