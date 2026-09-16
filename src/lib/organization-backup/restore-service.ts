import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  getAdminBackupStorageBucket,
  getAdminStorageBucket,
  organizationBackupStoragePrefix,
} from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { ORGANIZATION_BACKUPS_SUBCOLLECTION } from "@/lib/organization-backup/constants";
import {
  createOrganizationBackupRecord,
  readBackupManifest,
  runOrganizationBackupJob,
  verifyManifestChecksum,
} from "@/lib/organization-backup/export-service";
import type { FirestoreExportLine } from "@/lib/organization-backup/types";
import { logOrganizationBackupAuditAdmin } from "@/lib/organization-backup/audit-admin";
import { deserializeFirestoreValue } from "@/lib/organization-backup/serialize-firestore";

const BATCH_LIMIT = 400;

function pathToRef(db: Firestore, path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2 || parts.length % 2 !== 0) {
    throw new Error(`Neplatná cesta dokumentu: ${path}`);
  }
  let ref: FirebaseFirestore.CollectionReference | FirebaseFirestore.DocumentReference = db.collection(
    parts[0]
  );
  for (let i = 1; i < parts.length; i++) {
    if (i % 2 === 1) {
      ref = (ref as FirebaseFirestore.CollectionReference).doc(parts[i]);
    } else {
      ref = (ref as FirebaseFirestore.DocumentReference).collection(parts[i]);
    }
  }
  return ref as FirebaseFirestore.DocumentReference;
}

async function loadFirestoreExportLines(
  storagePath: string,
  ndjsonRelative: string
): Promise<FirestoreExportLine[]> {
  const bucket = getAdminBackupStorageBucket();
  if (!bucket) throw new Error("Backup bucket není k dispozici.");
  const full = ndjsonRelative.startsWith(storagePath)
    ? ndjsonRelative
    : `${storagePath}/${ndjsonRelative.replace(/^\//, "")}`;
  const file = bucket.file(full.endsWith(".ndjson") ? full : `${storagePath}/firestore/export.ndjson`);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Export Firestore v záloze chybí.");
  const [buf] = await file.download();
  const text = buf.toString("utf8");
  const lines: FirestoreExportLine[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    lines.push(JSON.parse(t) as FirestoreExportLine);
  }
  return lines;
}

function reviveFirestoreFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        out[k] = Timestamp.fromDate(d);
        continue;
      }
    }
    out[k] = deserializeFirestoreValue(v);
  }
  return out;
}

export type RestoreOrganizationResult = {
  preRestoreBackupId: string;
  restoredDocs: number;
  restoredFiles: number;
};

/**
 * v1: upsert všech dokumentů ze zálohy + kopie souborů zpět do produkčního bucketu.
 * Nevymazává novější záznamy, které v záloze nejsou.
 */
export async function restoreOrganizationFromBackup(
  db: Firestore,
  params: {
    organizationId: string;
    backupId: string;
    userId: string;
  }
): Promise<RestoreOrganizationResult> {
  const { organizationId, backupId, userId } = params;
  const backupRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
    .doc(backupId);
  const backupSnap = await backupRef.get();
  if (!backupSnap.exists) throw new Error("Záloha neexistuje.");
  const backupRow = backupSnap.data() as Record<string, unknown>;
  if (backupRow.status !== "COMPLETED") {
    throw new Error("Obnovit lze pouze dokončenou zálohu.");
  }
  const storagePath = String(backupRow.storagePath ?? organizationBackupStoragePrefix(organizationId, backupId));
  const manifest = await readBackupManifest(organizationId, backupId, storagePath);
  if (!manifest) throw new Error("Manifest zálohy chybí.");
  if (!verifyManifestChecksum(manifest)) {
    throw new Error("Kontrolní součet zálohy nesouhlasí — obnova zablokována.");
  }
  if (manifest.organizationId !== organizationId) {
    throw new Error("Záloha patří jiné organizaci.");
  }

  const orgName = String(backupRow.organizationName ?? manifest.organizationName ?? organizationId);

  const preRestoreBackupId = await createOrganizationBackupRecord(db, {
    organizationId,
    organizationName: orgName,
    backupType: "PRE_RESTORE",
    createdBy: userId,
    sourceBackupId: backupId,
  });

  await logOrganizationBackupAuditAdmin(db, {
    organizationId,
    userId,
    backupId: preRestoreBackupId,
    action: "backup_create",
    status: "ok",
    details: "PRE_RESTORE před obnovou",
    metadata: { sourceBackupId: backupId },
  });

  let preDone = false;
  while (!preDone) {
    const r = await runOrganizationBackupJob(db, organizationId, preRestoreBackupId, userId);
    preDone = r.done;
  }

  await backupRef.update({ status: "RESTORING", restoreJobId: preRestoreBackupId });

  await logOrganizationBackupAuditAdmin(db, {
    organizationId,
    userId,
    backupId,
    action: "backup_restore_start",
    status: "ok",
    metadata: { preRestoreBackupId },
  });

  const lines = await loadFirestoreExportLines(storagePath, manifest.firestoreNdjsonPath);
  let restoredDocs = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const line of lines) {
    if (line.path.includes(`/${ORGANIZATION_BACKUPS_SUBCOLLECTION}/`)) continue;
    if (line.path.includes("/search_index/")) continue;
    if (!line.data) continue;
    const ref = pathToRef(db, line.path);
    batch.set(ref, reviveFirestoreFields(line.data), { merge: false });
    batchCount += 1;
    restoredDocs += 1;
    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  const backupBucket = getAdminBackupStorageBucket();
  const prodBucket = getAdminStorageBucket();
  let restoredFiles = 0;
  if (backupBucket && prodBucket) {
    const [files] = await backupBucket.getFiles({ prefix: `${storagePath}/files/` });
    for (const f of files) {
      const name = f.name;
      if (name.includes("/manifest-part-")) continue;
      const base = name.split("/files/")[1];
      if (!base) continue;
      const sourcePath = base.replace(/__/g, "/");
      if (!sourcePath.startsWith(`companies/${organizationId}/`)) continue;
      try {
        await f.copy(prodBucket.file(sourcePath));
        restoredFiles += 1;
      } catch (e) {
        console.warn("[restore file]", sourcePath, (e as Error)?.message);
      }
    }
  }

  await backupRef.update({
    restoredAt: FieldValue.serverTimestamp(),
  });

  await logOrganizationBackupAuditAdmin(db, {
    organizationId,
    userId,
    backupId,
    action: "backup_restore_complete",
    status: "ok",
    metadata: { restoredDocs, restoredFiles, preRestoreBackupId },
  });

  return { preRestoreBackupId, restoredDocs, restoredFiles };
}
