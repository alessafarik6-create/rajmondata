/**
 * Jednotný výpočet denního výkazu práce (hodiny/minuty, zdroje, příznaky).
 * Všechny čísla pro vybraný den mají vycházet z této funkce — stejná pravidla každý den.
 */

import { format } from "date-fns";
import type { AttendanceRow, DayAttendanceSummary } from "@/lib/employee-attendance";
import { attendanceRowDate } from "@/lib/employee-attendance";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import { getTerminalSegmentLockKind, sortSegmentsByStart } from "@/lib/work-segment-client";
import {
  effectiveLockedUnlocked,
  sumClosedSegmentHours,
  type DayFormRow,
} from "@/lib/daily-work-report-day-form";
import {
  computeDayWorkedCap,
  isCompleteAttendanceSummary,
  round2,
} from "@/lib/daily-work-report-time-cap";

/** Lokální kalendářní klíč YYYY-MM-DD (stejně jako výběr dne v kalendáři). */
export function localDayKeyFromDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function sumManualRowHours(
  rows: DayFormRow[],
  parseHours: (s: string) => number | null
): number {
  let s = 0;
  for (const r of rows) {
    const h = parseHours(r.hoursStr);
    if (h != null && h > 0) s += h;
  }
  return Math.round(s * 100) / 100;
}

function hoursToMinutes(h: number): number {
  return Math.round(h * 60 * 100) / 100;
}

function normalizeSavedReportDateKey(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length >= 10 ? s.slice(0, 10) : s || null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return format(v, "yyyy-MM-dd");
  }
  const td = (v as { toDate?: () => Date }).toDate;
  if (typeof td === "function") {
    const d = td.call(v);
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      return format(d, "yyyy-MM-dd");
    }
  }
  return null;
}

function sumSavedSegmentJobSplitsHours(report: unknown): number | null {
  const splits = (report as Record<string, unknown>)?.segmentJobSplits;
  if (!Array.isArray(splits)) return null;
  let s = 0;
  for (const x of splits) {
    const h = Number((x as Record<string, unknown>).hours);
    if (Number.isFinite(h) && h > 0) s += h;
  }
  return Math.round(s * 100) / 100;
}

function buildAttendanceForensicTimeline(
  rows: AttendanceRow[]
): Array<{ type: string; at: string }> {
  const out: Array<{ type: string; at: string }> = [];
  for (const r of rows) {
    const t = attendanceRowDate(r);
    if (!t) continue;
    out.push({ type: String(r.type || ""), at: t.toISOString() });
  }
  return out;
}

export type GrossWorkSource = "attendance_net_complete" | "terminal_closed_sum" | "none";

export type DayReportCalculationSummary = {
  dayIso: string;
  employeeId: string;
  sources: {
    /** Odkud bere „strop“ čisté práce (Krok 1). */
    grossWorkTime: GrossWorkSource;
    /** Logické kolekce Firestore zapojené do dne. */
    collectionsUsed: string[];
  };
  minutes: {
    attendanceNet: number | null;
    pauseDeduced: number | null;
    attendanceSpanGross: number | null;
    terminalClosedSum: number;
    tariff: number;
    jobLockedFromTerminal: number;
    lockedTerminalCombined: number;
    unlockedTerminal: number;
    /** Strop směny (docházka nebo součet úseků) — Krok 1 výstup v minutách. */
    dayWorkedCap: number;
    /** Po odečtení tarifu + zakázky z terminálu (Krok 4). */
    poolAfterTerminalLocks: number;
    /** Max. hodiny do editovatelných řádků (min s odemčenými úseky). */
    formHoursCap: number;
    /** Jen ruční řádky (ne tarif/uzamčená zakázka). */
    manualRowsOnly: number;
    lockedPlusManualTotal: number;
    remainingToShiftCap: number;
    remainingInForm: number;
  };
  hours: {
    segmentTotal: number;
    tariffSum: number;
    jobTerminalSumOnly: number;
    lockedSum: number;
    unlockedSum: number;
    dayWorkedCap: number;
    availableHoursRaw: number;
    formHoursCap: number;
    allocatedUnlocked: number;
    rozdělenoCelkem: number;
    zbýváCap: number;
    zbýváVeFormuláři: number;
  };
  flags: {
    hasCompleteAttendance: boolean;
    hasClosedTerminalSegments: boolean;
    attendanceIncomplete: boolean;
    segmentSumExceedsAttendance: boolean;
    overCap: boolean;
    overUnlocked: boolean;
  };
  counts: {
    closedSegmentCount: number;
    attendanceRowsForDay: number;
  };
  /** Porovnání dvou dnů: stejná pole v konzoli / globalThis (dev). */
  forensic: DayReportForensic;
};

