import { format, parseISO, startOfDay } from "date-fns";
import type { CompanyScheduleCalendarEvent } from "@/lib/company-schedule-events";
import { isValidCompanyScheduleEvent } from "@/lib/company-schedule-events";
import {
  filterCompanyCalendarEventsForViewer,
} from "@/lib/calendar/company-calendar-service";
import {
  resolveCalendarPermissions,
  type CalendarPermissionsResolved,
} from "@/lib/calendar/calendar-access";
import type { DashboardTaskItem } from "@/lib/dashboard-task-items-merge";

export type DashboardCalendarFilter = "all" | "meetings" | "jobs" | "tasks";

export type DashboardCalendarEventKind =
  | "meeting"
  | "installation"
  | "task"
  | "job_deadline"
  | "reminder"
  | "confirmed";

export type DashboardCalendarEvent = {
  id: string;
  kind: DashboardCalendarEventKind;
  at: Date;
  dayKey: string;
  timeLabel: string;
  title: string;
  shortTitle: string;
  href: string;
  tooltipTitle: string;
  tooltipLines: string[];
  overdue: boolean;
  /** `lead_meetings` document id pro schůzku / montáž */
  sourceId?: string;
  scheduleEventKind?: "meeting" | "installation" | "measurement";
};

function dayKeyFromDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function dayKeyFromIso(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return iso;
}

