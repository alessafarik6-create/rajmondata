/**
 * Firestore: companies/{companyId}/jobs/{jobId}/tasks/{taskId}
 * Pole taskScope = 'job' odliší záznam od companies/{companyId}/tasks (task manager).
 */

export const JOB_TASK_SCOPE = "job" as const;

export type JobTaskPriority = "low" | "medium" | "high";

export type JobTaskStatus = "active" | "done";

export type JobTaskRow = {
  id: string;
  companyId?: string;
  jobId?: string;
  taskScope?: string;
  title?: string;
  note?: string | null;
  dueDate?: string;
  priority?: JobTaskPriority;
  status?: JobTaskStatus;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const PRIORITY_RANK: Record<JobTaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function jobTaskPriorityLabel(p: JobTaskPriority | undefined): string {
  if (p === "high") return "Vysoká";
  if (p === "medium") return "Střední";
  return "Nízká";
}

export function jobTaskStatusLabel(s: JobTaskStatus | undefined): string {
  return s === "done" ? "Hotovo" : "Aktivní";
}

/** Řazení: aktivní po splatnosti nahoře, pak podle termínu, pak priority. Hotové vždy za aktivními. */
export function sortJobTasksForJobDetail(
  tasks: JobTaskRow[],
  todayIso: string
): { active: JobTaskRow[]; done: JobTaskRow[] } {
  const active = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const sortActive = (a: JobTaskRow, b: JobTaskRow) => {
    const da = String(a.dueDate ?? "");
    const db = String(b.dueDate ?? "");
    const overdueA = da && da < todayIso ? 0 : 1;
    const overdueB = db && db < todayIso ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    if (da !== db) return da.localeCompare(db);
    const pa = PRIORITY_RANK[(a.priority ?? "low") as JobTaskPriority] ?? 2;
    const pb = PRIORITY_RANK[(b.priority ?? "low") as JobTaskPriority] ?? 2;
    return pa - pb;
  };

  const sortDone = (a: JobTaskRow, b: JobTaskRow) =>
    String(b.dueDate ?? "").localeCompare(String(a.dueDate ?? ""));

  active.sort(sortActive);
  done.sort(sortDone);
  return { active, done };
}

/** Dashboard: jen aktivní, stejné řazení jako aktivní v detailu. */
export function sortActiveJobTasksForDashboard(
  tasks: JobTaskRow[],
  todayIso: string
): JobTaskRow[] {
  const active = tasks.filter((t) => t.status !== "done");
  return [...active].sort((a, b) => {
    const da = String(a.dueDate ?? "");
    const db = String(b.dueDate ?? "");
    const overdueA = da && da < todayIso ? 0 : 1;
    const overdueB = db && db < todayIso ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    if (da !== db) return da.localeCompare(db);
    const pa = PRIORITY_RANK[(a.priority ?? "low") as JobTaskPriority] ?? 2;
    const pb = PRIORITY_RANK[(b.priority ?? "low") as JobTaskPriority] ?? 2;
    return pa - pb;
  });
}