export type DayReportForensic = {
  dayKey: string;
  employeeId: string;
  attendanceEventTimeline: Array<{ type: string; at: string }>;
  pauseMinutes: number | null;
  /** Krok 1 — čistá práce z docházky (null = nekompletní / chybí). */
  attendanceWorkedMinutes: number | null;
  /** Krok 2 — tarif z terminálu (min). */
  tariffMinutes: number;
  /** Krok 3 — uzamčená zakázka z terminálu (min). */
  lockedProjectTerminalMinutes: number;
  /** Součet uzavřených úseků terminálu (min). */
  terminalClosedSumMinutes: number;
  /** Skutečný strop dne po computeDayWorkedCap (min). */
  dayWorkedCapMinutes: number;
  /** Krok 4 — dostupné pro ruční výkaz po odečtu tarifu + job lock (min, ≥ 0). */
  reportableMinutes: number;
  /** Krok 5 — součet ručních řádků ve formuláři (min). */
  existingManualReportedMinutes: number;
  /** Krok 6 — zbývá k celkovému stropu směny (min). */
  remainingMinutes: number;
  remainingInFormCapMinutes: number;
  grossWorkSource: GrossWorkSource;
  savedReport: {
    documentDateKey: string | null;
    matchesSelectedDayKey: boolean;
    segmentJobSplitsSumHours: number | null;
  };
};

/**
 * @param closedTerminalSegmentsForLocalDay — uzavřené job/tariff úseky už omezené na jeden lokální den
 *   (bez druhého data filtru uvnitř pole).
 */