function dateAtLocalNoon(iso: string): Date | null {
  if (!dayKeyFromIso(iso)) return null;
  const d = parseISO(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function shortenCalendarLabel(text: string, max = 22): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function filterScheduleEventsForDashboardViewer(
  events: CompanyScheduleCalendarEvent[],
  opts: {
    restrictEmployeeEvents: boolean;
    viewerUid: string;
    viewerEmployeeId: string;
    isManagement?: boolean;
    calendarAccess?: CalendarPermissionsResolved;
  }
): CompanyScheduleCalendarEvent[] {
  const calendarAccess =
    opts.calendarAccess ??
    resolveCalendarPermissions({
      role: opts.isManagement ? "admin" : "employee",
      employeeDoc: null,
    });

  return filterCompanyCalendarEventsForViewer(events, {
    restrictToEmployeeScope: opts.restrictEmployeeEvents,
    viewerUid: opts.viewerUid,
    viewerEmployeeId: opts.viewerEmployeeId,
    isManagement: opts.isManagement === true,
    calendarAccess,
  });
}

function scheduleEventHref(ev: CompanyScheduleCalendarEvent): string {
  if (ev.kind === "measurement") return "/portal/jobs/measurements";
  if (ev.sourceId && (ev.kind === "meeting" || ev.kind === "installation")) {
    return `/portal/schedule?event=${encodeURIComponent(ev.sourceId)}`;
  }
  if (ev.jobId) return `/portal/jobs/${encodeURIComponent(ev.jobId)}`;
  return "/portal/schedule";
}

function scheduleToDashboard(
  ev: CompanyScheduleCalendarEvent,
  todayIso: string
): DashboardCalendarEvent | null {
  if (!isValidCompanyScheduleEvent(ev)) return null;
  if (ev.status === "cancelled" || ev.status === "canceled") return null;

  const dayKey = dayKeyFromDate(ev.at);
  const timeLabel = format(ev.at, "HH:mm");
  const headline = ev.headline || ev.title || "Událost";
  const short = shortenCalendarLabel(headline);

  let kind: DashboardCalendarEventKind = "meeting";
  if (ev.kind === "measurement") kind = "reminder";
  else if (ev.kind === "installation" && ev.status === "done") kind = "confirmed";
  else if (ev.kind === "installation") kind = "installation";

  const tooltipLines = [
    ev.kind === "installation" ? "Montáž / schůzka" : ev.kind === "measurement" ? "Zaměření" : "Schůzka",
    `${format(ev.at, "d. M. yyyy")} ${timeLabel}`,
    ev.title?.trim() || "",
    ev.jobName ? `Zakázka ${ev.jobName}` : "",
  ].filter(Boolean);

  return {
    id: `sch-${ev.id}`,
    kind,
    at: ev.at,
    dayKey,
    timeLabel,
    title: headline,
    shortTitle: short,
    href: scheduleEventHref(ev),
    tooltipTitle: headline,
    tooltipLines,
    overdue: false,
    sourceId: ev.sourceId,
    scheduleEventKind:
      ev.kind === "installation"
        ? "installation"
        : ev.kind === "measurement"
          ? "measurement"
          : "meeting",
  };
}

function taskToDashboard(t: DashboardTaskItem, todayIso: string): DashboardCalendarEvent | null {
  const due = t.dueIso?.trim();
  if (!due || !dayKeyFromIso(due)) return null;
  const at = dateAtLocalNoon(due);
  if (!at) return null;
  const overdue = due < todayIso;
  const title = t.title || "Úkol";
  const href = t.jobId
    ? `/portal/jobs/${encodeURIComponent(t.jobId)}`
    : "/portal/jobs";
  return {
    id: `task-${t.key}`,
    kind: "task",
    at,
    dayKey: due,
    timeLabel: "—",
    title,
    shortTitle: shortenCalendarLabel(title),
    href,
    tooltipTitle: title,
    tooltipLines: ["Úkol", due, t.jobName ? `Zakázka ${t.jobName}` : ""].filter(Boolean),
    overdue,
  };
}

type JobRow = { id: string; name?: string; status?: string; endDate?: string };

function jobToDashboard(j: JobRow, todayIso: string): DashboardCalendarEvent | null {
  const due = j.endDate?.trim();
  if (!due || !dayKeyFromIso(due)) return null;
  if (j.status === "dokončená") return null;
  const at = dateAtLocalNoon(due);
  if (!at) return null;
  const overdue = due < todayIso;
  const name = j.name?.trim() || "Zakázka";
  return {
    id: `job-${j.id}-${due}`,
    kind: "job_deadline",
    at,
    dayKey: due,
    timeLabel: "Termín",
    title: `Termín: ${name}`,
    shortTitle: shortenCalendarLabel(name),
    href: `/portal/jobs/${encodeURIComponent(j.id)}`,
    tooltipTitle: name,
    tooltipLines: ["Termín zakázky", due, overdue ? "Po termínu" : ""].filter(Boolean),
    overdue,
  };
}

export function buildDashboardCalendarEvents(params: {
  scheduleEvents: CompanyScheduleCalendarEvent[];
  tasks: DashboardTaskItem[];
  jobs: JobRow[];
  todayIso: string;
  rangeStart: Date;
  rangeEnd: Date;
  includeMeetings: boolean;
  includeTasks: boolean;
  includeJobs: boolean;
}): DashboardCalendarEvent[] {
  const startMs = startOfDay(params.rangeStart).getTime();
  const endMs = startOfDay(params.rangeEnd).getTime() + 86400000 - 1;

  const out: DashboardCalendarEvent[] = [];

  if (params.includeMeetings) {
    for (const ev of params.scheduleEvents) {
      const row = scheduleToDashboard(ev, params.todayIso);
      if (!row) continue;
      const t = row.at.getTime();
      if (t < startMs || t > endMs) continue;
      if (row.dayKey < params.todayIso && !row.overdue) continue;
      out.push(row);
    }
  }

  if (params.includeTasks) {
    for (const t of params.tasks) {
      const row = taskToDashboard(t, params.todayIso);
      if (!row) continue;
      const tms = row.at.getTime();
      if (tms < startMs || tms > endMs) continue;
      if (row.dayKey < params.todayIso && !row.overdue) continue;
      out.push(row);
    }
  }

  if (params.includeJobs) {
    for (const j of params.jobs) {
      const row = jobToDashboard(j, params.todayIso);
      if (!row) continue;
      const tms = row.at.getTime();
      if (tms < startMs || tms > endMs) continue;
      if (row.dayKey < params.todayIso && !row.overdue) continue;
      out.push(row);
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

export function filterDashboardCalendarEvents(
  events: DashboardCalendarEvent[],
  filter: DashboardCalendarFilter
): DashboardCalendarEvent[] {
  if (filter === "all") return events;
  if (filter === "meetings") {
    return events.filter(
      (e) =>
        e.kind === "meeting" ||
        e.kind === "installation" ||
        e.kind === "reminder" ||
        e.kind === "confirmed"
    );
  }
  if (filter === "jobs") return events.filter((e) => e.kind === "job_deadline");
  if (filter === "tasks") return events.filter((e) => e.kind === "task");
  return events;
}

export function kindDotClass(kind: DashboardCalendarEventKind, overdue: boolean): string {
  if (overdue || kind === "job_deadline") return "bg-red-500";
  switch (kind) {
    case "meeting":
      return "bg-sky-500";
    case "installation":
      return "bg-emerald-500";
    case "task":
      return "bg-orange-500";
    case "reminder":
      return "bg-violet-500";
    case "confirmed":
      return "bg-emerald-500";
    default:
      return "bg-slate-400";
  }
}

export function countOverdueBeforeToday(
  tasks: DashboardTaskItem[],
  jobs: JobRow[],
  todayIso: string
): number {
  let n = 0;
  for (const t of tasks) {
    if (t.dueIso && t.dueIso < todayIso) n++;
  }
  for (const j of jobs) {
    if (j.status !== "dokončená" && j.endDate && j.endDate < todayIso) n++;
  }
  return n;
}
