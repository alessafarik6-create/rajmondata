/**
 * Agregace dat pro sekci Reporty / Analytika — pouze z jedné organizace (companyId).
 */

import {
  summarizeAttendanceByDay,
  type AttendanceRow,
  attendanceRowCalendarDateKey,
} from "@/lib/employee-attendance";
import {
  resolveExpenseAmounts,
  resolveJobBudgetFromFirestore,
} from "@/lib/vat-calculations";

export type ReportTab = "overview" | "employees" | "jobs" | "financials";

export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  overview: "Přehled",
  employees: "Zaměstnanci",
  jobs: "Zakázky",
  financials: "Finance",
};

export const MONTH_NAMES_CS = [
  "Leden",
  "Únor",
  "Březen",
  "Duben",
  "Květen",
  "Červen",
  "Červenec",
  "Srpen",
  "Září",
  "Říjen",
  "Listopad",
  "Prosinec",
];

export const ROLE_LABEL_CS: Record<string, string> = {
  owner: "Majitel",
  admin: "Administrátor",
  manager: "Manažer",
  employee: "Zaměstnanec",
  orgAdmin: "Administrátor organizace",
  accountant: "Účetní",
  customer: "Zákazník",
};

const PIE_FILLS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "#64748b",
  "#fb923c",
  "#22c55e",
  "#a855f7",
];

export type DocumentCostCategoryKey = "material" | "work" | "transport" | "other";

export function parseRecordDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t);
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    return (raw as { toDate: () => Date }).toDate();
  }
  return null;
}

export function isReceivedFinanceDoc(d: { type?: string; documentKind?: string }) {
  return d.type === "received" || d.documentKind === "prijate";
}

export function isIssuedFinanceDoc(d: { type?: string; documentKind?: string }) {
  return (
    d.type === "issued" ||
    d.type === "vydane" ||
    d.documentKind === "vydane"
  );
}

export function normalizeDocumentCostCategoryKey(row: Record<string, unknown>): DocumentCostCategoryKey {
  const raw =
    row.costCategory ?? row.expenseCategory;
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "material" || s === "materiál") return "material";
  if (s === "work" || s === "práce" || s === "prace" || s === "labor") return "work";
  if (s === "transport" || s === "doprava" || s === "shipping") return "transport";
  return "other";
}

export function costCategoryLabelCs(key: DocumentCostCategoryKey): string {
  switch (key) {
    case "material":
      return "Materiál";
    case "work":
      return "Práce";
    case "transport":
      return "Doprava";
    default:
      return "Ostatní";
  }
}

