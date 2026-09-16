import { createHash } from "node:crypto";
import type { Firestore, DocumentReference } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  getAdminBackupStorageBucket,
  getAdminStorageBucket,
  organizationBackupStoragePrefix,
} from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  BACKUP_MAX_FILES_PER_RUN,
  BACKUP_MAX_FIRESTORE_DOCS,
  ORGANIZATION_BACKUP_SCHEMA_VERSION,
  ORGANIZATION_BACKUPS_SUBCOLLECTION,
  type OrganizationBackupType,
} from "@/lib/organization-backup/constants";
import { collectStoragePathsFromValue } from "@/lib/organization-backup/extract-storage-paths";
import { computeBackupExpiresAt } from "@/lib/organization-backup/retention";
import { serializeFirestoreValue } from "@/lib/organization-backup/serialize-firestore";
import type {
  BackupFileEntry,
  BackupManifest,
  FirestoreExportLine,
  OrganizationBackupCheckpoint,
  OrganizationBackupRecordCounts,
} from "@/lib/organization-backup/types";
import { logOrganizationBackupAuditAdmin } from "@/lib/organization-backup/audit-admin";

const PAGE_SIZE = 400;

function backupDocRef(db: Firestore, organizationId: string, backupId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
    .doc(backupId);
}

export async function createOrganizationBackupRecord(
  db: Firestore,
  params: {
    organizationId: string;
    organizationName: string;
    backupType: OrganizationBackupType;
    createdBy: string | null;
    sourceBackupId?: string | null;
  }
): Promise<string> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.organizationId)
    .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
    .doc();
  const now = new Date();
  const expiresAt = computeBackupExpiresAt(params.backupType, now);
  await ref.set({
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    backupType: params.backupType,
    status: "CREATING",
    schemaVersion: ORGANIZATION_BACKUP_SCHEMA_VERSION,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: params.createdBy,
    completedAt: null,
    storagePath: null,
    sizeBytes: 0,
    recordCount: 0,
    fileCount: 0,
    recordCounts: null,
    checksum: null,
    error: null,
    expiresAt: Timestamp.fromDate(expiresAt),
    pendingDeletionAt: null,
    sourceBackupId: params.sourceBackupId ?? null,
    checkpoint: {
      phase: "firestore",
      firestoreDocIndex: 0,
      fileIndex: 0,
      firestoreNdjsonPath: "firestore/export.ndjson",
      filePaths: [],
    } satisfies OrganizationBackupCheckpoint,
  });
  return ref.id;
}

async function loadOrganizationName(db: Firestore, organizationId: string): Promise<string> {
  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
  if (companySnap.exists) {
    const d = companySnap.data() as { companyName?: string; name?: string };
    const n = String(d.companyName || d.name || "").trim();
    if (n) return n;
  }
  const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId).get();
  if (orgSnap.exists) {
    const d = orgSnap.data() as { name?: string; companyName?: string };
    return String(d.name || d.companyName || organizationId).trim();
  }
  return organizationId;
}

type ExportWalkState = {
  lines: FirestoreExportLine[];
  storagePaths: Set<string>;
  totalDocs: number;
  byTop: Record<string, number>;
};

async function exportDocumentTree(
  docRef: DocumentReference,
  state: ExportWalkState,
  organizationId: string,
  skipSubcollections: Set<string>
): Promise<void> {
  if (state.totalDocs >= BACKUP_MAX_FIRESTORE_DOCS) return;

  const snap = await docRef.get();
  if (snap.exists) {
    const data = serializeFirestoreValue(snap.data()) as Record<string, unknown>;
    collectStoragePathsFromValue(data, organizationId, state.storagePaths);
    state.lines.push({
      path: docRef.path,
      id: docRef.id,
      data,
    });
    state.totalDocs += 1;
    const parts = docRef.path.split("/");
    const top = parts.length >= 4 ? parts[3] : "_root";
    state.byTop[top] = (state.byTop[top] ?? 0) + 1;
  }

  const subcols = await docRef.listCollections();
  for (const col of subcols) {
    if (skipSubcollections.has(col.id)) continue;
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (state.totalDocs >= BACKUP_MAX_FIRESTORE_DOCS) break;
      let q = col.orderBy("__name__").limit(PAGE_SIZE);
      if (last) q = q.startAfter(last);
      const page = await q.get();
      if (page.empty) break;
      for (const child of page.docs) {
        await exportDocumentTree(child.ref, state, organizationId, skipSubcollections);
        if (state.totalDocs >= BACKUP_MAX_FIRESTORE_DOCS) break;
      }
      last = page.docs[page.docs.length - 1];
      if (page.size < PAGE_SIZE) break;
    }
  }
}

