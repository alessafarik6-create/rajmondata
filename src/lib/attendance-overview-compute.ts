/**
 * Agregace dat pro přehled docházky (admin): období, řádky tabulky, výdělky.
 */

import { isJobTerminalAutoApprovedSegmentData } from "@/lib/job-terminal-auto-shared";
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
import { computeSegmentAmount } from "@/lib/work-segment-rates";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  parseSegmentHourlyRateCzk,
  segmentDateIsoKey,
  segmentDurationForOverview,
  segmentStartEndDisplay,
  segmentStartTimestamp,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";
import {
  formatKc,
  getLoggedHours,
  getPayableHours,
  moneyForBlock,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";
import {
  dayPayoutMapForEmployee,
  type EmployeeDayPayoutState,
} from "@/lib/employee-day-payout";

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

/** Jedna položka tarifního úseku (sazba z tarifu, ne zaměstnanec). */
export type TariffSegmentDetailRow = {
  id: string;
  label: string;
  startHm: string;
  endHm: string | null;
  endLabel: string;
  durationH: number;
  rateKcPerH: number | null;
  earningsKc: number;
};

/** Zakázka — sazba z uložené sazby zakázky na segmentu, logika tarifu se neaplikuje. */
export type JobSegmentDetailRow = {
  id: string;
  label: string;
  startHm: string;
  endHm: string | null;
  endLabel: string;
  durationH: number;
  rateKcPerH: number | null;
  earningsKc: number;
  /** Automaticky schválený výdělek z terminálu — orientační částka se nekopíruje (je ve schváleném bloku). */
  autoApproved?: boolean;
};

function segmentEarningsForOverview(
  seg: WorkSegmentClient,
  dayIso: string,
  now: Date
): { durationH: number; earningsKc: number; rate: number | null } {
  const durationH = segmentDurationForOverview(seg, dayIso, now);
  const rate = parseSegmentHourlyRateCzk(seg);
  if (rate != null && durationH > 0) {
    return {
      durationH,
      earningsKc: computeSegmentAmount(durationH, rate),
      rate,
    };
  }
  const tc = seg.totalAmountCzk;
  if (
    seg.closed === true &&
    typeof tc === "number" &&
    Number.isFinite(tc) &&
    tc > 0
  ) {
    return {
      durationH,
      earningsKc: Math.round(tc * 100) / 100,
      rate: null,
    };
  }
  return { durationH, earningsKc: 0, rate: null };
}

export type EmployeeDailyDetailRow = {
  key: string;
  dateIso: string;
  dayTitle: string;
  prichod: string;
  odchod: string;
  totalSpanH: number | null;
  pauseH: number;
  odpracovanoH: number | null;
  tariffSegments: TariffSegmentDetailRow[];
  jobSegments: JobSegmentDetailRow[];
  /** Součet délky tarifních úseků za den (hodiny). */
  tariffHoursTotal: number;
  /**
   * Odpracované hodiny z docházky mínus čas na tarifech (bez odečtu zakázek).
   * Tarifní čas se nepočítá zároveň jako „běžná“ docházka.
   */
  hoursOutsideTariffOnly: number;
  /** Hodiny od docházky mínus čas na tarifech a zakázkách (běžná sazba zaměstnance). */
  hoursOutsideTariffAndJob: number;
  orientacniKcTariff: number;
  orientacniKcJob: number;
  orientacniKcStandard: number;
  bloku: number;
  schvalenoKc: number;
  neschvalenoKc: number;
  hourlyHoursForPay: number;
  hasIncompleteAttendance: boolean;
  orientacniKc: number;
  schvalenoStatus: "approved" | "pending" | "none";
  paidStatus: "paid" | "unpaid" | "none";
  /** Poznámka admina k výplatě dne (jen čtení pro zaměstnance). */
  paidNote: string | null;
  paidKc: number;
  unpaidKc: number;
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
  /** Volitelně: stav výplaty dne z `employee_day_payouts` (klíč = yyyy-MM-dd). */
  dayPayoutByDate?: Map<string, EmployeeDayPayoutState>;
  /** Pro otevřené úseky (testy / deterministický výstup). */
  now?: Date;
}): EmployeeDailyDetailRow[] {
  const {
    range,
    employee,
    attendanceRaw,
    dailyReports,
    workBlocks,
    segments,
    dayPayoutByDate,
  } = params;
  const now = params.now ?? new Date();
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
    const totalSpanH = one?.totalSpanHours ?? null;
    const pauseH = one?.breakHours ?? 0;
    const hasIncompleteAttendance =
      Boolean(one) &&
      ((!one?.checkIn && Boolean(one?.checkOut)) ||
        (Boolean(one?.checkIn) && !one?.checkOut));
    const hoursNum =
      !hasIncompleteAttendance && h != null && Number.isFinite(h) ? h : 0;
    const bloku = countAttendanceBlocksForDay(attendanceRaw, eid, dateIso, auth);

    const daySegs = sortSegmentsByStart(
      segments.filter(
        (s) =>
          firestoreEmployeeIdMatches(s.employeeId, employee) &&
          segmentDateIsoKey(s) === dateIso &&
          (String(s.sourceType ?? "") === "tariff" || String(s.sourceType ?? "") === "job")
      )
    );

    const tariffSegments: TariffSegmentDetailRow[] = [];
    const jobSegments: JobSegmentDetailRow[] = [];
    let sumTariffH = 0;
    let sumJobH = 0;
    let orientacniKcTariff = 0;
    let orientacniKcJob = 0;

    for (const seg of daySegs) {
      const st = String(seg.sourceType ?? "");
      const disp = segmentStartEndDisplay(seg);
      const { durationH, earningsKc, rate: r } = segmentEarningsForOverview(
        seg,
        dateIso,
        now
      );
      const rateKc = r != null ? r : parseSegmentHourlyRateCzk(seg);

      if (st === "tariff") {
        if (!segmentStartTimestamp(seg)) continue;
        const label = String(seg.tariffName || seg.displayName || "").trim();
        tariffSegments.push({
          id: seg.id,
          label: label ? `Tarif ${label}` : "Tarif",
          startHm: disp.startHm,
          endHm: disp.endHm,
          endLabel: disp.endLabel,
          durationH: Math.round(durationH * 100) / 100,
          rateKcPerH: rateKc,
          earningsKc,
        });
        sumTariffH += durationH;
        orientacniKcTariff += earningsKc;
      } else if (st === "job") {
        const jn = String(seg.jobName || seg.displayName || "").trim();
        const autoAp = isJobTerminalAutoApprovedSegmentData(
          seg as unknown as Record<string, unknown>
        );
        jobSegments.push({
          id: seg.id,
          label: jn ? `Zakázka: ${jn}` : "Zakázka",
          startHm: disp.startHm,
          endHm: disp.endHm,
          endLabel: disp.endLabel,
          durationH: Math.round(durationH * 100) / 100,
          rateKcPerH: rateKc,
          earningsKc,
          autoApproved: autoAp,
        });
        sumJobH += durationH;
        if (!autoAp) orientacniKcJob += earningsKc;
      }
    }

    sumTariffH = Math.round(sumTariffH * 100) / 100;
    sumJobH = Math.round(sumJobH * 100) / 100;
    const hoursOutsideTariffOnly = Math.max(
      0,
      Math.round((hoursNum - sumTariffH) * 100) / 100
    );
    const hoursOutsideTariffAndJob = Math.max(
      0,
      Math.round((hoursNum - sumTariffH - sumJobH) * 100) / 100
    );
    const orientacniKcStandard =
      rate > 0 && hoursOutsideTariffAndJob > 0
        ? Math.round(hoursOutsideTariffAndJob * rate * 100) / 100
        : 0;

    orientacniKcTariff = Math.round(orientacniKcTariff * 100) / 100;
    orientacniKcJob = Math.round(orientacniKcJob * 100) / 100;

    const dayBlocks = workBlocks.filter(
      (b) =>
        firestoreEmployeeIdMatches(b.employeeId, employee) &&
        String(b.date ?? "").trim() === dateIso
    );
    const pendD = sumPendingDailyReportEstimateForDay(dailyReports, employee, dateIso);
    const pendB = sumPendingBlocksMoneyForDay(workBlocks, employee, dateIso);

    const splitOrientacni =
      orientacniKcTariff + orientacniKcJob + orientacniKcStandard;
    const hasSplit =
      hoursNum > 0 ||
      sumTariffH > 0 ||
      sumJobH > 0 ||
      tariffSegments.length > 0 ||
      jobSegments.length > 0;

    const orientacniKcRaw = hasSplit
      ? Math.round(splitOrientacni * 100) / 100
      : computeOrientacniVydelekKc({
          odpracovaneHodiny: hoursNum,
          hourlyRate: rate,
          pendingDailyEst: pendD,
          pendingBlockEst: pendB,
        });
    const orientacniKc = hasIncompleteAttendance ? 0 : orientacniKcRaw;

    const repSt = dailyReportStatusForDay(dailyReports, employee, dateIso);
    const dayApprovedByReport = repSt === "approved";
    const dayPendingByReport =
      Boolean(repSt) && repSt !== "approved" && repSt !== "rejected";
    let schvalenoKcRaw = 0;
    if (hasIncompleteAttendance) schvalenoKcRaw = 0;
    else if (dayApprovedByReport) schvalenoKcRaw = orientacniKc;
    else if (dayPendingByReport) schvalenoKcRaw = 0;
    else if (dayBlocks.length === 0) schvalenoKcRaw = orientacniKc;
    else {
      const totalLogged = dayBlocks.reduce((s, b) => s + getLoggedHours(b), 0);
      const approvedHp = dayBlocks.reduce((s, b) => s + getPayableHours(b), 0);
      if (totalLogged <= 0.001) schvalenoKcRaw = orientacniKc;
      else schvalenoKcRaw = orientacniKc * (approvedHp / totalLogged);
    }
    const schvalenoKc = Math.round(Math.max(0, schvalenoKcRaw) * 100) / 100;
    const neschvalenoKc = Math.round(
      Math.max(0, orientacniKc - schvalenoKc) * 100
    ) / 100;
    let schvalenoStatus: "approved" | "pending" | "none" = "none";
    if (dayApprovedByReport || (schvalenoKc > 0 && neschvalenoKc === 0)) {
      schvalenoStatus = "approved";
    }
    else if (repSt && repSt !== "rejected" && repSt !== "approved") {
      schvalenoStatus = "pending";
    } else if (neschvalenoKc > 0) {
      schvalenoStatus = "pending";
    }
    const payout = dayPayoutByDate?.get(dateIso);
    let paidNote: string | null = null;
    let paidStatus: "paid" | "unpaid" | "none" = "none";
    if (payout) {
      paidNote = payout.paidNote;
      paidStatus = payout.paid ? "paid" : "unpaid";
    } else if (dayBlocks.length > 0) {
      paidStatus = dayBlocks.every((b) => b.paid === true) ? "paid" : "unpaid";
    } else if (schvalenoKc > 0) {
      paidStatus = "unpaid";
    }
    const paidKc = paidStatus === "paid" ? schvalenoKc : 0;
    const unpaidKc = paidStatus === "unpaid" ? schvalenoKc : 0;
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
      totalSpanH,
      pauseH,
      odpracovanoH: h,
      tariffSegments,
      jobSegments,
      tariffHoursTotal: sumTariffH,
      hoursOutsideTariffOnly,
      hoursOutsideTariffAndJob,
      orientacniKcTariff,
      orientacniKcJob,
      orientacniKcStandard,
      bloku,
      schvalenoKc,
      neschvalenoKc,
      hourlyHoursForPay: hoursOutsideTariffAndJob,
      hasIncompleteAttendance,
      orientacniKc,
      schvalenoStatus,
      paidStatus,
      paidNote,
      paidKc,
      unpaidKc,
    });
  }
  return out;
}

