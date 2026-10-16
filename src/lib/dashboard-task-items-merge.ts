import type {
  JobTaskRow,
  JobTaskPriority,
  JobTaskStatus,
  TaskAssignedMode,
} from "@/lib/job-task-types";
import type { OrganizationTask, OrganizationTaskStatus } from "@/lib/organization-task";
import { isTaskOpen, organizationTaskIsForAll } from "@/lib/organization-task";
import { parseOrgTaskAssigneeRef } from "@/lib/tasks/organization-task-assignees";

export type JobTaskWithId = JobTaskRow & { id: string };

export type DashboardTaskItem = {
  key: string;
  source: "job" | "organization";
  taskId: string;
  jobId?: string;
  title: string;
  note: string;
  dueIso?: string;
  priority: JobTaskPriority;
  jobStatus?: JobTaskStatus;
  orgStatus?: OrganizationTaskStatus;
  jobName?: string;
  assignedTo: string | null;
  assignedMode: TaskAssignedMode;
  /** Firebase Auth uid zadavatele */
  createdBy?: string | null;
  assignedTargets?: string[];
  completedByUserIds?: string[];
};

const PRIORITY_RANK: Record<JobTaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function validDue(iso: string | undefined): string {
  if (!iso?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return "";
  return iso.trim();
}

function parseOrgPriority(p: unknown): JobTaskPriority {
  if (p === "high" || p === "medium" || p === "low") return p;
  return "low";
}

function jobNormAssign(row: JobTaskRow): {
  mode: TaskAssignedMode;
  at: string | null;
} {
  if (row.assignedMode === "all") return { mode: "all", at: null };
  if (row.assignedMode === "single")
    return { mode: "single", at: dStr(row.assignedTo) };
  if (row.assignedTo != null && String(row.assignedTo).trim())
    return { mode: "single", at: String(row.assignedTo).trim() };
  return { mode: "all", at: null };
}

function orgNormAssign(t: OrganizationTask): {
  mode: TaskAssignedMode;
  at: string | null;
} {
  if (t.assignedMode === "all") return { mode: "all", at: null };
  if (t.assignedMode === "single")
    return { mode: "single", at: dStr(t.assignedTo) };
  if (t.assignedTo != null && String(t.assignedTo).trim())
    return { mode: "single", at: String(t.assignedTo).trim() };
  return { mode: "all", at: null };
}

function dStr(v: string | null | undefined): string | null {
  if (v == null || !String(v).trim()) return null;
  return String(v).trim();
}

export function itemForAll(t: DashboardTaskItem): boolean {
  if (t.assignedMode === "all") return true;
  if (t.assignedMode === "single") return false;
  return !t.assignedTo || String(t.assignedTo).trim() === "";
}

function refMatchesDashboardViewer(
  ref: string | null | undefined,
  userId: string,
  employeeId: string | null | undefined
): boolean {
  const parsed = parseOrgTaskAssigneeRef(ref);
  const uid = String(userId ?? "").trim();
  const eid = String(employeeId ?? "").trim();
  if (parsed.userId && uid && parsed.userId === uid) return true;
  if (parsed.employeeId && eid && parsed.employeeId === eid) return true;
  if (parsed.legacyEmployeeId && eid && parsed.legacyEmployeeId === eid) return true;
  return false;
}

/** Úkol patří do „Moje úkoly“ (včetně režimu všem a multi). */
export function dashboardTaskItemForViewer(
  t: DashboardTaskItem,
  userId: string | null | undefined,
  employeeId: string | null | undefined
): boolean {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;
  if (itemForAll(t)) return true;
  if (t.assignedMode === "multi") {
    const targets = Array.isArray(t.assignedTargets) ? t.assignedTargets : [];
    return targets.some((ref) => refMatchesDashboardViewer(ref, uid, employeeId));
  }
  return refMatchesDashboardViewer(t.assignedTo, uid, employeeId);
}

export function dashboardTaskItemOpenForViewer(
  t: DashboardTaskItem,
  userId: string | null | undefined,
  employeeId: string | null | undefined
): boolean {
  if (!dashboardTaskItemForViewer(t, userId, employeeId)) return false;
  const uid = String(userId ?? "").trim();
  const perUser =
    itemForAll(t) ||
    t.assignedMode === "multi" ||
    (t.source === "organization" && organizationTaskIsForAll({ assignedMode: t.assignedMode, assignedTo: t.assignedTo } as OrganizationTask));
  if (perUser && t.source === "organization") {
    const done = (t.completedByUserIds ?? []).map(String).includes(uid);
    if (done) return false;
    return t.orgStatus !== "done";
  }
  if (t.source === "job") return t.jobStatus !== "done";
  return t.orgStatus !== "done";
}

/** @deprecated Prefer {@link dashboardTaskItemForViewer} */
export function taskAssignedToEmployee(
  t: DashboardTaskItem,
  employeeId: string | null | undefined
): boolean {
  const eid = String(employeeId ?? "").trim();
  if (!eid || itemForAll(t)) return false;
  return String(t.assignedTo ?? "").trim() === eid;
}

export type PersonalTaskDueBucket = "overdue" | "today" | "upcoming" | "none";

export function personalTaskDueBucket(
  dueIso: string | undefined,
  todayIso: string
): PersonalTaskDueBucket {
  const due = validDue(dueIso);
  if (!due) return "none";
  if (due < todayIso) return "overdue";
  if (due === todayIso) return "today";
  return "upcoming";
}

const BUCKET_RANK: Record<PersonalTaskDueBucket, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  none: 3,
};

