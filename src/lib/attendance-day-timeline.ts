/**
 * Časová osa docházky za den — bloky práce a přestávky z terminálu (raw events).
 */

import type { AttendanceRow } from "@/lib/employee-attendance";
import {
  attendanceRowCalendarDateKey,
  attendanceRowDate,
  filterAttendanceRowsForLocalDay,
} from "@/lib/employee-attendance";

export type AttendanceTimelineWorkBlock = {
  index: number;
  startHm: string;
  endHm: string;
  durationH: number;
};

export type AttendanceTimelineBreak = {
  startHm: string;
  endHm: string;
  durationH: number;
  /** explicit = break_start/end z terminálu; inferred = rozdíl span vs. započteno */
  source: "explicit" | "inferred";
};

export type AttendanceDayTimeline = {
  dayKey: string;
  checkInHm: string | null;
  checkOutHm: string | null;
  workBlocks: AttendanceTimelineWorkBlock[];
  breaks: AttendanceTimelineBreak[];
  totalSpanH: number | null;
  workedH: number | null;
  breakH: number | null;
  statusLabel: string;
};

function formatHm(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function roundH(ms: number): number {
  return Math.round((ms / 36e5) * 100) / 100;
}

export function buildAttendanceDayTimeline(
  allRows: AttendanceRow[],
  dayKey: string,
  options?: { employeeId?: string; authUid?: string }
): AttendanceDayTimeline | null {
  const rows = filterAttendanceRowsForLocalDay(allRows, dayKey, options);
  if (rows.length === 0) return null;

  const sorted = rows
    .map((r) => ({ r, t: attendanceRowDate(r) }))
    .filter((x): x is { r: AttendanceRow; t: Date } => x.t != null)
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  const workBlocks: AttendanceTimelineWorkBlock[] = [];
  const breaks: AttendanceTimelineBreak[] = [];

  let workStart: Date | null = null;
  let breakStart: Date | null = null;
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  let blockIndex = 0;

  for (const { t, r } of sorted) {
    const type = String(r.type ?? "");
    if (type === "check_in" || type === "break_end") {
      if (!firstIn) firstIn = t;
      if (breakStart) {
        breaks.push({
          startHm: formatHm(breakStart),
          endHm: formatHm(t),
          durationH: roundH(t.getTime() - breakStart.getTime()),
          source: "explicit",
        });
        breakStart = null;
      }
      workStart = t;
    } else if (type === "break_start" && workStart) {
      workBlocks.push({
        index: ++blockIndex,
        startHm: formatHm(workStart),
        endHm: formatHm(t),
        durationH: roundH(t.getTime() - workStart.getTime()),
      });
      workStart = null;
      breakStart = t;
    } else if (type === "check_out") {
      lastOut = t;
      if (workStart) {
        workBlocks.push({
          index: ++blockIndex,
          startHm: formatHm(workStart),
          endHm: formatHm(t),
          durationH: roundH(t.getTime() - workStart.getTime()),
        });
        workStart = null;
      }
    }
  }

  const totalSpanH =
    firstIn && lastOut && lastOut > firstIn
      ? roundH(lastOut.getTime() - firstIn.getTime())
      : null;

  let workedMs = 0;
  for (const b of workBlocks) workedMs += b.durationH * 36e5;
  if (workStart && lastOut && lastOut > workStart) {
    workedMs += lastOut.getTime() - workStart.getTime();
  }
  const workedH = workBlocks.length || (workStart && lastOut) ? roundH(workedMs) : null;

  let breakH: number | null = null;
  if (totalSpanH != null && workedH != null) {
    breakH = Math.max(0, roundH(totalSpanH - workedH));
    const explicitBreakH = breaks.reduce((s, b) => s + b.durationH, 0);
    if (breakH > 0.01 && explicitBreakH < breakH - 0.01) {
      breaks.push({
        startHm: "—",
        endHm: "—",
        durationH: Math.round((breakH - explicitBreakH) * 100) / 100,
        source: "inferred",
      });
    }
  }

  let statusLabel = "—";
  if (firstIn && lastOut) statusLabel = "Kompletní den";
  else if (firstIn && !lastOut) statusLabel = "Neúplná docházka (chybí odchod)";
  else if (!firstIn && lastOut) statusLabel = "Chybí příchod";

  return {
    dayKey,
    checkInHm: firstIn ? formatHm(firstIn) : null,
    checkOutHm: lastOut ? formatHm(lastOut) : null,
    workBlocks,
    breaks,
    totalSpanH,
    workedH,
    breakH,
    statusLabel,
  };
}
