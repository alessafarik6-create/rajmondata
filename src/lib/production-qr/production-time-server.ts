import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import {
  productionTasksCol,
  productionTimeEntriesCol,
} from "@/lib/production-qr/production-task-paths";
import type { ProductionTaskStatus } from "@/lib/production-qr/production-task-types";

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function durationSecondsFromRange(start: Timestamp, end: Timestamp): number {
  const ms = end.toMillis() - start.toMillis();
  return Math.max(0, Math.round(ms / 1000));
}

export type StartProductionQrResult = {
  alreadyActiveOnSameTask: boolean;
  previousTaskStopped: boolean;
  activeEntryId: string;
  startedAt: string;
  endedPreviousEntryId?: string | null;
};

export async function startProductionTimeViaQr(
  db: Firestore,
  input: {
    companyId: string;
    jobId: string;
    productionTaskId: string;
    employeeId: string;
    deviceInfo?: string | null;
  }
): Promise<StartProductionQrResult> {
  const { companyId, jobId, productionTaskId, employeeId } = input;
  const entriesCol = productionTimeEntriesCol(db, companyId);
  const taskRef = productionTasksCol(db, companyId, jobId).doc(productionTaskId);

  return db.runTransaction(async (tx) => {
    const taskSnap = await tx.get(taskRef);
    if (!taskSnap.exists) throw new Error("task_not_found");
    const taskData = taskSnap.data() as Record<string, unknown>;
    if (taskData.active === false) throw new Error("task_inactive");

    const activeQ = entriesCol
      .where("employeeId", "==", employeeId)
      .where("endedAt", "==", null)
      .limit(20);
    const activeSnap = await tx.get(activeQ);

    let previousTaskStopped = false;
    let endedPreviousEntryId: string | null = null;
    let alreadyActiveOnSameTask = false;
    let existingSameId: string | null = null;
    let existingSameStarted: Timestamp | null = null;

    const now = Timestamp.now();

    for (const doc of activeSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const sameTask =
        String(d.productionTaskId ?? "") === productionTaskId &&
        String(d.jobId ?? "") === jobId;
      if (sameTask) {
        alreadyActiveOnSameTask = true;
        existingSameId = doc.id;
        existingSameStarted =
          d.startedAt instanceof Timestamp ? d.startedAt : now;
        continue;
      }
      const startedAt =
        d.startedAt instanceof Timestamp ? d.startedAt : now;
      tx.update(doc.ref, {
        endedAt: now,
        durationSeconds: durationSecondsFromRange(startedAt, now),
        updatedAt: FieldValue.serverTimestamp(),
      });
      previousTaskStopped = true;
      endedPreviousEntryId = doc.id;
    }

    if (alreadyActiveOnSameTask && existingSameId) {
      return {
        alreadyActiveOnSameTask: true,
        previousTaskStopped,
        activeEntryId: existingSameId,
        startedAt: tsToIso(existingSameStarted) ?? now.toDate().toISOString(),
        endedPreviousEntryId,
      };
    }

    const newRef = entriesCol.doc();
    tx.set(newRef, {
      companyId,
      jobId,
      productionTaskId,
      employeeId,
      startedAt: now,
      endedAt: null,
      durationSeconds: null,
      source: "qr",
      deviceInfo: input.deviceInfo?.slice(0, 200) ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const status = String(taskData.status ?? "new") as ProductionTaskStatus;
    if (status === "new") {
      tx.update(taskRef, {
        status: "in_progress",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      alreadyActiveOnSameTask: false,
      previousTaskStopped,
      activeEntryId: newRef.id,
      startedAt: now.toDate().toISOString(),
      endedPreviousEntryId,
    };
  });
}

export async function stopProductionTimeViaQr(
  db: Firestore,
  input: {
    companyId: string;
    employeeId: string;
    productionTaskId?: string;
    jobId?: string;
  }
): Promise<{ stopped: boolean; entryId?: string; endedAt?: string; durationSeconds?: number }> {
  const entriesCol = productionTimeEntriesCol(db, input.companyId);

  return db.runTransaction(async (tx) => {
    const activeQ = entriesCol
      .where("employeeId", "==", input.employeeId)
      .where("endedAt", "==", null)
      .limit(20);
    const activeSnap = await tx.get(activeQ);
    if (activeSnap.empty) return { stopped: false };

    const now = Timestamp.now();
    let stoppedDoc: (typeof activeSnap.docs)[0] | null = null;

    for (const doc of activeSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (input.productionTaskId && input.jobId) {
        const match =
          String(d.productionTaskId ?? "") === input.productionTaskId &&
          String(d.jobId ?? "") === input.jobId;
        if (!match) continue;
      }
      stoppedDoc = doc;
      break;
    }

    if (!stoppedDoc && !input.productionTaskId) {
      stoppedDoc = activeSnap.docs[0] ?? null;
    }
    if (!stoppedDoc) return { stopped: false };

    const d = stoppedDoc.data() as Record<string, unknown>;
    const startedAt =
      d.startedAt instanceof Timestamp ? d.startedAt : now;
    const durationSeconds = durationSecondsFromRange(startedAt, now);
    tx.update(stoppedDoc.ref, {
      endedAt: now,
      durationSeconds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      stopped: true,
      entryId: stoppedDoc.id,
      endedAt: now.toDate().toISOString(),
      durationSeconds,
    };
  });
}

export async function findActiveProductionEntryForEmployee(
  db: Firestore,
  companyId: string,
  employeeId: string
) {
  const snap = await productionTimeEntriesCol(db, companyId)
    .where("employeeId", "==", employeeId)
    .where("endedAt", "==", null)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  const d = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    jobId: String(d.jobId ?? ""),
    productionTaskId: String(d.productionTaskId ?? ""),
    startedAt: tsToIso(d.startedAt),
  };
}
