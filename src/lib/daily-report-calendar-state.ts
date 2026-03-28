import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  closedTerminalSegmentsForDay,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";
import { sumClosedSegmentHours } from "@/lib/daily-work-report-day-form";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";
import { isDailyReportPastEditDeadline } from "@/lib/daily-report-24h-lock";
import { isCompleteAttendanceSummary } from "@/lib/daily-work-report-time-cap";

export type DayCalendarMarker =
  | "no_shift"
  | "work_no_report"
  | "draft"
  | "pending"
  | "approved"
  | "returned"
  | "rejected"
  | "locked_timeout";

/** Jedna buňka kalendáře: stav výkazu + zda jde o den se skutečnou docházkou (příchod/odchod). */
export type DayCalendarCell = {
  marker: DayCalendarMarker;
  /** Kompletní docházka z terminálu (příchod, odchod, kladné čisté hodiny). */
  hasCompletePunchAttendance: boolean;
  /** Součet uzavřených úseků terminálu za den (hod). */
  terminalSegmentHours: number;
};

export function buildDayCalendarMarkerMap(
  month: Date,
  opts: {
    attendanceBlocks: Record<string, unknown>[];
    employeeId?: string;
    authUid?: string;
    segmentsByDate: Map<string, WorkSegmentClient[]>;
    reportsByDate: Map<string, { status?: string } | null | undefined>;
    lock24hEnabled: boolean;
    now: Date;
  }
): Map<string, DayCalendarCell> {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const dayKeys = eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));

  const summaries = summarizeAttendanceByDay(opts.attendanceBlocks as any[], {
    employeeId: opts.employeeId,
    authUid: opts.authUid,
  });
  const attMap = new Map(summaries.map((s) => [s.date, s]));

  const out = new Map<string, DayCalendarCell>();

  const cell = (
    marker: DayCalendarMarker,
    hasCompletePunchAttendance: boolean,
    terminalSegmentHours: number
  ): DayCalendarCell => ({
    marker,
    hasCompletePunchAttendance,
    terminalSegmentHours: Math.round(terminalSegmentHours * 100) / 100,
  });

  for (const key of dayKeys) {
    const summary = attMap.get(key);
    const rawSegs = opts.segmentsByDate.get(key) ?? [];
    const closed = sortSegmentsByStart(closedTerminalSegmentsForDay(rawSegs, key));
    const segH = sumClosedSegmentHours(closed);
    const fromPunch = isCompleteAttendanceSummary(summary);
    const hasWork = fromPunch || segH > 0;
    const report = opts.reportsByDate.get(key);
    const status = (report?.status as string | undefined) ?? undefined;

    if (!hasWork) {
      out.set(key, cell("no_shift", false, segH));
      continue;
    }

    const lockedByTime =
      opts.lock24hEnabled &&
      isDailyReportPastEditDeadline(key, opts.now) &&
      status !== "returned" &&
      status !== "pending" &&
      status !== "approved";

    if (status === "approved") {
      out.set(key, cell("approved", fromPunch, segH));
      continue;
    }
    if (status === "pending") {
      out.set(key, cell("pending", fromPunch, segH));
      continue;
    }
    if (status === "returned") {
      out.set(key, cell("returned", fromPunch, segH));
      continue;
    }
    if (status === "rejected") {
      out.set(key, cell("rejected", fromPunch, segH));
      continue;
    }
    if (status === "draft") {
      out.set(key, cell(lockedByTime ? "locked_timeout" : "draft", fromPunch, segH));
      continue;
    }
    if (!report || !status) {
      out.set(key, cell(lockedByTime ? "locked_timeout" : "work_no_report", fromPunch, segH));
      continue;
    }
    out.set(key, cell("work_no_report", fromPunch, segH));
  }
  return out;
}