export function formatReportCurrency(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0 Kč";
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

export function formatReportDate(d: Date): string {
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function computeMarginPct(revenue: number, profit: number): number | null {
  if (revenue <= 0) return null;
  return (profit / revenue) * 100;
}

type FinanceRow = {
  type?: string;
  amount?: unknown;
  date?: unknown;
  description?: string;
};

type DocumentRow = Record<string, unknown> & {
  type?: string;
  documentKind?: string;
  date?: string;
};

type JobRow = Record<string, unknown> & {
  id?: string;
  name?: string;
  status?: string;
  budget?: unknown;
  profit?: unknown;
};

type EmployeeRow = {
  id?: string;
  name?: string;
  displayName?: string;
  fullName?: string;
  role?: string;
};

export type OrganizationReportsInput = {
  financeRecords: FinanceRow[];
  documents: DocumentRow[];
  jobs: JobRow[];
  employees: EmployeeRow[];
  attendanceRows: AttendanceRow[];
  year?: number;
};

export type MonthlyFinancePoint = {
  name: string;
  revenue: number;
  costs: number;
};

export type PiePoint = {
  name: string;
  value: number;
  fill: string;
};

export type EmployeeHoursRow = {
  employeeId: string;
  name: string;
  role: string;
  hours: number;
};

export type OrganizationReportsData = {
  year: number;
  overview: {
    ytdRevenue: number;
    ytdCosts: number;
    ytdProfit: number;
    marginPct: number | null;
    monthlyBarData: MonthlyFinancePoint[];
    activeJobsCount: number;
    completedJobsCount: number;
    unfacturedJobsCount: number;
    avgJobBudget: number | null;
    hasMonthlyChart: boolean;
  };
  employees: {
    totalCount: number;
    rolePieData: PiePoint[];
    hoursByMonth: { name: string; hours: number }[];
    hoursByEmployee: EmployeeHoursRow[];
    totalHoursYtd: number;
    hasRoleChart: boolean;
    hasHoursChart: boolean;
  };
  jobs: {
    activeCount: number;
    completedCount: number;
    unfacturedCount: number;
    avgBudget: number | null;
    jobProfitChart: { name: string; profit: number }[];
    statusBreakdown: { name: string; count: number }[];
    hasProfitChart: boolean;
    hasStatusBreakdown: boolean;
  };
  financials: {
    ytdRevenue: number;
    ytdCosts: number;
    ytdProfit: number;
    marginPct: number | null;
    expenseStructure: PiePoint[];
    activeJobsCount: number;
    completedJobsCount: number;
    unfacturedJobsCount: number;
    avgJobBudget: number | null;
    monthlyBarData: MonthlyFinancePoint[];
    hasExpenseChart: boolean;
    hasMonthlyChart: boolean;
  };
  hasAnyData: boolean;
};

function isActiveJobStatus(status: string | undefined): boolean {
  return status !== "dokončená" && status !== "fakturována";
}

function isCompletedJobStatus(status: string | undefined): boolean {
  return status === "dokončená" || status === "fakturována";
}

function isUnfacturedJobStatus(status: string | undefined): boolean {
  return status === "dokončená";
}

function employeeDisplayName(e: EmployeeRow): string {
  return (
    String(e.displayName ?? e.fullName ?? e.name ?? "").trim() || "Zaměstnanec"
  );
}

function computeYtdFinance(
  financeRecords: FinanceRow[],
  year: number
): { revenue: number; costs: number; monthly: Record<number, { revenue: number; costs: number }> } {
  let revenue = 0;
  let costs = 0;
  const monthly: Record<number, { revenue: number; costs: number }> = {};

  for (const r of financeRecords) {
    const dt = parseRecordDate(r.date);
    if (!dt || dt.getFullYear() !== year) continue;
    const amt = Number(r.amount) || 0;
    const mi = dt.getMonth();
    if (!monthly[mi]) monthly[mi] = { revenue: 0, costs: 0 };
    if (r.type === "revenue") {
      revenue += amt;
      monthly[mi].revenue += amt;
    } else if (r.type === "expense") {
      costs += amt;
      monthly[mi].costs += amt;
    }
  }

  return { revenue, costs, monthly };
}

function monthlyToBarData(
  monthly: Record<number, { revenue: number; costs: number }>
): MonthlyFinancePoint[] {
  return Object.keys(monthly)
    .map(Number)
    .sort((a, b) => a - b)
    .map((mi) => ({
      name: MONTH_NAMES_CS[mi],
      revenue: monthly[mi].revenue,
      costs: monthly[mi].costs,
    }));
}

function computeExpenseStructureYtd(
  documents: DocumentRow[],
  year: number
): PiePoint[] {
  const buckets: Record<DocumentCostCategoryKey, number> = {
    material: 0,
    work: 0,
    transport: 0,
    other: 0,
  };

  for (const d of documents) {
    if (!isReceivedFinanceDoc(d)) continue;
    const dt = parseRecordDate(d.date);
    if (!dt || dt.getFullYear() !== year) continue;
    const amounts = resolveExpenseAmounts(
      d as Parameters<typeof resolveExpenseAmounts>[0]
    );
    if (amounts.amountGross <= 0) continue;
    const cat = normalizeDocumentCostCategoryKey(d);
    buckets[cat] += amounts.amountGross;
  }

  return (Object.keys(buckets) as DocumentCostCategoryKey[])
    .filter((k) => buckets[k] > 0)
    .map((k, i) => ({
      name: costCategoryLabelCs(k),
      value: buckets[k],
      fill: PIE_FILLS[i % PIE_FILLS.length],
    }));
}

function computeJobMetrics(jobs: JobRow[]) {
  let activeCount = 0;
  let completedCount = 0;
  let unfacturedCount = 0;
  const budgets: number[] = [];
  const statusCounts: Record<string, number> = {};
  const jobProfitChart: { name: string; profit: number }[] = [];

  for (const j of jobs) {
    const status = j.status?.trim() || "Neuvedeno";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (isActiveJobStatus(j.status)) activeCount += 1;
    if (isCompletedJobStatus(j.status)) completedCount += 1;
    if (isUnfacturedJobStatus(j.status)) unfacturedCount += 1;

    const bd = resolveJobBudgetFromFirestore(j);
    if (bd && bd.budgetGross > 0) budgets.push(bd.budgetGross);

    if (typeof j.profit === "number" && Number.isFinite(j.profit)) {
      jobProfitChart.push({
        name: String(j.name ?? "Zakázka").trim() || "Zakázka",
        profit: j.profit,
      });
    }
  }

  jobProfitChart.sort((a, b) => b.profit - a.profit);

  const avgBudget =
    budgets.length > 0
      ? budgets.reduce((s, v) => s + v, 0) / budgets.length
      : null;

  const statusBreakdown = Object.entries(statusCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    activeCount,
    completedCount,
    unfacturedCount,
    avgBudget,
    jobProfitChart,
    statusBreakdown,
  };
}

function computeEmployeeReports(
  employees: EmployeeRow[],
  attendanceRows: AttendanceRow[],
  year: number
) {
  const roleCounts: Record<string, number> = {};
  for (const e of employees) {
    const r = e.role || "employee";
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  }

  const rolePieData = Object.entries(roleCounts).map(([role, value], i) => ({
    name: ROLE_LABEL_CS[role] ?? role,
    value,
    fill: PIE_FILLS[i % PIE_FILLS.length],
  }));

  const yearPrefix = `${year}-`;
  const rowsInYear = attendanceRows.filter((r) => {
    const key = attendanceRowCalendarDateKey(r);
    return key.startsWith(yearPrefix);
  });

  const summaries = summarizeAttendanceByDay(rowsInYear);
  const hoursByMonthBuckets: Record<number, number> = {};
  let totalHoursYtd = 0;

  for (const s of summaries) {
    const h = s.hoursWorked;
    if (h == null || !Number.isFinite(h) || h <= 0) continue;
    totalHoursYtd += h;
    const mi = Number(s.date.slice(5, 7)) - 1;
    if (mi >= 0 && mi < 12) {
      hoursByMonthBuckets[mi] = (hoursByMonthBuckets[mi] || 0) + h;
    }
  }

  const employeeById = new Map<string, EmployeeRow>();
  for (const e of employees) {
    if (e.id) employeeById.set(e.id, e);
  }

  const hoursByEmployee: EmployeeHoursRow[] = [];
  const seenEmployeeIds = new Set<string>(
    [
      ...employees.map((e) => e.id).filter(Boolean) as string[],
      ...rowsInYear.map((r) => r.employeeId).filter(Boolean) as string[],
    ]
  );

  for (const employeeId of seenEmployeeIds) {
    const empRows = rowsInYear.filter((r) => r.employeeId === employeeId);
    if (!empRows.length) continue;
    const empSummaries = summarizeAttendanceByDay(empRows, { employeeId });
    let hours = 0;
    for (const s of empSummaries) {
      if (s.hoursWorked != null && s.hoursWorked > 0) hours += s.hoursWorked;
    }
    if (hours <= 0) continue;
    const e = employeeById.get(employeeId);
    hoursByEmployee.push({
      employeeId,
      name: e ? employeeDisplayName(e) : employeeId,
      role: ROLE_LABEL_CS[e?.role ?? "employee"] ?? e?.role ?? "—",
      hours: Math.round(hours * 100) / 100,
    });
  }
  hoursByEmployee.sort((a, b) => b.hours - a.hours);

  const hoursByMonth = Object.keys(hoursByMonthBuckets)
    .map(Number)
    .sort((a, b) => a - b)
    .map((mi) => ({
      name: MONTH_NAMES_CS[mi],
      hours: Math.round(hoursByMonthBuckets[mi] * 100) / 100,
    }));

  return {
    totalCount: employees.length,
    rolePieData,
    hoursByMonth,
    hoursByEmployee,
    totalHoursYtd: Math.round(totalHoursYtd * 100) / 100,
    hasRoleChart: rolePieData.length > 0,
    hasHoursChart: hoursByMonth.some((m) => m.hours > 0),
  };
}

export function computeOrganizationReports(
  input: OrganizationReportsInput
): OrganizationReportsData {
  const year = input.year ?? new Date().getFullYear();
  const finance = computeYtdFinance(input.financeRecords, year);
  const ytdProfit = finance.revenue - finance.costs;
  const marginPct = computeMarginPct(finance.revenue, ytdProfit);
  const monthlyBarData = monthlyToBarData(finance.monthly);

  const jobMetrics = computeJobMetrics(input.jobs);
  const expenseStructure = computeExpenseStructureYtd(input.documents, year);
  const employees = computeEmployeeReports(
    input.employees,
    input.attendanceRows,
    year
  );

  const hasAnyData =
    input.financeRecords.length > 0 ||
    input.documents.length > 0 ||
    input.jobs.length > 0 ||
    input.employees.length > 0 ||
    input.attendanceRows.length > 0;

  return {
    year,
    overview: {
      ytdRevenue: finance.revenue,
      ytdCosts: finance.costs,
      ytdProfit,
      marginPct,
      monthlyBarData,
      activeJobsCount: jobMetrics.activeCount,
      completedJobsCount: jobMetrics.completedCount,
      unfacturedJobsCount: jobMetrics.unfacturedCount,
      avgJobBudget: jobMetrics.avgBudget,
      hasMonthlyChart: monthlyBarData.length > 0,
    },
    employees,
    jobs: {
      activeCount: jobMetrics.activeCount,
      completedCount: jobMetrics.completedCount,
      unfacturedCount: jobMetrics.unfacturedCount,
      avgBudget: jobMetrics.avgBudget,
      jobProfitChart: jobMetrics.jobProfitChart,
      statusBreakdown: jobMetrics.statusBreakdown,
      hasProfitChart: jobMetrics.jobProfitChart.length > 0,
      hasStatusBreakdown: jobMetrics.statusBreakdown.length > 0,
    },
    financials: {
      ytdRevenue: finance.revenue,
      ytdCosts: finance.costs,
      ytdProfit,
      marginPct,
      expenseStructure,
      activeJobsCount: jobMetrics.activeCount,
      completedJobsCount: jobMetrics.completedCount,
      unfacturedJobsCount: jobMetrics.unfacturedCount,
      avgJobBudget: jobMetrics.avgBudget,
      monthlyBarData,
      hasExpenseChart: expenseStructure.length > 0,
      hasMonthlyChart: monthlyBarData.length > 0,
    },
    hasAnyData,
  };
}
