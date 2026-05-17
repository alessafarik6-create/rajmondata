/**
 * Jednotný finanční souhrn zakázky — záloha + celková úhrada (jako finanční přehled v detailu).
 */

import {
  depositGrossKcFromContract,
  selectPrimaryWorkContractForBilling,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import {
  formatContractManualDateLabel,
  parseJobContractManual,
} from "@/lib/job-contract-manual";
import {
  calculateJobDepositSummary,
  type DepositPaymentStatus,
  type JobIncomeForDeposit,
  type JobInvoiceForDeposit,
} from "@/lib/job-deposit-summary";
import { resolveJobBudgetFromFirestore, resolveJobPaidFromFirestore, roundMoney2 } from "@/lib/vat-calculations";
import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";

export type { DepositPaymentStatus } from "@/lib/job-deposit-summary";
export type { JobIncomeForDeposit, JobInvoiceForDeposit } from "@/lib/job-deposit-summary";

export type JobPaymentSummary = {
  totalPriceGross: number;
  requiredDepositGross: number;
  manualDepositGross: number;
  /** Přijaté platby mimo ruční zálohu (sloupec „Z plateb“). */
  paymentsDepositGross: number;
  /** Celkem zaplaceno — ruční záloha + platby / doklady / paidAmountGross (bez dvojího započtení). */
  totalPaidGross: number;
  /** Cena − celkem zaplaceno (doplatek celé zakázky). */
  remainingToPayGross: number;
  depositRemainingGross: number;
  depositStatus: DepositPaymentStatus;
  jobPaymentStatus: DepositPaymentStatus;
  paymentDateLabels: string[];
  otherPaymentsLabels: string[];
  depositNote: string | null;
  isContracted: boolean;
  contractedDisplayValue: string;
};

export function formatMoneyKc(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

/** Stav zálohy — „Zaplaceno“ jen při úhradě celé zakázky, jinak „Částečně uhrazeno“. */
export function resolveDepositPaymentStatus(
  totalPriceGross: number,
  totalPaidGross: number,
  requiredDepositGross: number,
  depositPaidGross: number
): DepositPaymentStatus {
  if (requiredDepositGross <= 0.009 && depositPaidGross <= 0.009) return "—";
  if (depositPaidGross <= 0.009) return "nezaplaceno";
  if (
    totalPriceGross > 0.009 &&
    totalPaidGross >= totalPriceGross - 0.01
  ) {
    return "zaplaceno";
  }
  return "částečně uhrazeno";
}

/** Stav zakázky podle celkové ceny vs. celkem zaplaceno. */
export function resolveJobPaymentStatus(
  totalPriceGross: number,
  totalPaidGross: number
): DepositPaymentStatus {
  if (totalPriceGross <= 0.009) {
    return totalPaidGross > 0.009 ? "částečně uhrazeno" : "—";
  }
  if (totalPaidGross <= 0.009) return "nezaplaceno";
  if (totalPaidGross >= totalPriceGross - 0.01) return "zaplaceno";
  return "částečně uhrazeno";
}

/** @deprecated použijte {@link resolveJobPaymentStatus} nebo {@link resolveDepositPaymentStatus} */
export function resolvePaymentStatus(
  requiredGross: number,
  paidGross: number
): DepositPaymentStatus {
  return resolveDepositPaymentStatus(requiredGross, paidGross, requiredGross, paidGross);
}

export function paymentStatusLabelCs(status: DepositPaymentStatus): string {
  if (status === "nezaplaceno") return "Nezaplaceno";
  if (status === "částečně uhrazeno") return "Částečně uhrazeno";
  if (status === "zaplaceno") return "Zaplaceno";
  return "—";
}

export function resolveContractedDisplayValue(
  job: Record<string, unknown>,
  options?: { fallbackDateLabel?: string; isContracted?: boolean }
): string {
  const manual = parseJobContractManual(job);
  const manualDate = manual.contractedAt
    ? formatContractManualDateLabel(manual.contractedAt)
    : "";
  if (manualDate) return manualDate;
  if (manual.isContracted === true) return "ANO";

  const fb = String(options?.fallbackDateLabel ?? "").trim();
  if (fb && fb !== "—") return fb;

  if (options?.isContracted === true) return "ANO";
  return "NE";
}

function resolveTotalPriceGross(
  job: Record<string, unknown>,
  budgetGross: number | null
): number {
  const manual = parseJobContractManual(job);
  if (manual.totalPriceGross != null && Number.isFinite(manual.totalPriceGross)) {
    return roundMoney2(Math.max(0, manual.totalPriceGross));
  }
  if (budgetGross != null && Number.isFinite(budgetGross)) {
    return roundMoney2(Math.max(0, budgetGross));
  }
  return 0;
}

/**
 * Společný výpočet pro detail zakázky, kartu Smlouva a záloha a export PDF.
 */
export function calculateJobPaymentSummary(params: {
  job: Record<string, unknown>;
  invoices?: JobInvoiceForDeposit[];
  workContracts?: Array<WorkContractDoc | WorkContractLike>;
  jobIncomes?: JobIncomeForDeposit[];
  /** Datum zesmluvnění ze smlouvy (fallback pro contractedDisplayValue). */
  contractedDateFallback?: string;
  isContracted?: boolean;
}): JobPaymentSummary {
  const job = params.job;
  const invoices = params.invoices ?? [];
  const workContracts = params.workContracts ?? [];
  const jobIncomes = params.jobIncomes ?? [];

  const budget = resolveJobBudgetFromFirestore(job);
  const budgetGross = budget?.budgetGross ?? null;
  const manual = parseJobContractManual(job);
  const totalPriceGross = resolveTotalPriceGross(job, budgetGross);

  const deposit = calculateJobDepositSummary({
    job,
    invoices,
    workContracts,
    jobIncomes,
  });

  const { paidGross: jobPaidGross } = resolveJobPaidFromFirestore(job);
  const totalPaidGross = roundMoney2(
    Math.max(jobPaidGross, deposit.totalDepositPaidGross)
  );

  const paymentsDepositGross = roundMoney2(
    Math.max(0, totalPaidGross - deposit.manualDepositGross)
  );

  const remainingToPayGross = Math.max(
    0,
    roundMoney2(totalPriceGross - totalPaidGross)
  );

  const depositStatus = resolveDepositPaymentStatus(
    totalPriceGross,
    totalPaidGross,
    deposit.requiredDepositGross,
    deposit.totalDepositPaidGross
  );

  const jobPaymentStatus = resolveJobPaymentStatus(
    totalPriceGross,
    totalPaidGross
  );

  const isContracted = params.isContracted === true;
  const contractedDisplayValue = resolveContractedDisplayValue(job, {
    fallbackDateLabel: params.contractedDateFallback,
    isContracted,
  });

  return {
    totalPriceGross,
    requiredDepositGross: deposit.requiredDepositGross,
    manualDepositGross: deposit.manualDepositGross,
    paymentsDepositGross,
    totalPaidGross,
    remainingToPayGross,
    depositRemainingGross: deposit.depositRemainingGross,
    depositStatus,
    jobPaymentStatus,
    paymentDateLabels: deposit.paymentDateLabels,
    otherPaymentsLabels: deposit.otherPaymentsLabels,
    depositNote: manual.depositNote ?? null,
    isContracted,
    contractedDisplayValue,
  };
}

/** @deprecated alias */
export const calculateJobDepositSummaryFromPayment = calculateJobPaymentSummary;

export function resolveRequiredDepositForDisplay(
  job: Record<string, unknown>,
  workContracts: WorkContractLike[],
  budgetGross: number | null
): number {
  const manual = parseJobContractManual(job);
  if (
    manual.requiredDepositGross != null &&
    Number.isFinite(manual.requiredDepositGross)
  ) {
    return roundMoney2(Math.max(0, manual.requiredDepositGross));
  }
  const primary = selectPrimaryWorkContractForBilling(workContracts, budgetGross);
  if (primary) {
    return roundMoney2(Math.max(0, depositGrossKcFromContract(primary, budgetGross)));
  }
  return 0;
}

export { calculateJobDepositSummary } from "@/lib/job-deposit-summary";
