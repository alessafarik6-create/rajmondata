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
    nameUk?: string | null;
    descriptionUk?: string | null;
    activityType?: string | null;
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
      nameUk: input.nameUk?.trim() || null,
      descriptionUk: input.descriptionUk?.trim() || null,
      activityType: input.activityType?.trim() || null,
      status: "new",
      active: true,
      archived: false,
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

export async function copyProductionTasksToJob(
  db: Firestore,
  input: {
    companyId: string;
    sourceJobId: string;
    targetJobId: string;
    taskIds: string[];
  }
): Promise<{ createdIds: string[] }> {
  const { companyId, sourceJobId, targetJobId, taskIds } = input;
  if (!taskIds.length) return { createdIds: [] };

  const sourceCol = productionTasksCol(db, companyId, sourceJobId);
  const snaps = await Promise.all(taskIds.map((id) => sourceCol.doc(id).get()));
  const createdIds: string[] = [];

  let sortBase = 0;
  const targetSnap = await productionTasksCol(db, companyId, targetJobId)
    .orderBy("sortOrder", "desc")
    .limit(1)
    .get();
  if (!targetSnap.empty) {
    sortBase = Number(targetSnap.docs[0]!.data().sortOrder ?? 0) + 1;
  }

  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i]!;
    if (!snap.exists) continue;
    const d = snap.data() as Record<string, unknown>;
    const created = await createProductionTask(db, {
      companyId,
      jobId: targetJobId,
      name: String(d.name ?? "Úkol"),
      description: d.description != null ? String(d.description) : null,
      nameUk: d.nameUk != null ? String(d.nameUk) : null,
      descriptionUk: d.descriptionUk != null ? String(d.descriptionUk) : null,
      activityType: d.activityType != null ? String(d.activityType) : null,
      sortOrder: sortBase + i,
      plannedMinutes:
        d.plannedMinutes != null && !Number.isNaN(Number(d.plannedMinutes))
          ? Number(d.plannedMinutes)
          : null,
    });
    createdIds.push(created.taskId);
  }

  return { createdIds };
}
