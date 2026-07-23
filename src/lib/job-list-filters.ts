/**
 * Filtrování, řazení a souhrny seznamu zakázek (čistá logika bez UI).
 */

import {
  calendarDaysUntilJobDeadline,
  isJobOpenForDeadlineWidget,
  parseJobDeadlineLocalDay,
} from "@/lib/dashboard-deadline-jobs";
import { parseRecordDate } from "@/lib/organization-reports";
import {
  DEFAULT_JOB_LIST_SORT,
  DEFAULT_JOB_STATUS_FILTER,
  getJobStatusConfig,
  isActiveJobStatus,
  isCompletedJobStatus,
  jobMatchesStatusFilter,
  type JobDeadlineFilterKey,
  type JobListSortKey,
  type JobStatusFilterKey,
} from "@/lib/job-status";

export type JobListRow = {
  id?: string;
  name?: string;
  description?: string;
  customerId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  jobTag?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
  completedByName?: string;
};

export type JobListSummary = {
  activeCount: number;
  overdueCount: number;
  completedThisMonthCount: number;
  noDeadlineCount: number;
};

export type JobDeadlineDisplay = {
  hasDeadline: boolean;
  startLabel: string;
  endLabel: string;
  primaryLabel: string;
  urgency: "none" | "overdue" | "soon" | "normal";
  daysUntil: number | null;
};

export function jobActivityTimestamp(job: JobListRow): number {
  const updated = parseRecordDate(job.updatedAt);
  if (updated) return updated.getTime();
  const created = parseRecordDate(job.createdAt);
  if (created) return created.getTime();
  return 0;
}

export function jobCreatedTimestamp(job: JobListRow): number {
  const created = parseRecordDate(job.createdAt);
  return created ? created.getTime() : 0;
}

export function jobCompletedTimestamp(job: JobListRow): number | null {
  const completed = parseRecordDate(job.completedAt);
  if (completed) return completed.getTime();
  if (isCompletedJobStatus(job.status)) {
    const updated = parseRecordDate(job.updatedAt);
    if (updated) return updated.getTime();
  }
  return null;
}

export function formatJobListDate(
  raw: unknown,
  opts?: { includeTime?: boolean }
): string {
  const d = parseRecordDate(raw);
  if (!d) return "—";
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    ...(opts?.includeTime
      ? { hour: "2-digit", minute: "2-digit" }
      : {}),
  });
}

export function formatIsoDateLabel(iso: string | undefined | null): string {
  const raw = String(iso ?? "").trim();
  if (!raw) return "—";
  const d = parseJobDeadlineLocalDay(raw);
  if (!d) return raw;
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

export function resolveJobDeadlineDisplay(
  job: JobListRow,
  now = new Date()
): JobDeadlineDisplay {
  const start = String(job.startDate ?? "").trim();
  const end = String(job.endDate ?? "").trim();
  const startLabel = start ? formatIsoDateLabel(start) : "—";
  const endLabel = end ? formatIsoDateLabel(end) : "—";

  if (!end) {
    return {
      hasDeadline: false,
      startLabel,
      endLabel: "Bez termínu",
      primaryLabel: "Bez termínu",
      urgency: "none",
      daysUntil: null,
    };
  }

  const daysUntil = calendarDaysUntilJobDeadline(end, now);
  let urgency: JobDeadlineDisplay["urgency"] = "normal";
  if (daysUntil !== null) {
    if (daysUntil < 0) urgency = "overdue";
    else if (daysUntil <= 7) urgency = "soon";
  }

  return {
    hasDeadline: true,
    startLabel,
    endLabel,
    primaryLabel: endLabel,
    urgency,
    daysUntil,
  };
}

export function isJobOverdue(job: JobListRow, now = new Date()): boolean {
  if (!isJobOpenForDeadlineWidget(job)) return false;
  const end = String(job.endDate ?? "").trim();
  if (!end) return false;
  const days = calendarDaysUntilJobDeadline(end, now);
  return days !== null && days < 0;
}

export function isJobWithoutDeadline(job: JobListRow): boolean {
  if (!isActiveJobStatus(job.status)) return false;
  return !String(job.endDate ?? "").trim();
}

export function isJobCompletedThisMonth(
  job: JobListRow,
  now = new Date()
): boolean {
  if (!isCompletedJobStatus(job.status)) return false;
  const ts = jobCompletedTimestamp(job);
  if (!ts) return false;
  const d = new Date(ts);
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  );
}

