/**
 * Souhrn výplaty zaměstnance za období — hodiny, mzda, zálohy (z reálných záznamů).
 */

import { dateStrInInclusiveRange } from "@/lib/payroll-period";
import {
  getLoggedHours,
  getPayableHours,
  moneyForBlock,
  sumMoneyForApprovedDailyReports,
  sumPaidAdvances,
  type AdvanceDoc,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";

export type PayrollEmployeeSummary = {
  blocksTotalLoggedHours: number;
  blocksPayableHours: number;
  blocksPendingLoggedHours: number;
  blocksRejectedLoggedHours: number;
  dailyApprovedHours: number;
  dailyOtherHours: number;
  dailyApprovedKc: number;
  dailyPendingEstimateKc: number;
  blocksApprovedKc: number;
  blocksUnapprovedEstimateKc: number;
  grossApprovedKc: number;
  grossWithPendingEstimateKc: number;
  advancesInPeriod: AdvanceDoc[];
  advancesPaidTotalKc: number;
  netAfterAdvancesKc: number;
};

function dailyReportHours(row: Record<string, unknown>): number {
  const h = Number(
    row?.hoursConfirmed ?? row?.hoursFromAttendance ?? row?.hoursSum ?? 0
  );
  return Number.isFinite(h) && h > 0 ? Math.round(h * 100) / 100 : 0;
}

function dailyReportStatus(row: Record<string, unknown>): string {
  return String(row?.status ?? "").trim();
}

/**
 * Zálohy s datem v uzavřeném intervalu YYYY-MM-DD.
 */
export function filterAdvancesInPeriod(
  advances: AdvanceDoc[],
  startStr: string,
  endStr: string
): AdvanceDoc[] {
  return advances.filter((a) =>
    dateStrInInclusiveRange(String(a.date ?? "").slice(0, 10), startStr, endStr)
  );
}

export function computePayrollEmployeeSummary(params: {
  blocks: WorkTimeBlockMoney[];
  dailyReports: Record<string, unknown>[];
  advancesForEmployee: AdvanceDoc[];
  periodStartStr: string;
  periodEndStr: string;
  hourlyRate: number;
}): PayrollEmployeeSummary {
  const {
    blocks,
    dailyReports,
    advancesForEmployee,
    periodStartStr,
    periodEndStr,
    hourlyRate,
  } = params;
  const rate = Number(hourlyRate);
  const rateOk = Number.isFinite(rate) && rate > 0;

  let blocksTotalLoggedHours = 0;
  let blocksPayableHours = 0;
  let blocksPendingLoggedHours = 0;
  let blocksRejectedLoggedHours = 0;
  let blocksApprovedKc = 0;
  let blocksUnapprovedEstimateKc = 0;

  for (const b of blocks) {
    const logged = getLoggedHours(b);
    const payable = getPayableHours(b);
    const st = String(b.reviewStatus ?? "");

    blocksTotalLoggedHours += logged;
    blocksPayableHours += payable;
    blocksApprovedKc += moneyForBlock(b, rate);

    if (st === "pending") {
      blocksPendingLoggedHours += logged;
      if (rateOk && logged > 0) {
        blocksUnapprovedEstimateKc += Math.round(logged * rate * 100) / 100;
      }
    } else if (st === "rejected") {
      blocksRejectedLoggedHours += logged;
    }
  }

  blocksTotalLoggedHours = Math.round(blocksTotalLoggedHours * 100) / 100;
  blocksPayableHours = Math.round(blocksPayableHours * 100) / 100;
  blocksPendingLoggedHours = Math.round(blocksPendingLoggedHours * 100) / 100;
  blocksRejectedLoggedHours = Math.round(blocksRejectedLoggedHours * 100) / 100;
  blocksApprovedKc = Math.round(blocksApprovedKc * 100) / 100;
  blocksUnapprovedEstimateKc = Math.round(blocksUnapprovedEstimateKc * 100) / 100;

  let dailyApprovedHours = 0;
  let dailyOtherHours = 0;
  const dailyMoneyRows: DailyWorkReportMoney[] = [];
  let dailyPendingEstimateKc = 0;

  for (const r of dailyReports) {
    const dk = String(r?.date ?? "").trim().slice(0, 10);
    if (!dateStrInInclusiveRange(dk, periodStartStr, periodEndStr)) continue;
    const h = dailyReportHours(r);
    const st = dailyReportStatus(r);
    if (st === "approved") {
      dailyApprovedHours += h;
      dailyMoneyRows.push({
        status: "approved",
        payableAmountCzk: Number(r?.payableAmountCzk),
      });
    } else if (h > 0) {
      dailyOtherHours += h;
      if (rateOk) {
        dailyPendingEstimateKc += Math.round(h * rate * 100) / 100;
      }
    }
  }

  dailyApprovedHours = Math.round(dailyApprovedHours * 100) / 100;
  dailyOtherHours = Math.round(dailyOtherHours * 100) / 100;
  const dailyApprovedKc = sumMoneyForApprovedDailyReports(dailyMoneyRows);
  dailyPendingEstimateKc = Math.round(dailyPendingEstimateKc * 100) / 100;

  const grossApprovedKc =
    Math.round((blocksApprovedKc + dailyApprovedKc) * 100) / 100;
  const grossWithPendingEstimateKc =
    Math.round(
      (grossApprovedKc + blocksUnapprovedEstimateKc + dailyPendingEstimateKc) *
        100
    ) / 100;

  const advancesInPeriod = filterAdvancesInPeriod(
    advancesForEmployee,
    periodStartStr,
    periodEndStr
  );
  const advancesPaidTotalKc = sumPaidAdvances(advancesInPeriod);
  const netAfterAdvancesKc = Math.max(
    0,
    Math.round((grossApprovedKc - advancesPaidTotalKc) * 100) / 100
  );

  return {
    blocksTotalLoggedHours,
    blocksPayableHours,
    blocksPendingLoggedHours,
    blocksRejectedLoggedHours,
    dailyApprovedHours,
    dailyOtherHours,
    dailyApprovedKc,
    dailyPendingEstimateKc,
    blocksApprovedKc,
    blocksUnapprovedEstimateKc,
    grossApprovedKc,
    grossWithPendingEstimateKc,
    advancesInPeriod,
    advancesPaidTotalKc,
    netAfterAdvancesKc,
  };
}
