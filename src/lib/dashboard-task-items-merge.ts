import type {
  JobTaskRow,
  JobTaskPriority,
  JobTaskStatus,
  TaskAssignedMode,
} from "@/lib/job-task-types";
import type { OrganizationTask, OrganizationTaskStatus } from "@/lib/organization-task";
import { isTaskOpen } from "@/lib/organization-task";

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
    });
  }

  return sortDashboardTasks(out, todayIso);
}