export function computeJobListSummary(
  jobs: JobListRow[],
  now = new Date()
): JobListSummary {
  let activeCount = 0;
  let overdueCount = 0;
  let completedThisMonthCount = 0;
  let noDeadlineCount = 0;

  for (const job of jobs) {
    if (isActiveJobStatus(job.status)) activeCount += 1;
    if (isJobOverdue(job, now)) overdueCount += 1;
    if (isJobCompletedThisMonth(job, now)) completedThisMonthCount += 1;
    if (isJobWithoutDeadline(job)) noDeadlineCount += 1;
  }

  return {
    activeCount,
    overdueCount,
    completedThisMonthCount,
    noDeadlineCount,
  };
}

export function filterJobsBySearch(
  jobs: JobListRow[],
  query: string,
  getCustomerName: (customerId: string | undefined | null) => string
): JobListRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return jobs;
  return jobs.filter((j) => {
    const name = String(j?.name ?? "").toLowerCase();
    const desc = String(j?.description ?? "").toLowerCase();
    const customer = getCustomerName(j.customerId).toLowerCase();
    return name.includes(q) || desc.includes(q) || customer.includes(q);
  });
}

export function filterJobsByTag(
  jobs: JobListRow[],
  tagFilter: string
): JobListRow[] {
  const tag = tagFilter.trim();
  if (!tag) return jobs;
  return jobs.filter((j) => String(j?.jobTag ?? "").trim() === tag);
}

export function filterJobsByStatus(
  jobs: JobListRow[],
  statusFilter: JobStatusFilterKey
): JobListRow[] {
  return jobs.filter((j) => jobMatchesStatusFilter(j.status, statusFilter));
}

export function filterJobsByDeadlineExtra(
  jobs: JobListRow[],
  deadlineFilter: JobDeadlineFilterKey | null,
  now = new Date()
): JobListRow[] {
  if (!deadlineFilter) return jobs;
  switch (deadlineFilter) {
    case "overdue":
      return jobs.filter((j) => isJobOverdue(j, now));
    case "none":
      return jobs.filter((j) => isJobWithoutDeadline(j));
    case "completed_month":
      return jobs.filter((j) => isJobCompletedThisMonth(j, now));
    default:
      return jobs;
  }
}

export function applyJobListFilters(
  jobs: JobListRow[],
  opts: {
    search?: string;
    tagFilter?: string;
    statusFilter?: JobStatusFilterKey;
    deadlineFilter?: JobDeadlineFilterKey | null;
    getCustomerName?: (customerId: string | undefined | null) => string;
    now?: Date;
  }
): JobListRow[] {
  const getCustomerName =
    opts.getCustomerName ?? (() => "");
  let list = jobs;
  list = filterJobsBySearch(list, opts.search ?? "", getCustomerName);
  list = filterJobsByTag(list, opts.tagFilter ?? "");
  list = filterJobsByStatus(list, opts.statusFilter ?? DEFAULT_JOB_STATUS_FILTER);
  list = filterJobsByDeadlineExtra(
    list,
    opts.deadlineFilter ?? null,
    opts.now
  );
  return list;
}

function smartSortRank(job: JobListRow, now = new Date()): number {
  const statusCfg = getJobStatusConfig(job.status);
  if (isJobOverdue(job, now)) return 0;
  if (statusCfg.filterGroup === "in_progress") return 10;
  if (statusCfg.filterGroup === "new") return 20;
  if (isActiveJobStatus(job.status)) return 30;
  if (isCompletedJobStatus(job.status)) return 100;
  if (statusCfg.filterGroup === "cancelled") return 110;
  return 50;
}