export function totalsFromDailyDetailRows(rows: EmployeeDailyDetailRow[]): {
  daysWorked: number;
  hours: number;
  approvedKc: number;
  pendingKc: number;
  orientacniKc: number;
  totalTariffHours: number;
  totalTariffKc: number;
  totalJobHours: number;
  totalJobKc: number;
  totalStandardKc: number;
  totalHoursOutsideTariffJob: number;
  /** Součet (den po dni) hodin „mimo tarif“ = odpracováno − tarify. */
  totalHoursOutsideTariffOnly: number;
  approvedHourlyHours: number;
  pendingHourlyHours: number;
  invalidAttendanceDays: number;
  paidDays: number;
  unpaidDays: number;
  paidAmountKc: number;
  unpaidAmountKc: number;
} {
  let daysWorked = 0;
  let hours = 0;
  let approvedKc = 0;
  let pendingKc = 0;
  let orientacniKc = 0;
  let totalTariffHours = 0;
  let totalTariffKc = 0;
  let totalJobHours = 0;
  let totalJobKc = 0;
  let totalStandardKc = 0;
  let totalHoursOutsideTariffJob = 0;
  let totalHoursOutsideTariffOnly = 0;
  let approvedHourlyHours = 0;
  let pendingHourlyHours = 0;
  let invalidAttendanceDays = 0;
  let paidDays = 0;
  let unpaidDays = 0;
  let paidAmountKc = 0;
  let unpaidAmountKc = 0;
  for (const r of rows) {
    const hasWork =
      (r.odpracovanoH != null && r.odpracovanoH > 0) ||
      r.tariffSegments.length > 0 ||
      r.jobSegments.length > 0 ||
      r.bloku > 0;
    if (hasWork) daysWorked += 1;
    hours += r.odpracovanoH ?? 0;
    approvedKc += r.schvalenoKc;
    pendingKc += r.neschvalenoKc;
    orientacniKc += r.orientacniKc;
    if (r.hasIncompleteAttendance) invalidAttendanceDays += 1;
    for (const t of r.tariffSegments) {
      totalTariffHours += t.durationH;
      totalTariffKc += t.earningsKc;
    }
    for (const j of r.jobSegments) {
      totalJobHours += j.durationH;
      totalJobKc += j.earningsKc;
    }
    totalStandardKc += r.orientacniKcStandard;
    totalHoursOutsideTariffJob += r.hoursOutsideTariffAndJob;
    totalHoursOutsideTariffOnly += r.hoursOutsideTariffOnly;
    if (r.schvalenoStatus === "approved")
      approvedHourlyHours += r.hourlyHoursForPay;
    else if (r.schvalenoStatus === "pending")
      pendingHourlyHours += r.hourlyHoursForPay;
    if (r.paidStatus === "paid") paidDays += 1;
    else if (r.paidStatus === "unpaid") unpaidDays += 1;
    paidAmountKc += r.paidKc;
    unpaidAmountKc += r.unpaidKc;
  }
  return {
    daysWorked,
    hours: Math.round(hours * 100) / 100,
    approvedKc: Math.round(approvedKc * 100) / 100,
    pendingKc: Math.round(pendingKc * 100) / 100,
    orientacniKc: Math.round(orientacniKc * 100) / 100,
    totalTariffHours: Math.round(totalTariffHours * 100) / 100,
    totalTariffKc: Math.round(totalTariffKc * 100) / 100,
    totalJobHours: Math.round(totalJobHours * 100) / 100,
    totalJobKc: Math.round(totalJobKc * 100) / 100,
    totalStandardKc: Math.round(totalStandardKc * 100) / 100,
    totalHoursOutsideTariffJob: Math.round(totalHoursOutsideTariffJob * 100) / 100,
    totalHoursOutsideTariffOnly: Math.round(totalHoursOutsideTariffOnly * 100) / 100,
    approvedHourlyHours: Math.round(approvedHourlyHours * 100) / 100,
    pendingHourlyHours: Math.round(pendingHourlyHours * 100) / 100,
    invalidAttendanceDays,
    paidDays,
    unpaidDays,
    paidAmountKc: Math.round(paidAmountKc * 100) / 100,
    unpaidAmountKc: Math.round(unpaidAmountKc * 100) / 100,
  };
}

