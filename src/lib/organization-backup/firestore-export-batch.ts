import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { collectStoragePathsFromValue } from "@/lib/organization-backup/extract-storage-paths";
import { serializeFirestoreValue } from "@/lib/organization-backup/serialize-firestore";
import type { FirestoreExportLine } from "@/lib/organization-backup/types";
import { BACKUP_MAX_DOCS_PER_RUN } from "@/lib/organization-backup/constants";

export type CollectionScanJob = {
  /** Plná cesta kolekce, např. companies/org/jobs */
  collectionPath: string;
  startAfter: string | null;
};

export type FirestoreExportBatchState = {
  initialized: boolean;
  companyDocDone: boolean;
  orgDocDone: boolean;
  /** 0 = users.companyId, 1 = users.organizationId, 2 = hotovo */
  usersPhase: 0 | 1 | 2;
  usersStartAfter: string | null;
  usersDone: boolean;
  pendingScans: CollectionScanJob[];
  ndjsonPart: number;
  totalDocs: number;
  byTop: Record<string, number>;
  storagePaths: string[];
};

export function createEmptyFirestoreExportBatchState(): FirestoreExportBatchState {
  return {
    initialized: false,
    companyDocDone: false,
    orgDocDone: false,
    usersPhase: 0,
    usersStartAfter: null,
    usersDone: false,
    pendingScans: [],
    ndjsonPart: 0,
    totalDocs: 0,
    byTop: {},
    storagePaths: [],
  };
}

function topCollectionKey(docPath: string): string {
  const parts = docPath.split("/");
  return parts.length >= 4 ? parts[3]! : "_root";
}

function mergeStoragePaths(state: FirestoreExportBatchState, data: Record<string, unknown>, organizationId: string): void {
  const set = new Set(state.storagePaths);
  collectStoragePathsFromValue(data, organizationId, set);
  state.storagePaths = Array.from(set);
}

function pushLine(
  state: FirestoreExportBatchState,
  organizationId: string,
  path: string,
  id: string,
  data: Record<string, unknown>,
  lines: FirestoreExportLine[]
): void {
  mergeStoragePaths(state, data, organizationId);
  lines.push({ path, id, data });
  state.totalDocs += 1;
  const top = topCollectionKey(path);
  state.byTop[top] = (state.byTop[top] ?? 0) + 1;
}

async function initFirestoreExportState(
  db: Firestore,
  organizationId: string,
  state: FirestoreExportBatchState,
  skipSubcollections: Set<string>
): Promise<void> {
  if (state.initialized) return;
  const companyRef = db.collection(COMPANIES_COLLECTION).doc(organizationId);
  const subcols = await companyRef.listCollections();
  for (const col of subcols) {
    if (skipSubcollections.has(col.id)) continue;
    state.pendingScans.push({ collectionPath: col.path, startAfter: null });
  }
  state.initialized = true;
}

async function exportUsersPage(
  db: Firestore,
  organizationId: string,
  state: FirestoreExportBatchState,
  lines: FirestoreExportLine[],
  budget: number
): Promise<number> {
  let used = 0;
  if (state.usersDone || state.usersPhase >= 2 || budget <= 0) return used;

  while (state.usersPhase < 2 && used < budget) {
    const field = state.usersPhase === 0 ? "companyId" : "organizationId";
    const pageSize = Math.min(200, budget - used);
    let q = db
      .collection("users")
      .where(field, "==", organizationId)
      .orderBy("__name__")
      .limit(pageSize);
    if (state.usersStartAfter) q = q.startAfter(state.usersStartAfter);
    const page = await q.get();

    if (page.empty) {
      state.usersPhase = (state.usersPhase + 1) as 0 | 1 | 2;
      state.usersStartAfter = null;
      if (state.usersPhase >= 2) state.usersDone = true;
      continue;
    }

    for (const snap of page.docs) {
      if (used >= budget) break;
      const raw = snap.data();
      const safe: Record<string, unknown> = { ...raw };
      delete safe.passwordHash;
      delete safe.terminalPinHash;
      const data = serializeFirestoreValue(safe) as Record<string, unknown>;
      pushLine(state, organizationId, snap.ref.path, snap.id, data, lines);
      used += 1;
      state.usersStartAfter = snap.id;
    }

    if (used >= budget) break;

    if (page.size < pageSize) {
      state.usersPhase = (state.usersPhase + 1) as 0 | 1 | 2;
      state.usersStartAfter = null;
      if (state.usersPhase >= 2) state.usersDone = true;
    }
  }

  return used;
}

