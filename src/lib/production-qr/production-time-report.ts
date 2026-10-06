import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { productionTasksCol, productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return null;
}

export type JobProductionTimeReport = {
  jobId: string;
  totalSeconds: number;
  byTask: {
    taskId: string;
    taskName: string;
    totalSeconds: number;
    byEmployee: { employeeId: string; employeeName: string; seconds: number }[];
  }[];
};

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
    { totalSeconds: number; byEmp: Map<string, number> }
  >();

  const now = Date.now();
  for (const doc of entriesSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const taskId = String(d.productionTaskId ?? "");
    if (!taskId) continue;
    let seconds = typeof d.durationSeconds === "number" ? d.durationSeconds : 0;
    if (d.endedAt == null && d.startedAt instanceof Timestamp) {
      seconds = Math.max(0, Math.round((now - d.startedAt.toMillis()) / 1000));
    }
    const bucket = byTask.get(taskId) ?? { totalSeconds: 0, byEmp: new Map() };
    bucket.totalSeconds += seconds;
    const empId = String(d.employeeId ?? "");
    bucket.byEmp.set(empId, (bucket.byEmp.get(empId) ?? 0) + seconds);
    byTask.set(taskId, bucket);
  }

  let totalSeconds = 0;
  const byTaskOut: JobProductionTimeReport["byTask"] = [];

  for (const t of tasksSnap.docs) {
    const bucket = byTask.get(t.id) ?? { totalSeconds: 0, byEmp: new Map() };
    totalSeconds += bucket.totalSeconds;
    byTaskOut.push({
      taskId: t.id,
      taskName: taskNames.get(t.id) ?? t.id,
      totalSeconds: bucket.totalSeconds,
      byEmployee: [...bucket.byEmp.entries()]
        .map(([employeeId, seconds]) => ({
          employeeId,
          employeeName: empNames.get(employeeId) ?? employeeId,
          seconds,
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
      byEmployee: [...bucket.byEmp.entries()].map(([employeeId, seconds]) => ({
        employeeId,
        employeeName: empNames.get(employeeId) ?? employeeId,
        seconds,
      })),
    });
  }

  return { jobId, totalSeconds, byTask: byTaskOut };
}

export { formatDurationCs } from "@/lib/production-qr/format-duration-cs";
