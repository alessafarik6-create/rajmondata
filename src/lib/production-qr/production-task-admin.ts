import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { PRODUCTION_QR_TOKEN_INDEX_COLLECTION } from "@/lib/firestore-collections";
import {
  generateProductionPublicToken,
  productionQrTokensCol,
  productionTasksCol,
} from "@/lib/production-qr/production-task-paths";

export async function createProductionTask(
  db: Firestore,
  input: {
    companyId: string;
    jobId: string;
    name: string;
    description?: string | null;
    sortOrder?: number;
    plannedMinutes?: number | null;
  }
) {
  const token = generateProductionPublicToken();
  const ref = productionTasksCol(db, input.companyId, input.jobId).doc();
  await db.runTransaction(async (tx) => {
    tx.set(ref, {
      companyId: input.companyId,
      jobId: input.jobId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: "new",
      active: true,
      sortOrder: input.sortOrder ?? 0,
      plannedMinutes: input.plannedMinutes ?? null,
      publicToken: token,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection(PRODUCTION_QR_TOKEN_INDEX_COLLECTION).doc(token), {
      companyId: input.companyId,
      jobId: input.jobId,
      taskId: ref.id,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(productionQrTokensCol(db, input.companyId).doc(token), {
      jobId: input.jobId,
      taskId: ref.id,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { taskId: ref.id, publicToken: token };
}

export async function regenerateProductionTaskQr(
  db: Firestore,
  companyId: string,
  jobId: string,
  taskId: string
): Promise<{ publicToken: string }> {
  const taskRef = productionTasksCol(db, companyId, jobId).doc(taskId);
  const newToken = generateProductionPublicToken();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new Error("task_not_found");
    const oldToken = String(snap.data()?.publicToken ?? "");

    if (oldToken) {
      tx.set(db.collection(PRODUCTION_QR_TOKEN_INDEX_COLLECTION).doc(oldToken), {
        revoked: true,
        revokedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(productionQrTokensCol(db, companyId).doc(oldToken), {
        revoked: true,
        revokedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.update(taskRef, {
      publicToken: newToken,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection(PRODUCTION_QR_TOKEN_INDEX_COLLECTION).doc(newToken), {
      companyId,
      jobId,
      taskId,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(productionQrTokensCol(db, companyId).doc(newToken), {
      jobId,
      taskId,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { publicToken: newToken };
}