/**
 * Exportuje max `maxDocs` dokumentů a vrátí aktualizovaný stav.
 */
export async function runFirestoreExportBatch(params: {
  db: Firestore;
  organizationId: string;
  state: FirestoreExportBatchState;
  skipSubcollections: Set<string>;
  maxDocs?: number;
}): Promise<{ lines: FirestoreExportLine[]; state: FirestoreExportBatchState; firestoreDone: boolean }> {
  const maxDocs = params.maxDocs ?? BACKUP_MAX_DOCS_PER_RUN;
  const state: FirestoreExportBatchState = {
    ...params.state,
    pendingScans: params.state.pendingScans.map((j) => ({ ...j })),
    byTop: { ...params.state.byTop },
    storagePaths: [...params.state.storagePaths],
  };
  const lines: FirestoreExportLine[] = [];

  await initFirestoreExportState(params.db, params.organizationId, state, params.skipSubcollections);

  let budget = maxDocs;

  if (!state.companyDocDone && budget > 0) {
    const ref = params.db.collection(COMPANIES_COLLECTION).doc(params.organizationId);
    const snap = await ref.get();
    if (snap.exists) {
      const data = serializeFirestoreValue(snap.data()) as Record<string, unknown>;
      pushLine(state, params.organizationId, ref.path, ref.id, data, lines);
      budget -= 1;
    }
    state.companyDocDone = true;
  }

  if (!state.orgDocDone && budget > 0) {
    const ref = params.db.collection(ORGANIZATIONS_COLLECTION).doc(params.organizationId);
    const snap = await ref.get();
    if (snap.exists) {
      const data = serializeFirestoreValue(snap.data()) as Record<string, unknown>;
      pushLine(state, params.organizationId, ref.path, ref.id, data, lines);
      budget -= 1;
      state.byTop[ORGANIZATIONS_COLLECTION] = (state.byTop[ORGANIZATIONS_COLLECTION] ?? 0) + 1;
    }
    state.orgDocDone = true;
  }

  if (!state.usersDone && budget > 0) {
    const used = await exportUsersPage(params.db, params.organizationId, state, lines, budget);
    budget -= used;
  }

  while (budget > 0 && state.pendingScans.length > 0) {
    const jobIndex = state.pendingScans.length - 1;
    const job = state.pendingScans[jobIndex]!;
    const colRef = params.db.collection(job.collectionPath);
    const pageLimit = Math.min(150, budget);
    let q = colRef.orderBy("__name__").limit(pageLimit);
    if (job.startAfter) {
      q = q.startAfter(colRef.doc(job.startAfter));
    }
    const page = await q.get();

    if (page.empty) {
      state.pendingScans.pop();
      continue;
    }

    let stoppedEarly = false;
    for (const docSnap of page.docs) {
      if (budget <= 0) {
        stoppedEarly = true;
        break;
      }
      const data = serializeFirestoreValue(docSnap.data()) as Record<string, unknown>;
      pushLine(state, params.organizationId, docSnap.ref.path, docSnap.id, data, lines);
      budget -= 1;
      job.startAfter = docSnap.id;

      const subcols = await docSnap.ref.listCollections();
      for (const sub of subcols) {
        if (params.skipSubcollections.has(sub.id)) continue;
        state.pendingScans.push({ collectionPath: sub.path, startAfter: null });
      }
    }

    const collectionFinished = !stoppedEarly && page.size < pageLimit;
    if (collectionFinished) {
      state.pendingScans.pop();
    } else {
      state.pendingScans[jobIndex] = {
        collectionPath: job.collectionPath,
        startAfter: job.startAfter,
      };
    }
  }

  const firestoreDone =
    state.companyDocDone &&
    state.orgDocDone &&
    state.usersDone &&
    state.pendingScans.length === 0;

  return { lines, state, firestoreDone };
}
