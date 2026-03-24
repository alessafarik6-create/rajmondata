/**
 * Agregace dat pro přehled docházky (admin): období, řádky tabulky, výdělky.
 */

import {
  endOfMonth,
  endOfWeek,
  format,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { cs } from "date-fns/locale";
import type { AttendanceRow } from "@/lib/employee-attendance";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";
import {
  formatKc,
  getLoggedHours,
  moneyForBlock,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";

export type PeriodMode = "day" | "week" | "month";

export type PeriodRange = { start: Date; end: Date; label: string };

export function computePeriodRange(
  mode: PeriodMode,
  anchor: Date
): PeriodRange {
  if (mode === "day") {
    const d = new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      anchor.getDate()
    );
    return {
      start: d,
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
      label: format(d, "d. M. yyyy", { locale: cs }),
    };
  }
  if (mode === "week") {
    const start = startOfWeek(anchor, { weekStartsOn: 1, locale: cs });
    const end = endOfWeek(anchor, { weekStartsOn: 1, locale: cs });
    return {
      start,
      end,
      label: `${format(start, "d. M.", { locale: cs })} – ${format(end, "d. M. yyyy", { locale: cs })}`,
    };
  }
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  return {
    start,
    end,
    label: format(start, "LLLL yyyy", { locale: cs }),
  };
}

export function dateInRange(isoDate: string, range: PeriodRange): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isWithinInterval(dt, { start: range.start, end: range.end });
}

export type EmployeeLite = {
  id: string;
  displayName: string;
  hourlyRate: number;
  /** Firebase Auth UID — docházka z webu často ukládá `employeeId` = UID místo id dokumentu zaměstnance. */
  authUserId?: string | null;
};

function parseHourlyRate(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function buildEmployeeMap(
  raw: Record<string, unknown>[]
): Map<string, EmployeeLite> {
  const m = new Map<string, EmployeeLite>();
  for (const row of raw) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    const first = String(row?.firstName ?? row?.first_name ?? "").trim();
    const last = String(row?.lastName ?? row?.last_name ?? "").trim();
    const fallback = String(row?.name ?? row?.email ?? id).trim();
    const displayName =
      [first, last].filter(Boolean).join(" ").trim() || fallback;
    const authRaw = row?.authUserId;
    const authUserId =
      typeof authRaw === "string" && authRaw.trim() ? authRaw.trim() : null;
    m.set(id, {
      id,
      displayName,
      hourlyRate: parseHourlyRate(row?.hourlyRate),
      authUserId,
    });
  }
  return m;
}

/** Porovnání záznamu docházky s id zaměstnance (dokument) nebo s jeho Auth UID. */
export function attendanceRowMatchesEmployee(
  r: AttendanceRow,
  employeeDocId: string,
  authUserId?: string | null
): boolean {
  const rid = String(r.employeeId ?? "");
  if (rid === employeeDocId) return true;
  if (authUserId && rid === authUserId) return true;
  return false;
}

/** Stejné porovnání pro záznamy s polem `employeeId` (výkazy, work_time_blocks). */
export function firestoreEmployeeIdMatches(
  recordEmployeeId: unknown,
  emp: EmployeeLite
): boolean {
  const rid = String(recordEmployeeId ?? "");
  if (rid === emp.id) return true;
  if (emp.authUserId && rid === emp.authUserId) return true;
  return false;
}

/**
 * Orientační výdělek: přednostně odpracované hodiny × hodinová sazba.
 * Pokud nejsou hodiny ani sazba, fallback na součet odhadů z čekajících výkazů / bloků.
 */
export function computeOrientacniVydelekKc(params: {
  odpracovaneHodiny: number;
  hourlyRate: number;
  pendingDailyEst: number;
  pendingBlockEst: number;
}): number {
  const rate = Number(params.hourlyRate);
  const h = Number(params.odpracovaneHodiny);
  const pending =
    Math.round((params.pendingDailyEst + params.pendingBlockEst) * 100) / 100;
  if (Number.isFinite(rate) && rate > 0 && Number.isFinite(h) && h > 0) {
    return Math.round(h * rate * 100) / 100;
  }
  return Math.max(0, pending);
}

