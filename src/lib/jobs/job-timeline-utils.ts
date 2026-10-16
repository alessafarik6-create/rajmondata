import { calendarDaysUntilJobDeadline } from "@/lib/dashboard-deadline-jobs";
import { isCompletedJobStatus } from "@/lib/job-status";
import type { JobListRow } from "@/lib/job-list-filters";

export type JobTimelineScale = "week" | "month" | "quarter" | "year";

export type JobTimelineUrgency = "overdue" | "soon" | "future" | "done" | "none";

export function pragueTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function parseLocalDay(iso: string): Date | null {
  const t = String(iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function jobTimelineDeadlineIso(job: JobListRow): string | null {
  const end = String(job.endDate ?? "").trim().slice(0, 10);
  if (end) return end;
  const start = String(job.startDate ?? "").trim().slice(0, 10);
  return start || null;
}

export function jobTimelineUrgency(job: JobListRow, now = new Date()): JobTimelineUrgency {
  if (isCompletedJobStatus(job.status) || job.status === "zrušeno" || job.status === "cancelled") {
    return "done";
  }
  const deadline = jobTimelineDeadlineIso(job);
  if (!deadline) return "none";
  const days = calendarDaysUntilJobDeadline(deadline, now);
  if (days == null) return "none";
  if (days < 0) return "overdue";
  if (days <= 7) return "soon";
  return "future";
}

export function urgencyColorClass(u: JobTimelineUrgency): string {
  switch (u) {
    case "overdue":
      return "bg-red-500 border-red-600";
    case "soon":
      return "bg-orange-500 border-orange-600";
    case "future":
      return "bg-emerald-500 border-emerald-600";
    case "done":
      return "bg-slate-400 border-slate-500";
    default:
      return "bg-slate-300 border-slate-400";
  }
}

/** Třídy pro malý bod na časové ose (8–12 px). */
export function urgencyDotClass(u: JobTimelineUrgency): string {
  switch (u) {
    case "overdue":
      return "bg-red-500 hover:bg-red-600 ring-2 ring-white shadow-sm";
    case "soon":
      return "bg-orange-500 hover:bg-orange-600 ring-2 ring-white shadow-sm";
    case "future":
      return "bg-emerald-500 hover:bg-emerald-600 ring-2 ring-white shadow-sm";
    case "done":
      return "bg-slate-400 hover:bg-slate-500 ring-2 ring-white shadow-sm";
    default:
      return "bg-slate-300 ring-2 ring-white shadow-sm";
  }
}

export function jobDaysUntilLabel(
  job: JobListRow,
  now = new Date()
): string {
  const deadline = jobTimelineDeadlineIso(job);
  if (!deadline) return "Bez termínu";
  const days = calendarDaysUntilJobDeadline(deadline, now);
  if (days == null) return "—";
  if (days < 0) return `${Math.abs(days)} dní po termínu`;
  if (days === 0) return "Termín dnes";
  return `${days} dní do termínu`;
}

const MONTH_NAMES_CS = [
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

export function formatMonthLabelCs(date: Date): string {
  return `${MONTH_NAMES_CS[date.getMonth()]} ${date.getFullYear()}`;
}

export function shouldShowDayNumber(
  dayOffset: number,
  scale: JobTimelineScale,
  pixelsPerDay: number
): boolean {
  if (scale === "week") return true;
  if (scale === "month") return pixelsPerDay >= 8;
  if (scale === "quarter") return dayOffset % 5 === 0;
  return pixelsPerDay >= 3 && dayOffset % 7 === 0;
}

export function shouldShowDayTick(
  dayOffset: number,
  scale: JobTimelineScale
): boolean {
  if (scale === "year") return dayOffset % 7 === 0;
  return true;
}

export function isStrongDayTick(dayOffset: number): boolean {
  return dayOffset % 5 === 0;
}

export function pixelsPerDay(scale: JobTimelineScale): number {
  switch (scale) {
    case "week":
      return 48;
    case "month":
      return 12;
    case "quarter":
      return 4;
    case "year":
      return 1.2;
  }
}

export function resolveJobDisplayNumber(job: JobListRow): string {
  const n = String(
    (job as { jobNumber?: string }).jobNumber ??
      (job as { orderNumber?: string }).orderNumber ??
      ""
  ).trim();
  return n;
}

export function filterJobsForTimelineEmployee(
  jobs: JobListRow[],
  employeeDocId: string | null | undefined,
  authUid: string | null | undefined
): JobListRow[] {
  const emp = String(employeeDocId ?? "").trim();
  const uid = String(authUid ?? "").trim();
  if (!emp && !uid) return jobs;
  return jobs.filter((j) => {
    const ids = (j as { assignedEmployeeIds?: string[] }).assignedEmployeeIds ?? [];
    if (!Array.isArray(ids)) return false;
    return ids.some((x) => x === emp || x === uid);
  });
}