export type DailyDetailPeriodTotals = ReturnType<typeof totalsFromDailyDetailRows>;

/**
 * Součty tarifů / zakázek / mimo tarif za celé organizační období — součet přes všechny zaměstnance.
 * Použití: export PDF/tisk při výběru „všichni zaměstnanci“.
 */
export function aggregateDailyDetailTotalsForAllEmployees(params: {
  range: PeriodRange;
  employees: Map<string, EmployeeLite>;
  attendanceRaw: AttendanceRow[];
  dailyReports: Record<string, unknown>[];
  workBlocks: WorkTimeBlockMoney[];
  segments: WorkSegmentClient[];
  dayPayoutGlobalMap?: Map<string, EmployeeDayPayoutState>;
  now?: Date;
}): DailyDetailPeriodTotals | null {
  const {
    range,
    employees,
    attendanceRaw,
    dailyReports,
    workBlocks,
    segments,
    dayPayoutGlobalMap,
  } = params;
  const now = params.now ?? new Date();
  if (employees.size === 0) return null;
  let daysWorked = 0;
  let hours = 0;
  let approvedKc = 0;
  let pendingKc = 0;
  let orientacniKc = 0;
  let totalTariffHours = 0;
  let totalTariffKc = 0;
  let totalJobHours = 0;
  let totalJobKc = 0;
  let totalStandardKc = 0;
  let totalHoursOutsideTariffJob = 0;
  let totalHoursOutsideTariffOnly = 0;
  let approvedHourlyHours = 0;
  let pendingHourlyHours = 0;
  let invalidAttendanceDays = 0;
  let paidDays = 0;
  let unpaidDays = 0;
  let paidAmountKc = 0;
  let unpaidAmountKc = 0;
  for (const emp of employees.values()) {
    const rows = buildEmployeeDailyDetailRows({
      range,
      employee: emp,
      attendanceRaw,
      dailyReports,
      workBlocks,
      segments,
      dayPayoutByDate: dayPayoutMapForEmployee(dayPayoutGlobalMap, emp.id),
      now,
    });
    const t = totalsFromDailyDetailRows(rows);
    daysWorked += t.daysWorked;
    hours += t.hours;
    approvedKc += t.approvedKc;
    pendingKc += t.pendingKc;
    orientacniKc += t.orientacniKc;
    totalTariffHours += t.totalTariffHours;
    totalTariffKc += t.totalTariffKc;
    totalJobHours += t.totalJobHours;
    totalJobKc += t.totalJobKc;
    totalStandardKc += t.totalStandardKc;
    totalHoursOutsideTariffJob += t.totalHoursOutsideTariffJob;
    totalHoursOutsideTariffOnly += t.totalHoursOutsideTariffOnly;
    approvedHourlyHours += t.approvedHourlyHours;
    pendingHourlyHours += t.pendingHourlyHours;
    invalidAttendanceDays += t.invalidAttendanceDays;
    paidDays += t.paidDays;
    unpaidDays += t.unpaidDays;
    paidAmountKc += t.paidAmountKc;
    unpaidAmountKc += t.unpaidAmountKc;
  }
  return {
    daysWorked,
    hours: Math.round(hours * 100) / 100,
    approvedKc: Math.round(approvedKc * 100) / 100,
    pendingKc: Math.round(pendingKc * 100) / 100,
    orientacniKc: Math.round(orientacniKc * 100) / 100,
    totalTariffHours: Math.round(totalTariffHours * 100) / 100,
    totalTariffKc: Math.round(totalTariffKc * 100) / 100,
    totalJobHours: Math.round(totalJobHours * 100) / 100,
    totalJobKc: Math.round(totalJobKc * 100) / 100,
    totalStandardKc: Math.round(totalStandardKc * 100) / 100,
    totalHoursOutsideTariffJob: Math.round(totalHoursOutsideTariffJob * 100) / 100,
    totalHoursOutsideTariffOnly: Math.round(totalHoursOutsideTariffOnly * 100) / 100,
    approvedHourlyHours: Math.round(approvedHourlyHours * 100) / 100,
    pendingHourlyHours: Math.round(pendingHourlyHours * 100) / 100,
    invalidAttendanceDays,
    paidDays,
    unpaidDays,
    paidAmountKc: Math.round(paidAmountKc * 100) / 100,
    unpaidAmountKc: Math.round(unpaidAmountKc * 100) / 100,
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
  const toLocalIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
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
      (t ? toLocalIso(t) : "");
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
  segments: WorkSegmentClient[];
  dayPayoutGlobalMap?: Map<string, EmployeeDayPayoutState>;
}): OverviewTableRow[] {
  const {
    mode,
    range,
    employeeFilterId,
    attendanceRaw,
    employees,
    dailyReports,
    workBlocks,
    segments,
    dayPayoutGlobalMap,
  } = params;

  const empIds =
    employeeFilterId === "__all__"
      ? [...employees.keys()]
      : [employeeFilterId].filter((id) => id && employees.has(id));

  const rows: OverviewTableRow[] = [];

  if (mode === "day") {
    const dayIso = format(range.start, "yyyy-MM-dd");
    for (const eid of empIds) {
      const emp = employees.get(eid);
      if (!emp) continue;
      const detailRows = buildEmployeeDailyDetailRows({
        range,
        employee: emp,
        attendanceRaw,
        dailyReports,
        workBlocks,
        segments,
        dayPayoutByDate: dayPayoutMapForEmployee(dayPayoutGlobalMap, eid),
      });
      const t = totalsFromDailyDetailRows(detailRows);
      const dr = detailRows[0];
      rows.push({
        key: `${eid}-${dayIso}`,
        datumLabel: format(range.start, "EEEE d. M. yyyy", { locale: cs }),
        employeeId: eid,
        employeeName: emp.displayName ?? eid,
        prichod: dr?.prichod ?? "—",
        odchod: dr?.odchod ?? "—",
        odpracovanoH: dr?.odpracovanoH ?? null,
        bloku: dr?.bloku ?? 0,
        schvalenoKc: t.approvedKc,
        orientacniKc: t.pendingKc,
      });
    }
    return rows;
  }

  /** Souhrn týden / měsíc / vlastní — jeden řádek na zaměstnance (stejná logika jako denní detail). */
  for (const eid of empIds) {
    const emp = employees.get(eid);
    if (!emp) continue;
    const detailRows = buildEmployeeDailyDetailRows({
      range,
      employee: emp,
      attendanceRaw,
      dailyReports,
      workBlocks,
      segments,
      dayPayoutByDate: dayPayoutMapForEmployee(dayPayoutGlobalMap, eid),
    });
    const t = totalsFromDailyDetailRows(detailRows);
    const blockSum = detailRows.reduce((s, r) => s + r.bloku, 0);
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
      employeeName: emp.displayName ?? eid,
      prichod: "—",
      odchod: "—",
      odpracovanoH: t.hours > 0 ? t.hours : null,
      bloku: blockSum,
      schvalenoKc: t.approvedKc,
      orientacniKc: t.pendingKc,
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
