import {
  FieldValue,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import {
  productionTasksCol,
  productionTimeEntriesCol,
} from "@/lib/production-qr/production-task-paths";
import type { ProductionTimeEndReason } from "@/lib/production-qr/production-task-types";
import {
  isProductionPauseEndReason,
  productionEndReasonForTariffPause,
  productionQrDisplayStatusForTariff,
  type ProductionQrDisplayStatus,
  type ProductionQrSessionDoc,
  type TariffPauseMeta,
} from "@/lib/production-qr/production-qr-session-types";

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

function closeEntryUpdates(
  startedAt: Timestamp,
  endedAt: Timestamp,
  endedReason: ProductionTimeEndReason
) {
  return {
    endedAt,
    durationSeconds: durationSecondsFromRange(startedAt, endedAt),
    endedReason,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function productionQrSessionsCol(db: Firestore, companyId: string) {
  return db.collection("companies").doc(companyId).collection("productionQrSessions");
}

function sessionRef(db: Firestore, companyId: string, employeeId: string) {
  return productionQrSessionsCol(db, companyId).doc(employeeId);
}

export async function upsertProductionQrSessionActive(
  db: Firestore,
  input: {
    companyId: string;
    employeeId: string;
    jobId: string;
    productionTaskId: string;
    activeEntryId: string;
    sessionStartedAt: string;
    shiftDateIso: string;
    jobName?: string | null;
    taskName?: string | null;
  }
): Promise<void> {
  const ref = sessionRef(db, input.companyId, input.employeeId);
  await ref.set(
    {
      companyId: input.companyId,
      employeeId: input.employeeId,
      jobId: input.jobId,
      productionTaskId: input.productionTaskId,
      jobName: input.jobName ?? null,
      taskName: input.taskName ?? null,
      displayStatus: "active" satisfies ProductionQrDisplayStatus,
      activeEntryId: input.activeEntryId,
      pendingResume: false,
      pausedAt: null,
      pauseTariffId: null,
      pauseTariffName: null,
      sessionStartedAt: input.sessionStartedAt,
      shiftDateIso: input.shiftDateIso,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function clearProductionQrSession(
  db: Firestore,
  companyId: string,
  employeeId: string,
  displayStatus: ProductionQrDisplayStatus = "ended"
): Promise<void> {
  const ref = sessionRef(db, companyId, employeeId);
  await ref.set(
    {
      displayStatus,
      activeEntryId: null,
      pendingResume: false,
      pausedAt: null,
      pauseTariffId: null,
      pauseTariffName: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Uzavře běžící QR interval kvůli tarifu a uloží kontext pro pozdější obnovení.
 */
export async function pauseActiveProductionForTariff(
  db: Firestore,
  input: {
    companyId: string;
    employeeId: string;
    shiftDateIso: string;
    tariffId: string;
    tariffName?: string | null;
    tariffMeta?: TariffPauseMeta;
    endedAt?: Timestamp;
  }
): Promise<{ paused: boolean; hadActiveEntry: boolean }> {
  const endedAt = input.endedAt ?? Timestamp.now();
  const endedReason = productionEndReasonForTariffPause(input.tariffMeta ?? { name: input.tariffName });
  const displayStatus = productionQrDisplayStatusForTariff(
    input.tariffMeta ?? { name: input.tariffName }
  );
  const entriesCol = productionTimeEntriesCol(db, input.companyId);
  const sessRef = sessionRef(db, input.companyId, input.employeeId);

  return db.runTransaction(async (tx) => {
    const activeQ = entriesCol
      .where("employeeId", "==", input.employeeId)
      .where("endedAt", "==", null)
      .limit(20);
    const activeSnap = await tx.get(activeQ);
    const sessSnap = await tx.get(sessRef);

    let jobId = "";
    let productionTaskId = "";
    let jobName: string | null = null;
    let taskName: string | null = null;
    let sessionStartedAt: string | null = null;
    let hadActiveEntry = false;
    let activeDoc: (typeof activeSnap.docs)[0] | null = null;
    let activeStartedAt: Timestamp = endedAt;

    if (!activeSnap.empty) {
      activeDoc = activeSnap.docs[0]!;
      const d = activeDoc.data() as Record<string, unknown>;
      jobId = String(d.jobId ?? "");
      productionTaskId = String(d.productionTaskId ?? "");
      sessionStartedAt = tsToIso(d.startedAt);
      hadActiveEntry = true;
      activeStartedAt = d.startedAt instanceof Timestamp ? d.startedAt : endedAt;
    } else if (sessSnap.exists) {
      const s = sessSnap.data() as ProductionQrSessionDoc;
      if (s.pendingResume && s.jobId && s.productionTaskId) {
        jobId = s.jobId;
        productionTaskId = s.productionTaskId;
        jobName = s.jobName ?? null;
        taskName = s.taskName ?? null;
        sessionStartedAt = s.sessionStartedAt ?? null;
      }
    }

    if (!jobId || !productionTaskId) {
      return { paused: false, hadActiveEntry };
    }

    if (!taskName) {
      const taskRef = productionTasksCol(db, input.companyId, jobId).doc(productionTaskId);
      const taskSnap = await tx.get(taskRef);
      if (taskSnap.exists) {
        taskName = String((taskSnap.data() as Record<string, unknown>).name ?? productionTaskId);
      }
    }

    if (activeDoc) {
      tx.update(
        activeDoc.ref,
        closeEntryUpdates(activeStartedAt, endedAt, endedReason)
      );
    }

    tx.set(
      sessRef,
      {
        companyId: input.companyId,
        employeeId: input.employeeId,
        jobId,
        productionTaskId,
        jobName,
        taskName,
        displayStatus,
        activeEntryId: null,
        pendingResume: true,
        pausedAt: endedAt.toDate().toISOString(),
        pauseTariffId: input.tariffId,
        pauseTariffName: input.tariffName ?? null,
        sessionStartedAt: sessionStartedAt ?? endedAt.toDate().toISOString(),
        shiftDateIso: input.shiftDateIso,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { paused: true, hadActiveEntry };
  });
}

/**
 * Po ukončení tarifního úseku obnoví QR měření, pokud je splněna podmínka pendingResume.
 */
export async function tryResumeProductionAfterTariffEnd(
  db: Firestore,
  input: {
    companyId: string;
    employeeId: string;
    shiftDateIso: string;
    endedAt?: Timestamp;
  }
): Promise<{ resumed: boolean; activeEntryId?: string }> {
  const endedAt = input.endedAt ?? Timestamp.now();
  const entriesCol = productionTimeEntriesCol(db, input.companyId);
  const sessRef = sessionRef(db, input.companyId, input.employeeId);

  return db.runTransaction(async (tx) => {
    const sessSnap = await tx.get(sessRef);
    if (!sessSnap.exists) return { resumed: false };

    const session = sessSnap.data() as ProductionQrSessionDoc;
    if (!session.pendingResume) return { resumed: false };
    if (session.displayStatus === "active" || session.displayStatus === "ended") {
      return { resumed: false };
    }
    if (session.shiftDateIso !== input.shiftDateIso) return { resumed: false };

    const activeQ = entriesCol
      .where("employeeId", "==", input.employeeId)
      .where("endedAt", "==", null)
      .limit(5);
    const activeSnap = await tx.get(activeQ);
    if (!activeSnap.empty) return { resumed: false };

    const jobId = session.jobId;
    const productionTaskId = session.productionTaskId;
    if (!jobId || !productionTaskId) return { resumed: false };

    const taskRef = productionTasksCol(db, input.companyId, jobId).doc(productionTaskId);
    const taskSnap = await tx.get(taskRef);
    if (!taskSnap.exists) return { resumed: false };
    const taskData = taskSnap.data() as Record<string, unknown>;
    if (taskData.active === false) return { resumed: false };

    const newRef = entriesCol.doc();
    tx.set(newRef, {
      companyId: input.companyId,
      jobId,
      productionTaskId,
      employeeId: input.employeeId,
      startedAt: endedAt,
      endedAt: null,
      durationSeconds: null,
      endedReason: null,
      source: "qr",
      deviceInfo: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const status = String(taskData.status ?? "new");
    if (status === "new") {
      tx.update(taskRef, {
        status: "in_progress",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(
      sessRef,
      {
        displayStatus: "active" satisfies ProductionQrDisplayStatus,
        activeEntryId: newRef.id,
        pendingResume: false,
        pausedAt: null,
        pauseTariffId: null,
        pauseTariffName: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { resumed: true, activeEntryId: newRef.id };
  });
}

/** Součet odpracovaného času na úkolu (uzavřené intervaly + volitelně běžící). */
export async function sumProductionWorkedSecondsForTask(
  db: Firestore,
  companyId: string,
  employeeId: string,
  jobId: string,
  productionTaskId: string,
  nowMs: number
): Promise<number> {
  const snap = await productionTimeEntriesCol(db, companyId)
    .where("employeeId", "==", employeeId)
    .where("jobId", "==", jobId)
    .where("productionTaskId", "==", productionTaskId)
    .limit(80)
    .get();

  let total = 0;
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (typeof d.durationSeconds === "number" && d.endedAt != null) {
      total += d.durationSeconds;
      continue;
    }
    if (d.endedAt == null && d.startedAt instanceof Timestamp) {
      total += Math.max(0, Math.round((nowMs - d.startedAt.toMillis()) / 1000));
    }
  }
  return total;
}

export async function loadPausedProductionQrSessions(
  db: Firestore,
  companyId: string,
  shiftDateIso: string
): Promise<(ProductionQrSessionDoc & { id: string })[]> {
  const snap = await productionQrSessionsCol(db, companyId)
    .where("pendingResume", "==", true)
    .limit(50)
    .get();

  const out: (ProductionQrSessionDoc & { id: string })[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as ProductionQrSessionDoc;
    if (d.shiftDateIso !== shiftDateIso) continue;
    if (d.displayStatus === "ended" || d.displayStatus === "active") continue;
    out.push({ ...d, id: doc.id });
  }
  return out;
}

export { isProductionPauseEndReason, productionEndReasonForTariffPause };