/** Schválené výkazy (denní modul). */
export function sumApprovedDailyReportsForEmployeeInRange(
  reports: Record<string, unknown>[],
  employeeId: string,
  range: PeriodRange
): number {
  const list: DailyWorkReportMoney[] = [];
  for (const r of reports) {
    if (String(r?.employeeId ?? "") !== employeeId) continue;
    const dk = String(r?.date ?? "").trim();
    if (!dateInRange(dk, range)) continue;
    list.push({
      status: String(r?.status ?? ""),
      payableAmountCzk: Number(r?.payableAmountCzk),
    });
  }
  return sumMoneyForApprovedDailyReports(list);
}

/** Orientační částka z výkazů čekajících na schválení (draft / pending / returned). */
export function sumPendingDailyReportEstimatesInRange(
  reports: Record<string, unknown>[],
  employeeId: string,
  hourlyRate: number,
  range: PeriodRange
): number {
  let s = 0;
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  for (const r of reports) {
    if (String(r?.employeeId ?? "") !== employeeId) continue;
    const st = String(r?.status ?? "");
    if (st === "approved" || st === "rejected") continue;
    const dk = String(r?.date ?? "").trim();
    if (!dateInRange(dk, range)) continue;
    const hRaw =
      r?.hoursConfirmed ?? r?.hoursFromAttendance ?? r?.hoursSum ?? 0;
    const h = Number(hRaw);
    if (!Number.isFinite(h) || h <= 0) continue;
    s += Math.round(h * rate * 100) / 100;
  }
  return Math.round(s * 100) / 100;
}

/** Legacy výkazy práce — schválený výdělek. */
export function sumApprovedBlocksMoneyInRange(
  blocks: WorkTimeBlockMoney[],
  employeeId: string,
  hourlyRate: number,
  range: PeriodRange
): number {
  const r = { start: range.start, end: range.end };
  let s = 0;
  for (const b of blocks) {
    if (String(b.employeeId ?? "") !== employeeId) continue;
    const dk = String(b.date ?? "").trim();
    if (!dateInRange(dk, range)) continue;
    s += moneyForBlock(b, hourlyRate);
  }
  return Math.round(s * 100) / 100;
}

/** Legacy bloky — orientační (čekající). */
export function sumPendingBlocksMoneyInRange(
  blocks: WorkTimeBlockMoney[],
  employeeId: string,
  hourlyRate: number,
  range: PeriodRange
): number {
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  let s = 0;
  for (const b of blocks) {
    if (String(b.employeeId ?? "") !== employeeId) continue;
    if (b.reviewStatus !== "pending") continue;
    const dk = String(b.date ?? "").trim();
    if (!dateInRange(dk, range)) continue;
    s += getLoggedHours(b) * rate;
  }
  return Math.round(s * 100) / 100;
}

export type OverviewTableRow = {
  key: string;
  datumLabel: string;
  employeeId: string;
  employeeName: string;
  prichod: string;
  odchod: string;
  odpracovanoH: number | null;
  bloku: number;
  schvalenoKc: number;
  orientacniKc: number;
};

function countAttendanceBlocksForDay(
  rows: AttendanceRow[],
  employeeDocId: string,
  dayIso: string,
  authUserId?: string | null
): number {
  return rows.filter((r) => {
    if (!attendanceRowMatchesEmployee(r, employeeDocId, authUserId)) return false;
    const ts = r.timestamp;
    let t: Date | null = null;
    if (ts instanceof Date) t = ts;
    else if (ts && typeof (ts as { toDate?: () => Date }).toDate === "function") {
      t = (ts as { toDate: () => Date }).toDate();
    }
    const dateKey =
      (r.date && String(r.date).trim()) ||
      (t ? t.toISOString().split("T")[0] : "");
    return dateKey === dayIso;
  }).length;
}

