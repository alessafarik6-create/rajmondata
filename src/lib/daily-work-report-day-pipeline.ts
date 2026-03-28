/**
 * Jednotné párování vstupů denního výkazu podle lokálního `dayKey` (YYYY-MM-DD).
 * Hlavní výpočet: `calculateDayReportSummary` v `daily-work-report-day-summary.ts`.
 */

export { localDayKeyFromDate as getLocalDayKeyFromDate } from "./daily-work-report-day-summary";
export type { AttendanceRow } from "./employee-attendance";
export {
  attendanceRowCalendarDateKey,
  attendanceRowDate,
  filterAttendanceRowsForLocalDay,
  getDayAttendanceSummaryForLocalDay,
} from "./employee-attendance";
import type { WorkSegmentClient } from "./work-segment-client";
import { segmentCalendarDateIsoKey } from "./work-segment-client";

export function getTerminalSegmentsForLocalDay(
  segments: WorkSegmentClient[],
  dayKey: string
): WorkSegmentClient[] {
  const k = String(dayKey).trim();
  if (!k) return [];
  return segments.filter((s) => segmentCalendarDateIsoKey(s) === k);
}
