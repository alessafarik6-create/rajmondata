/**
 * Jednotný výpočet denního výkazu práce (hodiny/minuty, zdroje, příznaky).
 * Všechny čísla pro vybraný den mají vycházet z této funkce — stejná pravidla každý den.
 */

import { format } from "date-fns";
import type { DayAttendanceSummary } from "@/lib/employee-attendance";
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
  attendanceRowsForDay?: number;
}): DayReportCalculationSummary {
  const eps = params.attendanceSegEpsHours ?? 0.02;
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
      attendanceRowsForDay: params.attendanceRowsForDay ?? 0,
    },
  };
}
