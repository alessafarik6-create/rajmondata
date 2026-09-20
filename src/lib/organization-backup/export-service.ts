import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
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
import { computeBackupExpiresAt } from "@/lib/organization-backup/retention";
import type {
  BackupFileEntry,
  BackupManifest,
  OrganizationBackupCheckpoint,
  OrganizationBackupRecordCounts,
} from "@/lib/organization-backup/types";
import { logOrganizationBackupAuditAdmin } from "@/lib/organization-backup/audit-admin";
import {
  createEmptyFirestoreExportBatchState,
  runFirestoreExportBatch,
} from "@/lib/organization-backup/firestore-export-batch";
import { logBackupEvent } from "@/lib/organization-backup/backup-log";

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
    startedAt: null,
    createdBy: params.createdBy,
    completedAt: null,
    storagePath: null,
    sizeBytes: 0,
    recordCount: 0,
    fileCount: 0,
    progressPercent: 0,
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
      firestoreNdjsonParts: [],
      filePaths: [],
      firestoreBatch: createEmptyFirestoreExportBatchState(),
    } satisfies OrganizationBackupCheckpoint,
  });
  logBackupEvent("BACKUP_CREATED", {
    organizationId: params.organizationId,
    backupId: ref.id,
    backupType: params.backupType,
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

async function uploadJson(bucket: ReturnType<typeof getAdminBackupStorageBucket>, path: string, body: string | Buffer): Promise<number> {
  if (!bucket) return 0;
  const file = bucket.file(path);
  await file.save(body, {
    resumable: false,
    metadata: {
      contentType: "application/json",
      cacheControl: "private, max-age=0",
    },
  });
  const [meta] = await file.getMetadata();
  return Number(meta.size ?? (typeof body === "string" ? body.length : body.length));
}

async function mergeFirestoreNdjsonParts(
  backupBucket: NonNullable<ReturnType<typeof getAdminBackupStorageBucket>>,
  prefix: string,
  parts: string[]
): Promise<{ mergedPath: string; bytes: number }> {
  const chunks: Buffer[] = [];
  for (const rel of parts) {
    const full = rel.startsWith(prefix) ? rel : `${prefix}/${rel.replace(/^\//, "")}`;
    const file = backupBucket.file(full);
    const [exists] = await file.exists();
    if (!exists) throw new Error(`Chybí díl exportu: ${full}`);
    const [buf] = await file.download();
    chunks.push(buf);
  }
  const merged = Buffer.concat(chunks);
  const mergedPath = `${prefix}/firestore/export.ndjson`;
  await backupBucket.file(mergedPath).save(merged, {
    resumable: false,
    metadata: { contentType: "application/x-ndjson", cacheControl: "private, max-age=0" },
  });
  return { mergedPath, bytes: merged.length };
}

async function validateBackupBeforeComplete(params: {
  backupBucket: NonNullable<ReturnType<typeof getAdminBackupStorageBucket>>;
  prefix: string;
  recordCount: number;
  fileCount: number;
  ndjsonParts: string[];
  mergedNdjsonPath: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (params.recordCount <= 0) {
    return { ok: false, error: "Záloha neobsahuje žádné záznamy (recordCount = 0)." };
  }

  const merged = params.backupBucket.file(params.mergedNdjsonPath);
  const [mergedOk] = await merged.exists();
  if (!mergedOk && params.ndjsonParts.length === 0) {
    return { ok: false, error: "Chybí export dat Firestore." };
  }

  if (!mergedOk) {
    for (const rel of params.ndjsonParts) {
      const full = rel.startsWith(params.prefix) ? rel : `${params.prefix}/${rel.replace(/^\//, "")}`;
      const [ex] = await params.backupBucket.file(full).exists();
      if (!ex) return { ok: false, error: `Chybí díl exportu: ${full}` };
    }
  }

  logBackupEvent("BACKUP_VALIDATION_OK", {
    recordCount: params.recordCount,
    fileCount: params.fileCount,
  });
  return { ok: true };
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
    logBackupEvent("BACKUP_FAILED", { organizationId, backupId, reason: "no_backup_bucket" });
    return {
      backupId,
      status: "FAILED",
      done: true,
      recordCount: 0,
      fileCount: 0,
      sizeBytes: 0,
    };
  }

  if (!row.startedAt) {
    await ref.update({ startedAt: FieldValue.serverTimestamp() });
    logBackupEvent("BACKUP_STARTED", { organizationId, backupId });
  }

  const orgName = String(row.organizationName || (await loadOrganizationName(db, organizationId)));
  const backupType = row.backupType as OrganizationBackupType;
  const prefix = organizationBackupStoragePrefix(organizationId, backupId);
  let checkpoint = (row.checkpoint ?? {}) as OrganizationBackupCheckpoint;
  let sizeBytes = Number(row.sizeBytes ?? 0);

  try {
    if (checkpoint.phase === "firestore") {
      logBackupEvent("BACKUP_COLLECTION_START", { organizationId, backupId });
      const skip = new Set<string>([ORGANIZATION_BACKUPS_SUBCOLLECTION, "search_index"]);
      const batchState =
        checkpoint.firestoreBatch ?? createEmptyFirestoreExportBatchState();
      const ndjsonParts = [...(checkpoint.firestoreNdjsonParts ?? [])];

      const { lines, state, firestoreDone } = await runFirestoreExportBatch({
        db,
        organizationId,
        state: batchState,
        skipSubcollections: skip,
      });

      if (lines.length > 0) {
        const partRel = `firestore/export-part-${state.ndjsonPart}.ndjson`;
        const partPath = `${prefix}/${partRel}`;
        const ndjson = lines.map((l) => JSON.stringify(l)).join("\n");
        sizeBytes += await uploadJson(backupBucket, partPath, ndjson);
        ndjsonParts.push(partRel);
        state.ndjsonPart += 1;
      }

      const recordCounts: OrganizationBackupRecordCounts = {
        total: state.totalDocs,
        byTopCollection: state.byTop,
      };
      const filePathsPreview = Array.from(new Set(state.storagePaths)).sort();
      const progressPercent = firestoreDone
        ? 60
        : Math.min(59, Math.round((state.totalDocs / 5000) * 59));

      checkpoint = {
        ...checkpoint,
        phase: firestoreDone ? "files" : "firestore",
        firestoreDocIndex: state.totalDocs,
        firestoreBatch: state,
        firestoreNdjsonParts: ndjsonParts,
        filePaths: firestoreDone ? filePathsPreview : checkpoint.filePaths ?? [],
        fileIndex: 0,
      };

      await ref.update({
        recordCount: state.totalDocs,
        recordCounts,
        fileCount: firestoreDone ? filePathsPreview.length : filePathsPreview.length,
        checkpoint,
        sizeBytes,
        progressPercent,
        status: "CREATING",
      });

      if (!firestoreDone) {
        logBackupEvent("BACKUP_COLLECTION_DONE", {
          organizationId,
          backupId,
          batchDocs: lines.length,
          totalDocs: state.totalDocs,
          continued: true,
        });
        return {
          backupId,
          status: "CREATING",
          done: false,
          recordCount: state.totalDocs,
          fileCount: filePathsPreview.length,
          sizeBytes,
        };
      }

      logBackupEvent("BACKUP_COLLECTION_DONE", {
        organizationId,
        backupId,
        totalDocs: state.totalDocs,
        continued: false,
      });

      if (state.totalDocs >= BACKUP_MAX_FIRESTORE_DOCS) {
        await ref.update({
          error: `Překročen limit ${BACKUP_MAX_FIRESTORE_DOCS} dokumentů — záloha může být neúplná.`,
        });
      }

      logBackupEvent("BACKUP_FILES_START", {
        organizationId,
        backupId,
        fileCount: filePathsPreview.length,
      });
    }

    if (checkpoint.phase === "files") {
      const filesManifest: BackupFileEntry[] = [];
      const start = checkpoint.fileIndex;
      const end = Math.min(checkpoint.filePaths.length, start + BACKUP_MAX_FILES_PER_RUN);

      for (let i = start; i < end; i++) {
        const sourcePath = checkpoint.filePaths[i]!;
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
      const progressPercent =
        checkpoint.filePaths.length > 0
          ? 60 + Math.round((nextIndex / checkpoint.filePaths.length) * 35)
          : 95;

      if (nextIndex < checkpoint.filePaths.length) {
        checkpoint = { ...checkpoint, phase: "files", fileIndex: nextIndex };
        await ref.update({ checkpoint, sizeBytes, status: "CREATING", progressPercent });
        return {
          backupId,
          status: "CREATING",
          done: false,
          recordCount: Number(row.recordCount ?? 0),
          fileCount: checkpoint.filePaths.length,
          sizeBytes,
        };
      }

      logBackupEvent("BACKUP_FILES_DONE", {
        organizationId,
        backupId,
        files: checkpoint.filePaths.length,
      });

      checkpoint = { ...checkpoint, phase: "verify", fileIndex: nextIndex };
      await ref.update({ checkpoint, sizeBytes, status: "VERIFYING", progressPercent: 96 });
    }

    if (checkpoint.phase === "verify" || checkpoint.phase === "done") {
      const freshSnap = await ref.get();
      const fresh = freshSnap.data() as Record<string, unknown>;
      const recordCounts = (fresh.recordCounts ?? {
        total: Number(fresh.recordCount ?? 0),
        byTopCollection: {},
      }) as OrganizationBackupRecordCounts;

      const ndjsonParts = checkpoint.firestoreNdjsonParts ?? [];
      let mergedNdjsonPath = `${prefix}/${checkpoint.firestoreNdjsonPath}`;
      if (ndjsonParts.length > 0) {
        const merged = await mergeFirestoreNdjsonParts(backupBucket, prefix, ndjsonParts);
        mergedNdjsonPath = merged.mergedPath;
        sizeBytes += merged.bytes;
      }

      const validation = await validateBackupBeforeComplete({
        backupBucket,
        prefix,
        recordCount: recordCounts.total,
        fileCount: Number(fresh.fileCount ?? checkpoint.filePaths.length),
        ndjsonParts,
        mergedNdjsonPath,
      });
      if (!validation.ok) {
        throw new Error(validation.error ?? "Kontrola integrity zálohy selhala.");
      }

      const finishedAt = new Date().toISOString();
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
        firestoreNdjsonPath: mergedNdjsonPath,
        firestoreNdjsonParts: ndjsonParts.length > 0 ? ndjsonParts : undefined,
        filesManifestPath: `${prefix}/files/`,
        finishedAt,
      };

      const checksum = createHash("sha256").update(JSON.stringify(manifestBase)).digest("hex");
      const manifest: BackupManifest = { ...manifestBase, checksum };

      const manifestPath = `${prefix}/manifest.json`;
      sizeBytes += await uploadJson(backupBucket, manifestPath, JSON.stringify(manifest, null, 2));
      logBackupEvent("BACKUP_MANIFEST_CREATED", { organizationId, backupId, checksum });

      if (!verifyManifestChecksum(manifest)) {
        throw new Error("Checksum manifestu nesouhlasí.");
      }

      await ref.update({
        status: "COMPLETED",
        completedAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp(),
        storagePath: prefix,
        sizeBytes,
        checksum,
        progressPercent: 100,
        checkpoint: { ...checkpoint, phase: "done", firestoreNdjsonPath: "firestore/export.ndjson" },
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

      logBackupEvent("BACKUP_COMPLETED", {
        organizationId,
        backupId,
        recordCount: recordCounts.total,
        fileCount: manifest.fileCount,
        sizeBytes,
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
      progressPercent: 0,
    });
    await logOrganizationBackupAuditAdmin(db, {
      organizationId,
      userId: createdBy,
      backupId,
      action: "backup_failed",
      status: "error",
      details: msg,
    });
    logBackupEvent("BACKUP_FAILED", { organizationId, backupId, error: msg.slice(0, 500) });
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