/** Řazení osobních úkolů: po termínu → dnes → ostatní aktivní. */
export function sortPersonalAssignedTasks(
  rows: DashboardTaskItem[],
  todayIso: string
): DashboardTaskItem[] {
  return [...rows].sort((a, b) => {
    const ba = BUCKET_RANK[personalTaskDueBucket(a.dueIso, todayIso)];
    const bb = BUCKET_RANK[personalTaskDueBucket(b.dueIso, todayIso)];
    if (ba !== bb) return ba - bb;
    const da = validDue(a.dueIso) || "9999-12-31";
    const db = validDue(b.dueIso) || "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    const pa = PRIORITY_RANK[a.priority];
    const pb = PRIORITY_RANK[b.priority];
    return pa - pb;
  });
}

function sortDashboardTasks(
  rows: DashboardTaskItem[],
  todayIso: string
): DashboardTaskItem[] {
  return [...rows].sort((a, b) => {
    const da = validDue(a.dueIso);
    const db = validDue(b.dueIso);
    const overdueA = da && da < todayIso ? 0 : 1;
    const overdueB = db && db < todayIso ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    const sa = da || "9999-12-31";
    const sb = db || "9999-12-31";
    if (sa !== sb) return sa.localeCompare(sb);
    const pa = PRIORITY_RANK[a.priority];
    const pb = PRIORITY_RANK[b.priority];
    if (pa !== pb) return pa - pb;
    const aa = itemForAll(a) ? 1 : 0;
    const ab = itemForAll(b) ? 1 : 0;
    return aa - ab;
  });
}

/**
 * Stejná množina položek jako v {@link DashboardJobTasksWidget} (úkoly zakázek + organizace).
 */
export function buildMergedDashboardTaskItems(
  jobTasksRows: readonly JobTaskWithId[] | null | undefined,
  orgRaw: unknown[] | null | undefined,
  jobNameById: Map<string, string>,
  todayIso: string
): DashboardTaskItem[] {
  const out: DashboardTaskItem[] = [];

  const jlist = Array.isArray(jobTasksRows) ? jobTasksRows : [];
  for (const row of jlist) {
    if (row.status === "done") continue;
    const jid = row.jobId?.trim() ?? "";
    const { mode, at } = jobNormAssign(row);
    out.push({
      key: jid ? `job-${jid}-${row.id}` : `job-orphan-${row.id}`,
      source: "job",
      taskId: row.id,
      jobId: jid || undefined,
      title: row.title || "Bez názvu",
      note: row.note?.trim() || "",
      dueIso: row.dueDate?.trim() || undefined,
      priority: (row.priority as JobTaskPriority) || "low",
      jobStatus: (row.status as JobTaskStatus) || "active",
      jobName: jid ? jobNameById.get(jid) : undefined,
      assignedTo: at,
      assignedMode: mode,
      createdBy: dStr(row.createdBy as string | null | undefined),
    });
  }

  const olist = Array.isArray(orgRaw) ? orgRaw : [];
  for (const raw of olist) {
    if (raw == null || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const t = {
      ...o,
      id: String((o.id as string | undefined) ?? ""),
    } as OrganizationTask;
    if (!t.id || !isTaskOpen(t)) continue;
    const dueRaw =
      typeof o.dueDate === "string" && o.dueDate.trim()
        ? o.dueDate.trim()
        : undefined;
    const { mode, at } = orgNormAssign(t);

    out.push({
      key: `org-${t.id}`,
      source: "organization",
      taskId: t.id,
      title: t.title || "Bez názvu",
      note: (t.description ?? "").trim(),
      dueIso: dueRaw,
      priority: parseOrgPriority(o.priority),
      orgStatus: (t.status as OrganizationTaskStatus) || "open",
      assignedTo: at,
      assignedMode: mode,
      createdBy: dStr(t.createdBy),
      assignedTargets: Array.isArray(t.assignedTargets)
        ? t.assignedTargets.map(String)
        : undefined,
      completedByUserIds: Array.isArray(t.completedByUserIds)
        ? t.completedByUserIds.map(String)
        : undefined,
    });
  }

  return sortDashboardTasks(out, todayIso);
}
