import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { productionTasksCol, productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";
import type { ProductionTimeEndReason } from "@/lib/production-qr/production-task-types";

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return null;
}

export type ProductionTimeSessionRow = {
  entryId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  isRunning: boolean;
  endedReason?: ProductionTimeEndReason | null;
};

export type JobProductionTimeReport = {
  jobId: string;
  totalSeconds: number;
  byTask: {
    taskId: string;
    taskName: string;
    totalSeconds: number;
    byEmployee: {
      employeeId: string;
      employeeName: string;
      seconds: number;
      sessions: ProductionTimeSessionRow[];
    }[];
  }[];
};

function entryDurationSeconds(d: Record<string, unknown>, nowMs: number): number {
  if (typeof d.durationSeconds === "number" && d.endedAt != null) {
    return d.durationSeconds;
  }
  if (d.startedAt instanceof Timestamp) {
    if (d.endedAt instanceof Timestamp) {
      return Math.max(0, Math.round((d.endedAt.toMillis() - d.startedAt.toMillis()) / 1000));
    }
    return Math.max(0, Math.round((nowMs - d.startedAt.toMillis()) / 1000));
  }
  return 0;
}

export async function buildJobProductionTimeReport(
  db: Firestore,
  companyId: string,
  jobId: string
): Promise<JobProductionTimeReport> {
  const [tasksSnap, entriesSnap, empSnap] = await Promise.all([
    productionTasksCol(db, companyId, jobId).orderBy("sortOrder", "asc").get(),
    productionTimeEntriesCol(db, companyId).where("jobId", "==", jobId).get(),
    db.collection("companies").doc(companyId).collection("employees").get(),
  ]);

  const empNames = new Map<string, string>();
  for (const d of empSnap.docs) {
    const e = d.data() as Record<string, unknown>;
    const name = `${String(e.firstName ?? "")} ${String(e.lastName ?? "")}`.trim() || d.id;
    empNames.set(d.id, name);
  }

  const taskNames = new Map<string, string>();
  for (const t of tasksSnap.docs) {
    taskNames.set(t.id, String((t.data() as Record<string, unknown>).name ?? t.id));
  }

  const byTask = new Map<
    string,
    { totalSeconds: number; byEmp: Map<string, { seconds: number; sessions: ProductionTimeSessionRow[] }> }
  >();

  const nowMs = Date.now();
  for (const doc of entriesSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const taskId = String(d.productionTaskId ?? "");
    if (!taskId) continue;
    const seconds = entryDurationSeconds(d, nowMs);
    const startedAt = tsToIso(d.startedAt);
    if (!startedAt) continue;
    const endedAt = tsToIso(d.endedAt);
    const isRunning = d.endedAt == null;
    const endedReason = d.endedReason as ProductionTimeEndReason | null | undefined;

    const session: ProductionTimeSessionRow = {
      entryId: doc.id,
      startedAt,
      endedAt,
      durationSeconds: seconds,
      isRunning,
      endedReason: endedReason ?? null,
    };

    const bucket = byTask.get(taskId) ?? { totalSeconds: 0, byEmp: new Map() };
    bucket.totalSeconds += seconds;
    const empId = String(d.employeeId ?? "");
    const empBucket = bucket.byEmp.get(empId) ?? { seconds: 0, sessions: [] };
    empBucket.seconds += seconds;
    empBucket.sessions.push(session);
    bucket.byEmp.set(empId, empBucket);
    byTask.set(taskId, bucket);
  }

  let totalSeconds = 0;
  const byTaskOut: JobProductionTimeReport["byTask"] = [];

  const sortSessions = (sessions: ProductionTimeSessionRow[]) =>
    [...sessions].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

  for (const t of tasksSnap.docs) {
    const bucket = byTask.get(t.id) ?? { totalSeconds: 0, byEmp: new Map() };
    totalSeconds += bucket.totalSeconds;
    byTaskOut.push({
      taskId: t.id,
      taskName: taskNames.get(t.id) ?? t.id,
      totalSeconds: bucket.totalSeconds,
      byEmployee: [...bucket.byEmp.entries()]
        .map(([employeeId, empData]) => ({
          employeeId,
          employeeName: empNames.get(employeeId) ?? employeeId,
          seconds: empData.seconds,
          sessions: sortSessions(empData.sessions),
        }))
        .sort((a, b) => b.seconds - a.seconds),
    });
  }

  for (const [taskId, bucket] of byTask) {
    if (taskNames.has(taskId)) continue;
    totalSeconds += bucket.totalSeconds;
    byTaskOut.push({
      taskId,
      taskName: taskId,
      totalSeconds: bucket.totalSeconds,
      byEmployee: [...bucket.byEmp.entries()].map(([employeeId, empData]) => ({
        employeeId,
        employeeName: empNames.get(employeeId) ?? employeeId,
        seconds: empData.seconds,
        sessions: sortSessions(empData.sessions),
      })),
    });
  }

  return { jobId, totalSeconds, byTask: byTaskOut };
}

export { formatDurationCs } from "@/lib/production-qr/format-duration-cs";
