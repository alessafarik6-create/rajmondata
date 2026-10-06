import type { Firestore } from "firebase-admin/firestore";
import { PRODUCTION_QR_TOKEN_INDEX_COLLECTION } from "@/lib/firestore-collections";
import { productionTasksCol } from "@/lib/production-qr/production-task-paths";
import type { ProductionTaskStatus } from "@/lib/production-qr/production-task-types";

export type ResolvedProductionQrTask = {
  companyId: string;
  jobId: string;
  taskId: string;
  taskName: string;
  taskDescription: string | null;
  taskStatus: ProductionTaskStatus;
  taskActive: boolean;
  jobDisplayName: string;
};

export async function resolveProductionTaskByPublicToken(
  db: Firestore,
  tokenRaw: string
): Promise<ResolvedProductionQrTask | null> {
  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 20) return null;

  const indexSnap = await db.collection(PRODUCTION_QR_TOKEN_INDEX_COLLECTION).doc(token).get();
  if (!indexSnap.exists) return null;
  const index = indexSnap.data() as Record<string, unknown>;
  if (index.revoked === true) return null;

  const companyId = String(index.companyId ?? "").trim();
  const jobId = String(index.jobId ?? "").trim();
  const taskId = String(index.taskId ?? "").trim();
  if (!companyId || !jobId || !taskId) return null;

  const [taskSnap, jobSnap] = await Promise.all([
    productionTasksCol(db, companyId, jobId).doc(taskId).get(),
    db.collection("companies").doc(companyId).collection("jobs").doc(jobId).get(),
  ]);
  if (!taskSnap.exists) return null;
  const task = taskSnap.data() as Record<string, unknown>;
  if (task.active === false) return null;
  if (String(task.publicToken ?? "") !== token) return null;

  const job = jobSnap.exists ? (jobSnap.data() as Record<string, unknown>) : {};
  const jobDisplayName =
    String(job.productionInternalLabel ?? "").trim() ||
    String(job.name ?? "").trim() ||
    String(job.title ?? "").trim() ||
    jobId;

  return {
    companyId,
    jobId,
    taskId,
    taskName: String(task.name ?? "Úkol"),
    taskDescription: task.description != null ? String(task.description) : null,
    taskStatus: (String(task.status ?? "new") as ProductionTaskStatus) || "new",
    taskActive: task.active !== false,
    jobDisplayName,
  };
}
