/**
 * Agregace dat pro přehled docházky (admin): období, řádky tabulky, výdělky.
 */

import {
  eachDayOfInterval,
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
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  effectiveSegmentDurationHours,
  segmentDateIsoKey,
} from "@/lib/work-segment-client";
import {
  formatKc,
  getLoggedHours,
  moneyForBlock,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";

export type PeriodMode = "day" | "week" | "month" | "custom";

export type PeriodRange = { start: Date; end: Date; label: string };

export function computePeriodRange(
  mode: PeriodMode,
  anchor: Date,
  customFromTo?: { from: Date; to: Date } | null
): PeriodRange {
  if (mode === "custom" && customFromTo) {
    let a = new Date(
      customFromTo.from.getFullYear(),
      customFromTo.from.getMonth(),
      customFromTo.from.getDate()
    );
    let b = new Date(
      customFromTo.to.getFullYear(),
      customFromTo.to.getMonth(),
      customFromTo.to.getDate()
    );
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    const end = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999);
    return {
      start: a,
      end,
      label: `${format(a, "d. M. yyyy", { locale: cs })} – ${format(b, "d. M. yyyy", { locale: cs })}`,
    };
  }
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

/** Desetinné hodiny → „3 h 15 min“ (pro tarify a přehled). */
export function formatHoursMinutes(decimalHours: number | null): string {
  if (decimalHours == null || !Number.isFinite(decimalHours) || decimalHours <= 0) {
    return "—";
  }
  const totalMin = Math.round(decimalHours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function enumerateIsoDaysInRange(range: PeriodRange): string[] {
  const start = new Date(
    range.start.getFullYear(),
    range.start.getMonth(),
    range.start.getDate()
  );
  const end = new Date(
    range.end.getFullYear(),
    range.end.getMonth(),
    range.end.getDate()
  );
  return eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));
}

function sumPendingDailyReportEstimateForDay(
  reports: Record<string, unknown>[],
  emp: EmployeeLite,
  dayIso: string
): number {
  let s = 0;
  const rate = Number(emp.hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  for (const r of reports) {
    if (!firestoreEmployeeIdMatches(r?.employeeId, emp)) continue;
    const st = String(r?.status ?? "");
    if (st === "approved" || st === "rejected") continue;
    const dk = String(r?.date ?? "").trim();
    if (dk !== dayIso) continue;
    const hRaw = r?.hoursConfirmed ?? r?.hoursFromAttendance ?? r?.hoursSum ?? 0;
    const h = Number(hRaw);
    if (!Number.isFinite(h) || h <= 0) continue;
    s += Math.round(h * rate * 100) / 100;
  }
  return Math.round(s * 100) / 100;
}

function sumPendingBlocksMoneyForDay(
  blocks: WorkTimeBlockMoney[],
  emp: EmployeeLite,
  dayIso: string
): number {
  const rate = Number(emp.hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  let s = 0;
  for (const b of blocks) {
    if (!firestoreEmployeeIdMatches(b.employeeId, emp)) continue;
    if (b.reviewStatus !== "pending") continue;
    const dk = String(b.date ?? "").trim();
    if (dk !== dayIso) continue;
    s += getLoggedHours(b) * rate;
  }
  return Math.round(s * 100) / 100;
}

function approvedMoneyDailyReportForDay(
  reports: Record<string, unknown>[],
  emp: EmployeeLite,
  dayIso: string
): number {
  for (const r of reports) {
    if (!firestoreEmployeeIdMatches(r?.employeeId, emp)) continue;
    if (String(r?.date ?? "").trim() !== dayIso) continue;
    if (String(r?.status ?? "") !== "approved") continue;
    const n = Number(r?.payableAmountCzk);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return 0;
}

function dailyReportStatusForDay(
  reports: Record<string, unknown>[],
  emp: EmployeeLite,
  dayIso: string
): string | null {
  for (const r of reports) {
    if (!firestoreEmployeeIdMatches(r?.employeeId, emp)) continue;
    if (String(r?.date ?? "").trim() !== dayIso) continue;
    return String(r?.status ?? "");
  }
  return null;
}

function aggregateTariffLinesForDay(
  segments: WorkSegmentClient[],
  emp: EmployeeLite,
  dayIso: string
): { label: string; hours: number }[] {
  const map = new Map<string, number>();
  for (const seg of segments) {
    if (!firestoreEmployeeIdMatches(seg.employeeId, emp)) continue;
    if (segmentDateIsoKey(seg) !== dayIso) continue;
    if (seg.closed !== true) continue;
    const h = effectiveSegmentDurationHours(seg);
    if (h <= 0) continue;
    const st = String(seg.sourceType || "");
    let label: string;
    if (st === "tariff") {
      const n = String(seg.tariffName || seg.displayName || "").trim();
      label = n ? `Tarif ${n}` : "Tarif";
    } else if (st === "job") {
      const n = String(seg.jobName || seg.displayName || "").trim();
      label = n ? `Zakázka: ${n}` : "Zakázka";
    } else {
      label = String(seg.displayName || "Úsek").trim() || "Úsek";
    }
    map.set(label, (map.get(label) ?? 0) + h);
  }
  return [...map.entries()]
    .map(([label, hours]) => ({
      label,
      hours: Math.round(hours * 100) / 100,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "cs"));
}

export type TariffLineRow = { label: string; hours: number };

export type EmployeeDailyDetailRow = {
  key: string;
  dateIso: string;
  dayTitle: string;
  prichod: string;
  odchod: string;
  odpracovanoH: number | null;
  tariffLines: TariffLineRow[];
  bloku: number;
  schvalenoKc: number;
  orientacniKc: number;
  schvalenoStatus: "approved" | "pending" | "none";
};

/**
 * Denní rozpis pro jednoho zaměstnance: docházka, uzavřené segmenty (tarify/zakázky),
 * orientační a schválený výdělek podle stejné logiky jako souhrnné funkce, ale po dnech.
 */
export function buildEmployeeDailyDetailRows(params: {
  range: PeriodRange;
  employee: EmployeeLite;
  attendanceRaw: AttendanceRow[];
  dailyReports: Record<string, unknown>[];
  workBlocks: WorkTimeBlockMoney[];
  segments: WorkSegmentClient[];
}): EmployeeDailyDetailRow[] {
  const { range, employee, attendanceRaw, dailyReports, workBlocks, segments } =
    params;
  const eid = employee.id;
  const auth = employee.authUserId;
  const dayRows = attendanceRaw.filter((r) =>
    attendanceRowMatchesEmployee(r, eid, auth)
  );
  const summaries = summarizeAttendanceByDay(dayRows, {
    employeeId: eid,
    authUid: auth ?? undefined,
  });
  const byDay = new Map(summaries.map((s) => [s.date, s]));
  const rate = Number(employee.hourlyRate) || 0;
  const days = enumerateIsoDaysInRange(range);
  const out: EmployeeDailyDetailRow[] = [];

  for (const dateIso of days) {
    const one = byDay.get(dateIso);
    const h = one?.hoursWorked ?? null;
    const hoursNum = h != null && Number.isFinite(h) ? h : 0;
    const bloku = countAttendanceBlocksForDay(attendanceRaw, eid, dateIso, auth);
    const tariffLines = aggregateTariffLinesForDay(segments, employee, dateIso);
    const approvedDr = approvedMoneyDailyReportForDay(dailyReports, employee, dateIso);
    const approvedBl = (() => {
      let s = 0;
      for (const b of workBlocks) {
        if (!firestoreEmployeeIdMatches(b.employeeId, employee)) continue;
        if (String(b.date ?? "").trim() !== dateIso) continue;
        s += moneyForBlock(b, rate);
      }
      return Math.round(s * 100) / 100;
    })();
    const schvalenoKc = Math.round((approvedDr + approvedBl) * 100) / 100;
    const pendD = sumPendingDailyReportEstimateForDay(dailyReports, employee, dateIso);
    const pendB = sumPendingBlocksMoneyForDay(workBlocks, employee, dateIso);
    const orientacniKc = computeOrientacniVydelekKc({
      odpracovaneHodiny: hoursNum,
      hourlyRate: rate,
      pendingDailyEst: pendD,
      pendingBlockEst: pendB,
    });
    const repSt = dailyReportStatusForDay(dailyReports, employee, dateIso);
    let schvalenoStatus: "approved" | "pending" | "none" = "none";
    if (repSt === "approved" || schvalenoKc > 0) schvalenoStatus = "approved";
    else if (repSt && repSt !== "rejected" && repSt !== "approved") {
      schvalenoStatus = "pending";
    }
    const dayTitle = format(
      new Date(
        Number(dateIso.slice(0, 4)),
        Number(dateIso.slice(5, 7)) - 1,
        Number(dateIso.slice(8, 10))
      ),
      "EEEE d. M. yyyy",
      { locale: cs }
    );
    out.push({
      key: `${eid}-${dateIso}`,
      dateIso,
      dayTitle,
      prichod: one?.checkIn ?? "—",
      odchod: one?.checkOut ?? "—",
      odpracovanoH: h,
      tariffLines,
      bloku,
      schvalenoKc,
      orientacniKc,
      schvalenoStatus,
    });
  }
  return out;
}

export function totalsFromDailyDetailRows(rows: EmployeeDailyDetailRow[]): {
  daysWorked: number;
  hours: number;
  approvedKc: number;
  orientacniKc: number;
} {
  let daysWorked = 0;
  let hours = 0;
  let approvedKc = 0;
  let orientacniKc = 0;
  for (const r of rows) {
    const hasWork =
      (r.odpracovanoH != null && r.odpracovanoH > 0) ||
      r.tariffLines.length > 0 ||
      r.bloku > 0;
    if (hasWork) daysWorked += 1;
    hours += r.odpracovanoH ?? 0;
    approvedKc += r.schvalenoKc;
    orientacniKc += r.orientacniKc;
  }
  return {
    daysWorked,
    hours: Math.round(hours * 100) / 100,
    approvedKc: Math.round(approvedKc * 100) / 100,
    orientacniKc: Math.round(orientacniKc * 100) / 100,
  };
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
        : mode === "month"
          ? `Souhrn měsíce ${format(range.start, "LLLL yyyy", { locale: cs })}`
          : `Souhrn období (${format(range.start, "d.M.yyyy", { locale: cs })} – ${format(range.end, "d.M.yyyy", { locale: cs })})`;

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