async function exportOrgUsers(
  db: Firestore,
  organizationId: string,
  state: ExportWalkState
): Promise<void> {
  for (const field of ["companyId", "organizationId"] as const) {
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.collection("users").where(field, "==", organizationId).orderBy("__name__").limit(PAGE_SIZE);
      if (last) q = q.startAfter(last);
      const page = await q.get();
      if (page.empty) break;
      for (const snap of page.docs) {
        const raw = snap.data();
        const safe: Record<string, unknown> = { ...raw };
        delete safe.passwordHash;
        delete safe.terminalPinHash;
        const data = serializeFirestoreValue(safe) as Record<string, unknown>;
        collectStoragePathsFromValue(data, organizationId, state.storagePaths);
        state.lines.push({ path: snap.ref.path, id: snap.id, data });
        state.totalDocs += 1;
        state.byTop.users = (state.byTop.users ?? 0) + 1;
      }
      last = page.docs[page.docs.length - 1];
      if (page.size < PAGE_SIZE) break;
    }
  }
}

async function uploadJson(bucket: any, path: string, body: string | Buffer): Promise<number> {
  const file = bucket.file(path);
  await file.save(body, {
    resumable: false,
    metadata: {
      contentType: "application/json",
      cacheControl: "private, max-age=0",
    },
  });
  const [meta] = await file.getMetadata();
  return Number(meta.size ?? body.length);
}

export type RunBackupJobResult = {
  backupId: string;
  status: "CREATING" | "VERIFYING" | "COMPLETED" | "FAILED";
  done: boolean;
  recordCount: number;
  fileCount: number;
  sizeBytes: number;
};

/**
 * Pokračuje / dokončí export zálohy (volat opakovaně z API nebo cronu).
 */
