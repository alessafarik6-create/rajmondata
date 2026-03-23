import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  closedTerminalSegmentsForDay,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";
import { sumClosedSegmentHours } from "@/lib/daily-work-report-day-form";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";
import { isDailyReportPastEditDeadline } from "@/lib/daily-report-24h-lock";

export type DayCalendarMarker =
  | "no_shift"
  | "work_no_report"
  | "draft"
  | "pending"
  | "approved"
  | "returned"
  | "rejected"
  | "locked_timeout";

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
): Map<string, DayCalendarMarker> {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const dayKeys = eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));

  const summaries = summarizeAttendanceByDay(opts.attendanceBlocks as any[], {
    employeeId: opts.employeeId,
    authUid: opts.authUid,
  });
  const attMap = new Map(summaries.map((s) => [s.date, s]));

  const out = new Map<string, DayCalendarMarker>();

  for (const key of dayKeys) {
    const summary = attMap.get(key);
    const rawSegs = opts.segmentsByDate.get(key) ?? [];
    const closed = sortSegmentsByStart(closedTerminalSegmentsForDay(rawSegs, key));
    const segH = sumClosedSegmentHours(closed);
    const attH = summary?.hoursWorked;
    const hasAttendance = attH != null && Number.isFinite(attH) && attH > 0;
    const hasWork = hasAttendance || segH > 0;
    const report = opts.reportsByDate.get(key);
    const status = (report?.status as string | undefined) ?? undefined;

    if (!hasWork) {
      out.set(key, "no_shift");
      continue;
    }

    const lockedByTime =
      opts.lock24hEnabled &&
      isDailyReportPastEditDeadline(key, opts.now) &&
      status !== "returned" &&
      status !== "pending" &&
      status !== "approved";

    if (status === "approved") {
      out.set(key, "approved");
      continue;
    }
    if (status === "pending") {
      out.set(key, "pending");
      continue;
    }
    if (status === "returned") {
      out.set(key, "returned");
      continue;
    }
    if (status === "rejected") {
      out.set(key, "rejected");
      continue;
    }
    if (status === "draft") {
      out.set(key, lockedByTime ? "locked_timeout" : "draft");
      continue;
    }
    if (!report || !status) {
      out.set(key, lockedByTime ? "locked_timeout" : "work_no_report");
      continue;
    }
    out.set(key, "work_no_report");
  }
  return out;
}
