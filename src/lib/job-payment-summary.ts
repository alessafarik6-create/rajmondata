/**
 * Jednotný finanční souhrn zakázky — záloha + celková úhrada (jako finanční přehled v detailu).
 */

import {
  depositGrossKcFromContract,
  selectPrimaryWorkContractForBilling,
  type WorkContractLike,
} from "@/lib/job-billing-invoices";
import { parseJobContractManual } from "@/lib/job-contract-manual";
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
  /** Přijaté platby mimo ruční zálohu (pro sloupec „Z plateb“). */
  paymentsDepositGross: number;
  /** Celkem zaplaceno na zakázce — stejný zdroj jako finanční přehled (`paidAmountGross`). */
  totalPaidGross: number;
  /** Cena − celkem zaplaceno (doplatek celé zakázky). */
  remainingToPayGross: number;
  depositRemainingGross: number;
  depositStatus: DepositPaymentStatus;
  jobPaymentStatus: DepositPaymentStatus;
  paymentDateLabels: string[];
  otherPaymentsLabels: string[];
  depositNote: string | null;
};

export function formatMoneyKc(value: number): string {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export function resolvePaymentStatus(
  requiredGross: number,
  paidGross: number
): DepositPaymentStatus {
  if (requiredGross <= 0.009) return "—";
  if (paidGross <= 0.009) return "nezaplaceno";
  if (paidGross >= requiredGross - 0.01) return "zaplaceno";
  return "částečně zaplaceno";
}

export function paymentStatusLabelCs(status: DepositPaymentStatus): string {
  if (status === "nezaplaceno") return "Nezaplaceno";
  if (status === "částečně zaplaceno") return "Částečně zaplaceno";
  if (status === "zaplaceno") return "Zaplaceno";
  return "—";
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

function toContractLikes(
  workContracts: Array<WorkContractDoc | WorkContractLike>
): WorkContractLike[] {
  return workContracts.map((c) => ({
    id: String((c as { id?: string }).id ?? ""),
    contractNumber: (c as WorkContractLike).contractNumber,
    depositAmount: (c as WorkContractLike).depositAmount,
    depositPercentage: (c as WorkContractLike).depositPercentage,
    zalohovaCastka: (c as WorkContractLike).zalohovaCastka,
    zalohovaProcenta: (c as WorkContractLike).zalohovaProcenta,
    documentRole: (c as WorkContractLike).documentRole,
  }));
}

/**
 * Společný výpočet pro detail zakázky, kartu Smlouva a záloha a export PDF.
 */
export function calculateJobPaymentSummary(params: {
  job: Record<string, unknown>;
  invoices?: JobInvoiceForDeposit[];
  workContracts?: Array<WorkContractDoc | WorkContractLike>;
  /** Příjmy / platby u zakázky (`jobs/{id}/incomes`). */
  jobIncomes?: JobIncomeForDeposit[];
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

  const { paidGross: totalPaidGross } = resolveJobPaidFromFirestore(job);

  const paymentsDepositGross = roundMoney2(
    Math.max(0, totalPaidGross - deposit.manualDepositGross)
  );

  const remainingToPayGross = Math.max(
    0,
    roundMoney2(totalPriceGross - totalPaidGross)
  );

  return {
    totalPriceGross,
    requiredDepositGross: deposit.requiredDepositGross,
    manualDepositGross: deposit.manualDepositGross,
    paymentsDepositGross,
    totalPaidGross,
    remainingToPayGross,
    depositRemainingGross: deposit.depositRemainingGross,
    depositStatus: resolvePaymentStatus(
      deposit.requiredDepositGross,
      deposit.totalDepositPaidGross
    ),
    jobPaymentStatus: resolvePaymentStatus(totalPriceGross, totalPaidGross),
    paymentDateLabels: deposit.paymentDateLabels,
    otherPaymentsLabels: deposit.otherPaymentsLabels,
    depositNote: manual.depositNote ?? null,
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