export function sortJobs(
  jobs: JobListRow[],
  sortKey: JobListSortKey,
  getCustomerName: (customerId: string | undefined | null) => string,
  now = new Date()
): JobListRow[] {
  const list = [...jobs];
  const byActivityDesc = (a: JobListRow, b: JobListRow) =>
    jobActivityTimestamp(b) - jobActivityTimestamp(a);

  list.sort((a, b) => {
    switch (sortKey) {
      case "activity":
        return byActivityDesc(a, b);
      case "created":
        return jobCreatedTimestamp(b) - jobCreatedTimestamp(a);
      case "deadline": {
        const ae = String(a.endDate ?? "").trim();
        const be = String(b.endDate ?? "").trim();
        if (!ae && !be) return byActivityDesc(a, b);
        if (!ae) return 1;
        if (!be) return -1;
        const da = calendarDaysUntilJobDeadline(ae, now) ?? 99999;
        const db = calendarDaysUntilJobDeadline(be, now) ?? 99999;
        if (da !== db) return da - db;
        return byActivityDesc(a, b);
      }
      case "name": {
        const cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""), "cs");
        return cmp !== 0 ? cmp : byActivityDesc(a, b);
      }
      case "customer": {
        const cmp = getCustomerName(a.customerId).localeCompare(
          getCustomerName(b.customerId),
          "cs"
        );
        return cmp !== 0 ? cmp : byActivityDesc(a, b);
      }
      case "status": {
        const sa = getJobStatusConfig(a.status).sortOrder;
        const sb = getJobStatusConfig(b.status).sortOrder;
        if (sa !== sb) return sa - sb;
        return byActivityDesc(a, b);
      }
      case "smart":
      default: {
        const ra = smartSortRank(a, now);
        const rb = smartSortRank(b, now);
        if (ra !== rb) return ra - rb;
        if (ra <= 30) {
          const ae = String(a.endDate ?? "").trim();
          const be = String(b.endDate ?? "").trim();
          if (ae && be) {
            const da = calendarDaysUntilJobDeadline(ae, now) ?? 99999;
            const db = calendarDaysUntilJobDeadline(be, now) ?? 99999;
            if (da !== db) return da - db;
          } else if (ae !== be) {
            return ae ? -1 : 1;
          }
        }
        return byActivityDesc(a, b);
      }
    }
  });

  return list;
}

export function buildJobsListQueryString(opts: {
  status?: JobStatusFilterKey;
  sort?: JobListSortKey;
  search?: string;
  tag?: string;
  deadline?: JobDeadlineFilterKey | null;
}): string {
  const params = new URLSearchParams();
  const status = opts.status ?? DEFAULT_JOB_STATUS_FILTER;
  const sort = opts.sort ?? DEFAULT_JOB_LIST_SORT;

  if (status !== DEFAULT_JOB_STATUS_FILTER) {
    params.set("status", status);
  }
  if (sort !== DEFAULT_JOB_LIST_SORT) {
    params.set("sort", sort);
  }
  const q = String(opts.search ?? "").trim();
  if (q) params.set("q", q);
  const tag = String(opts.tag ?? "").trim();
  if (tag) params.set("tag", tag);
  if (opts.deadline) params.set("deadline", opts.deadline);

  const s = params.toString();
  return s ? `?${s}` : "";
}

export function deadlineUrgencyTextClass(
  urgency: JobDeadlineDisplay["urgency"],
  isCompleted: boolean
): string {
  if (isCompleted) return "text-muted-foreground";
  switch (urgency) {
    case "overdue":
      return "text-destructive font-semibold";
    case "soon":
      return "text-orange-600 dark:text-orange-400 font-medium";
    case "none":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

export function formatRelativeActivityLabel(job: JobListRow): string {
  const ts = jobActivityTimestamp(job);
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Dnes";
  if (diffDays === 1) return "Včera";
  if (diffDays < 7) return `Před ${diffDays} dny`;
  return formatJobListDate(d);
}