export function buildOverviewRows(params: {
  mode: PeriodMode;
  range: PeriodRange;
  employeeFilterId: string | "__all__";
  attendanceRaw: AttendanceRow[];
  employees: Map<string, EmployeeLite>;
  dailyReports: Record<string, unknown>[];
  workBlocks: WorkTimeBlockMoney[];
}): OverviewTableRow[] {
  const {
    mode,
    range,
    employeeFilterId,
    attendanceRaw,
    employees,
    dailyReports,
    workBlocks,
  } = params;

  const empIds =
    employeeFilterId === "__all__"
      ? [...employees.keys()]
      : [employeeFilterId].filter((id) => id && employees.has(id));

  const rows: OverviewTableRow[] = [];

  const moneyApproved = (eid: string) => {
    const em = employees.get(eid);
    const rate = em?.hourlyRate ?? 0;
    return (
      sumApprovedDailyReportsForEmployeeInRange(dailyReports, eid, range) +
      sumApprovedBlocksMoneyInRange(workBlocks, eid, rate, range)
    );
  };

  const computeOrientacniForEmployee = (eid: string, odpracovaneHodiny: number) => {
    const em = employees.get(eid);
    const rate = em?.hourlyRate ?? 0;
    const pendD = sumPendingDailyReportEstimatesInRange(
      dailyReports,
      eid,
      rate,
      range
    );
    const pendB = sumPendingBlocksMoneyInRange(workBlocks, eid, rate, range);
    return computeOrientacniVydelekKc({
      odpracovaneHodiny,
      hourlyRate: rate,
      pendingDailyEst: pendD,
      pendingBlockEst: pendB,
    });
  };

  if (mode === "day") {
    const dayIso = format(range.start, "yyyy-MM-dd");
    for (const eid of empIds) {
      const emp = employees.get(eid);
      const name = emp?.displayName ?? eid;
      const auth = emp?.authUserId;
      const dayRows = attendanceRaw.filter((r) =>
        attendanceRowMatchesEmployee(r, eid, auth)
      );
      const sums = summarizeAttendanceByDay(dayRows);
      const one = sums.find((s) => s.date === dayIso);
      const h = one?.hoursWorked ?? null;
      const hoursNum = h != null && Number.isFinite(h) ? h : 0;
      const bloku = countAttendanceBlocksForDay(attendanceRaw, eid, dayIso, auth);
      rows.push({
        key: `${eid}-${dayIso}`,
        datumLabel: format(range.start, "EEEE d. M. yyyy", { locale: cs }),
        employeeId: eid,
        employeeName: name,
        prichod: one?.checkIn ?? "—",
        odchod: one?.checkOut ?? "—",
        odpracovanoH: h,
        bloku: bloku,
        schvalenoKc: moneyApproved(eid),
        orientacniKc: computeOrientacniForEmployee(eid, hoursNum),
      });
    }
    return rows;
  }

  /** Souhrn týden / měsíc — jeden řádek na zaměstnance. */
  for (const eid of empIds) {
    const emp = employees.get(eid);
    const name = emp?.displayName ?? eid;
    const auth = emp?.authUserId;
    const dayRows = attendanceRaw.filter((r) =>
      attendanceRowMatchesEmployee(r, eid, auth)
    );
    const summaries = summarizeAttendanceByDay(dayRows);
    let totalH = 0;
    let totalBlocks = 0;
    for (const s of summaries) {
      if (!dateInRange(s.date, range)) continue;
      totalH += s.hoursWorked ?? 0;
      totalBlocks += countAttendanceBlocksForDay(attendanceRaw, eid, s.date, auth);
    }
    totalH = Math.round(totalH * 100) / 100;
    const datumLabel =
      mode === "week"
        ? `Souhrn týdne (${format(range.start, "d.M.", { locale: cs })} – ${format(range.end, "d.M.yyyy", { locale: cs })})`
        : `Souhrn měsíce ${format(range.start, "LLLL yyyy", { locale: cs })}`;

    rows.push({
      key: `${eid}-${mode}-${format(range.start, "yyyy-MM-dd")}`,
      datumLabel,
      employeeId: eid,
      employeeName: name,
      prichod: "—",
      odchod: "—",
      odpracovanoH: totalH > 0 ? totalH : null,
      bloku: totalBlocks,
      schvalenoKc: moneyApproved(eid),
      orientacniKc: computeOrientacniForEmployee(eid, totalH),
    });
  }

  return rows;
}

export function totalsFromRows(rows: OverviewTableRow[]): {
  hours: number;
  approvedKc: number;
  pendingKc: number;
} {
  let hours = 0;
  let approvedKc = 0;
  let pendingKc = 0;
  for (const r of rows) {
    hours += r.odpracovanoH ?? 0;
    approvedKc += r.schvalenoKc;
    pendingKc += r.orientacniKc;
  }
  return {
    hours: Math.round(hours * 100) / 100,
    approvedKc: Math.round(approvedKc * 100) / 100,
    pendingKc: Math.round(pendingKc * 100) / 100,
  };
}

export { formatKc };