export function calculateDayReportSummary(params: {
  dayIso: string;
  employeeId: string;
  daySummary: DayAttendanceSummary | null;
  closedTerminalSegmentsForLocalDay: WorkSegmentClient[];
  dayFormRows: DayFormRow[];
  parseHours: (s: string) => number | null;
  attendanceSegEpsHours?: number;
  /** Preferujte seznam řádků — počet se odvodí; jinak předejte jen počet. */
  attendanceRowsForDayList?: AttendanceRow[];
  attendanceRowsForDay?: number;
  /** Aktuální dokument výkazu (stejný den jako dayIso u ref). */
  existingReport?: Record<string, unknown> | null;
}): DayReportCalculationSummary {
  const eps = params.attendanceSegEpsHours ?? 0.02;
  const attendanceRowCount =
    params.attendanceRowsForDayList?.length ?? params.attendanceRowsForDay ?? 0;
  const segs = sortSegmentsByStart(params.closedTerminalSegmentsForLocalDay);
  const segmentTotalH = sumClosedSegmentHours(segs);
  const { locked, unlocked } = effectiveLockedUnlocked(segs);
  const lockedSumH = sumClosedSegmentHours(locked);
  const unlockedSumH = sumClosedSegmentHours(unlocked);

  const tariffSegs = locked.filter((s) => getTerminalSegmentLockKind(s) === "tariff_terminal");
  const jobLockSegs = locked.filter((s) => getTerminalSegmentLockKind(s) === "job_terminal");
  const tariffH = sumClosedSegmentHours(tariffSegs);
  const jobLockH = sumClosedSegmentHours(jobLockSegs);

  const daySummary = params.daySummary;
  const dayWorkedCapH = computeDayWorkedCap({
    daySummary,
    segmentTotalHours: segmentTotalH,
  });
  const attendanceNetH = daySummary?.hoursWorked ?? null;

  const availableH = Math.max(0, dayWorkedCapH - lockedSumH);
  const formCapH =
    segs.length === 0
      ? Math.max(0, dayWorkedCapH)
      : unlocked.length === 0
        ? 0
        : Math.min(unlockedSumH, availableH);

  const manualH = sumManualRowHours(params.dayFormRows, params.parseHours);
  const totalAllocH = Math.round((lockedSumH + manualH) * 100) / 100;
  const zbýváCapH = Math.round((dayWorkedCapH - totalAllocH) * 100) / 100;
  const zbýváFormH = Math.round((formCapH - manualH) * 100) / 100;

  const grossSrc: GrossWorkSource = isCompleteAttendanceSummary(daySummary)
    ? "attendance_net_complete"
    : segmentTotalH > eps
      ? "terminal_closed_sum"
      : "none";

  const segmentExceeds =
    attendanceNetH != null &&
    Number.isFinite(attendanceNetH) &&
    segmentTotalH > attendanceNetH + eps;

  const pauseMin =
    daySummary != null && daySummary.breakHours > 0
      ? hoursToMinutes(daySummary.breakHours)
      : daySummary?.totalSpanHours != null && daySummary.hoursWorked != null
        ? hoursToMinutes(daySummary.totalSpanHours - daySummary.hoursWorked)
        : null;

  const collectionsUsed =
    grossSrc === "attendance_net_complete"
      ? [
          "attendance (timestamp → local YYYY-MM-DD)",
          "work_segments (uzavřené job/tariff, startAt → local den)",
          "daily_work_reports (řádky formuláře)",
        ]
      : segmentTotalH > eps
        ? [
            "work_segments (primární strop dne)",
            "attendance (kontrola souladu)",
            "daily_work_reports (řádky formuláře)",
          ]
        : [
            "attendance",
            "work_segments",
            "daily_work_reports (řádky formuláře)",
          ];

  const rawReportableH = dayWorkedCapH - lockedSumH;
  if (rawReportableH < -1e-6 && typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    console.warn("[rajmon/day-report] Reportovatelný fond před ořezem na 0 je záporný", {
      dayIso: params.dayIso,
      rawReportableH,
      dayWorkedCapH,
      lockedSumH,
    });
  }

  const docDateKey = normalizeSavedReportDateKey(params.existingReport?.date);
  const forensic: DayReportForensic = {
    dayKey: params.dayIso,
    employeeId: params.employeeId,
    attendanceEventTimeline: buildAttendanceForensicTimeline(
      params.attendanceRowsForDayList ?? []
    ),
    pauseMinutes: pauseMin,
    attendanceWorkedMinutes:
      attendanceNetH != null && Number.isFinite(attendanceNetH)
        ? hoursToMinutes(attendanceNetH)
        : null,
    tariffMinutes: hoursToMinutes(tariffH),
    lockedProjectTerminalMinutes: hoursToMinutes(jobLockH),
    terminalClosedSumMinutes: hoursToMinutes(segmentTotalH),
    dayWorkedCapMinutes: hoursToMinutes(dayWorkedCapH),
    reportableMinutes: hoursToMinutes(availableH),
    existingManualReportedMinutes: hoursToMinutes(manualH),
    remainingMinutes: hoursToMinutes(zbýváCapH),
    remainingInFormCapMinutes: hoursToMinutes(zbýváFormH),
    grossWorkSource: grossSrc,
    savedReport: {
      documentDateKey: docDateKey,
      matchesSelectedDayKey: docDateKey != null && docDateKey === params.dayIso,
      segmentJobSplitsSumHours: sumSavedSegmentJobSplitsHours(params.existingReport),
    },
  };

  return {
    dayIso: params.dayIso,
    employeeId: params.employeeId,
    sources: {
      grossWorkTime: grossSrc,
      collectionsUsed,
    },
    minutes: {
      attendanceNet: attendanceNetH != null ? hoursToMinutes(attendanceNetH) : null,
      pauseDeduced: pauseMin,
      attendanceSpanGross:
        daySummary?.totalSpanHours != null ? hoursToMinutes(daySummary.totalSpanHours) : null,
      terminalClosedSum: hoursToMinutes(segmentTotalH),
      tariff: hoursToMinutes(tariffH),
      jobLockedFromTerminal: hoursToMinutes(jobLockH),
      lockedTerminalCombined: hoursToMinutes(lockedSumH),
      unlockedTerminal: hoursToMinutes(unlockedSumH),
      dayWorkedCap: hoursToMinutes(dayWorkedCapH),
      poolAfterTerminalLocks: hoursToMinutes(availableH),
      formHoursCap: hoursToMinutes(formCapH),
      manualRowsOnly: hoursToMinutes(manualH),
      lockedPlusManualTotal: hoursToMinutes(totalAllocH),
      remainingToShiftCap: hoursToMinutes(zbýváCapH),
      remainingInForm: hoursToMinutes(zbýváFormH),
    },
    hours: {
      segmentTotal: round2(segmentTotalH),
      tariffSum: round2(tariffH),
      jobTerminalSumOnly: round2(jobLockH),
      lockedSum: round2(lockedSumH),
      unlockedSum: round2(unlockedSumH),
      dayWorkedCap: round2(dayWorkedCapH),
      availableHoursRaw: round2(availableH),
      formHoursCap: round2(formCapH),
      allocatedUnlocked: manualH,
      rozdělenoCelkem: totalAllocH,
      zbýváCap: zbýváCapH,
      zbýváVeFormuláři: zbýváFormH,
    },
    flags: {
      hasCompleteAttendance: isCompleteAttendanceSummary(daySummary),
      hasClosedTerminalSegments: segs.length > 0,
      attendanceIncomplete: Boolean(
        daySummary &&
          (!daySummary.checkIn || !daySummary.checkOut || daySummary.hoursWorked == null)
      ),
      segmentSumExceedsAttendance: segmentExceeds,
      overCap: totalAllocH > dayWorkedCapH + 1e-6,
      overUnlocked: manualH > formCapH + 1e-6,
    },
    counts: {
      closedSegmentCount: segs.length,
      attendanceRowsForDay: attendanceRowCount,
    },
    forensic,
  };
}