export async function runOrganizationBackupJob(
  db: Firestore,
  organizationId: string,
  backupId: string,
  createdBy: string | null
): Promise<RunBackupJobResult> {
  const ref = backupDocRef(db, organizationId, backupId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Záloha neexistuje.");
  }
  const row = snap.data() as Record<string, unknown>;
  if (row.status === "COMPLETED" || row.status === "FAILED") {
    return {
      backupId,
      status: row.status as RunBackupJobResult["status"],
      done: true,
      recordCount: Number(row.recordCount ?? 0),
      fileCount: Number(row.fileCount ?? 0),
      sizeBytes: Number(row.sizeBytes ?? 0),
    };
  }

  const backupBucket = getAdminBackupStorageBucket();
  const prodBucket = getAdminStorageBucket();
  if (!backupBucket) {
    await ref.update({
      status: "FAILED",
      error: "Storage bucket není k dispozici.",
      completedAt: FieldValue.serverTimestamp(),
    });
    return {
      backupId,
      status: "FAILED",
      done: true,
      recordCount: 0,
      fileCount: 0,
      sizeBytes: 0,
    };
  }

  const orgName = String(row.organizationName || (await loadOrganizationName(db, organizationId)));
  const backupType = row.backupType as OrganizationBackupType;
  const prefix = organizationBackupStoragePrefix(organizationId, backupId);
  let checkpoint = (row.checkpoint ?? {}) as OrganizationBackupCheckpoint;
  let sizeBytes = Number(row.sizeBytes ?? 0);

  try {
    if (checkpoint.phase === "firestore") {
      const skip = new Set<string>([ORGANIZATION_BACKUPS_SUBCOLLECTION, "search_index"]);
      const state: ExportWalkState = {
        lines: [],
        storagePaths: new Set<string>(),
        totalDocs: 0,
        byTop: {},
      };

      const companyRef = db.collection(COMPANIES_COLLECTION).doc(organizationId);
      await exportDocumentTree(companyRef, state, organizationId, skip);

      const orgRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const orgSnap = await orgRef.get();
      if (orgSnap.exists) {
        const data = serializeFirestoreValue(orgSnap.data()) as Record<string, unknown>;
        state.lines.push({ path: orgRef.path, id: orgRef.id, data });
        state.totalDocs += 1;
        state.byTop[ORGANIZATIONS_COLLECTION] = 1;
      }

      await exportOrgUsers(db, organizationId, state);

      const ndjson = state.lines.map((l) => JSON.stringify(l)).join("\n");
      const ndjsonPath = `${prefix}/${checkpoint.firestoreNdjsonPath}`;
      sizeBytes += await uploadJson(backupBucket, ndjsonPath, ndjson);

      const recordCounts: OrganizationBackupRecordCounts = {
        total: state.totalDocs,
        byTopCollection: state.byTop,
      };

      checkpoint = {
        phase: "files",
        firestoreDocIndex: state.totalDocs,
        fileIndex: 0,
        firestoreNdjsonPath: checkpoint.firestoreNdjsonPath,
        filePaths: Array.from(state.storagePaths).sort(),
      };

      await ref.update({
        recordCount: state.totalDocs,
        recordCounts,
        fileCount: checkpoint.filePaths.length,
        checkpoint,
        status: "CREATING",
      });

      if (state.totalDocs >= BACKUP_MAX_FIRESTORE_DOCS) {
        await ref.update({
          error: `Překročen limit ${BACKUP_MAX_FIRESTORE_DOCS} dokumentů — záloha může být neúplná.`,
        });
      }
    }

    if (checkpoint.phase === "files") {
      const filesManifest: BackupFileEntry[] = [];
      const start = checkpoint.fileIndex;
      const end = Math.min(checkpoint.filePaths.length, start + BACKUP_MAX_FILES_PER_RUN);
      let copied = 0;

      for (let i = start; i < end; i++) {
        const sourcePath = checkpoint.filePaths[i];
        const backupPath = `${prefix}/files/${sourcePath.replace(/\//g, "__")}`;
        try {
          if (!prodBucket) throw new Error("Produkční bucket chybí.");
          const src = prodBucket.file(sourcePath);
          const [exists] = await src.exists();
          if (!exists) {
            filesManifest.push({
              sourcePath,
              backupPath,
              sizeBytes: 0,
              md5: null,
            });
            continue;
          }
          await src.copy(backupBucket.file(backupPath));
          const [meta] = await backupBucket.file(backupPath).getMetadata();
          filesManifest.push({
            sourcePath,
            backupPath,
            sizeBytes: Number(meta.size ?? 0),
            md5: typeof meta.md5Hash === "string" ? meta.md5Hash : null,
          });
          sizeBytes += Number(meta.size ?? 0);
          copied += 1;
        } catch (e) {
          filesManifest.push({
            sourcePath,
            backupPath,
            sizeBytes: 0,
            md5: null,
          });
          console.warn("[backup file copy]", sourcePath, (e as Error)?.message);
        }
      }

      const manifestPath = `${prefix}/files/manifest-part-${start}.json`;
      sizeBytes += await uploadJson(backupBucket, manifestPath, JSON.stringify(filesManifest));

      const nextIndex = end;
      if (nextIndex < checkpoint.filePaths.length) {
        checkpoint = { ...checkpoint, phase: "files", fileIndex: nextIndex };
        await ref.update({ checkpoint, sizeBytes, status: "CREATING" });
        return {
          backupId,
          status: "CREATING",
          done: false,
          recordCount: Number(row.recordCount ?? 0),
          fileCount: checkpoint.filePaths.length,
          sizeBytes,
        };
      }

      checkpoint = { ...checkpoint, phase: "verify", fileIndex: nextIndex };
      await ref.update({ checkpoint, sizeBytes, status: "VERIFYING" });
    }

    if (checkpoint.phase === "verify" || checkpoint.phase === "done") {
      const freshSnap = await ref.get();
      const fresh = freshSnap.data() as Record<string, unknown>;
      const recordCounts = (fresh.recordCounts ?? {
        total: Number(fresh.recordCount ?? 0),
        byTopCollection: {},
      }) as OrganizationBackupRecordCounts;

      const manifestBase: Omit<BackupManifest, "checksum"> = {
        schemaVersion: ORGANIZATION_BACKUP_SCHEMA_VERSION,
        backupId,
        organizationId,
        organizationName: orgName,
        backupType,
        createdAt: new Date().toISOString(),
        createdBy,
        recordCounts,
        fileCount: Number(fresh.fileCount ?? checkpoint.filePaths.length),
        sizeBytes,
        firestoreNdjsonPath: `${prefix}/${checkpoint.firestoreNdjsonPath}`,
        filesManifestPath: `${prefix}/files/`,
      };

      const checksum = createHash("sha256")
        .update(JSON.stringify(manifestBase))
        .digest("hex");
      const manifest: BackupManifest = { ...manifestBase, checksum };

      const manifestPath = `${prefix}/manifest.json`;
      sizeBytes += await uploadJson(backupBucket, manifestPath, JSON.stringify(manifest, null, 2));

      await ref.update({
        status: "COMPLETED",
        completedAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp(),
        storagePath: prefix,
        sizeBytes,
        checksum,
        checkpoint: { ...checkpoint, phase: "done" },
        error: null,
        lastSuccessfulAutomaticAt:
          backupType === "MANUAL" || backupType === "PRE_RESTORE"
            ? row.lastSuccessfulAutomaticAt ?? null
            : FieldValue.serverTimestamp(),
      });

      await logOrganizationBackupAuditAdmin(db, {
        organizationId,
        userId: createdBy,
        backupId,
        action: "backup_complete",
        status: "ok",
        metadata: {
          recordCount: recordCounts.total,
          fileCount: manifest.fileCount,
          sizeBytes,
          checksum,
        },
      });

      return {
        backupId,
        status: "COMPLETED",
        done: true,
        recordCount: recordCounts.total,
        fileCount: manifest.fileCount,
        sizeBytes,
      };
    }

    return {
      backupId,
      status: "CREATING",
      done: false,
      recordCount: Number(row.recordCount ?? 0),
      fileCount: Number(row.fileCount ?? 0),
      sizeBytes,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    await ref.update({
      status: "FAILED",
      error: msg.slice(0, 2000),
      completedAt: FieldValue.serverTimestamp(),
    });
    await logOrganizationBackupAuditAdmin(db, {
      organizationId,
      userId: createdBy,
      backupId,
      action: "backup_failed",
      status: "error",
      details: msg,
    });
    return {
      backupId,
      status: "FAILED",
      done: true,
      recordCount: Number(row.recordCount ?? 0),
      fileCount: Number(row.fileCount ?? 0),
      sizeBytes,
    };
  }
}

export async function readBackupManifest(
  organizationId: string,
  backupId: string,
  storagePath: string
): Promise<BackupManifest | null> {
  const bucket = getAdminBackupStorageBucket();
  if (!bucket) return null;
  const path = `${storagePath}/manifest.json`;
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  return JSON.parse(buf.toString("utf8")) as BackupManifest;
}

export function verifyManifestChecksum(manifest: BackupManifest): boolean {
  const { checksum, ...rest } = manifest;
  const expected = createHash("sha256").update(JSON.stringify(rest)).digest("hex");
  return expected === checksum;
}
