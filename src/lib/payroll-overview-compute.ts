import {
  firestoreEmployeeIdMatches,
  type EmployeeLite,
} from "@/lib/attendance-overview-compute";
import {
  getPayableHours,
  moneyForBlock,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";
import { dateStrInInclusiveRange } from "@/lib/payroll-period";

export type PayrollOverviewEmployeeRow = {
  employeeId: string;
  displayName: string;
  hourlyRate: number;
  hoursTotal: number;
  calculatedKc: number;
};

function toEmployeeLite(e: Record<string, unknown>): EmployeeLite {
  const id = String(e?.id ?? "").trim();
  const fn = String(e?.firstName ?? "").trim();
  const ln = String(e?.lastName ?? "").trim();
  const au = e?.authUserId;
  return {
    id,
    displayName: [fn, ln].filter(Boolean).join(" ").trim() || String(e?.email ?? id),
    hourlyRate: Number(e?.hourlyRate) || 0,
    authUserId:
      typeof au === "string" && au.trim() ? au.trim() : undefined,
  };
}

/**
 * Souhrn za období pro všechny zaměstnance (bloky + schválené denní výkazy).
 */
export function buildPayrollOverviewRows(
  employees: Array<Record<string, unknown>>,
  blocks: WorkTimeBlockMoney[],
  dailyReports: Record<string, unknown>[],
  startStr: string,
  endStr: string
): PayrollOverviewEmployeeRow[] {
  const rows: PayrollOverviewEmployeeRow[] = [];
  for (const raw of employees) {
    const emp = toEmployeeLite(raw);
    if (!emp.id) continue;
    const rate = Number(emp.hourlyRate) || 0;

    const empBlocks = blocks.filter((b) =>
      firestoreEmployeeIdMatches(b.employeeId, emp)
    );
    let hours = 0;
    for (const b of empBlocks) {
      hours += getPayableHours(b);
    }

    const empDaily: DailyWorkReportMoney[] = [];
    for (const r of dailyReports) {
      if (!firestoreEmployeeIdMatches(r?.employeeId, emp)) continue;
      const dk = String(r?.date ?? "").trim().slice(0, 10);
      if (!dateStrInInclusiveRange(dk, startStr, endStr)) continue;
      empDaily.push({
        status: String(r?.status ?? ""),
        payableAmountCzk: Number(r?.payableAmountCzk),
      });
      const hRaw =
        r?.hoursConfirmed ?? r?.hoursFromAttendance ?? r?.hoursSum ?? 0;
      const h = Number(hRaw);
      if (
        String(r?.status ?? "") === "approved" &&
        Number.isFinite(h) &&
        h > 0
      ) {
        hours += Math.round(h * 100) / 100;
      }
    }

    const fromBlocks = empBlocks.reduce(
      (s, b) => s + moneyForBlock(b, rate),
      0
    );
    const fromDaily = sumMoneyForApprovedDailyReports(empDaily);
    const calculatedKc =
      Math.round((fromBlocks + fromDaily) * 100) / 100;

    rows.push({
      employeeId: emp.id,
      displayName: emp.displayName,
      hourlyRate: rate,
      hoursTotal: Math.round(hours * 100) / 100,
      calculatedKc,
    });
  }
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName, "cs"));
  return rows;
}
