import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { cronBackupTypeForDate } from "@/lib/organization-backup/retention";
import { ORGANIZATION_BACKUPS_SUBCOLLECTION } from "@/lib/organization-backup/constants";
import {
  createOrganizationBackupRecord,
  runOrganizationBackupJob,
} from "@/lib/organization-backup/export-service";
import { purgeExpiredOrganizationBackupsAdmin } from "@/lib/organization-backup/cleanup-admin";
import { markStaleOrganizationBackupsFailed } from "@/lib/organization-backup/stale-backup-admin";
import { logBackupEvent } from "@/lib/organization-backup/backup-log";

export async function runScheduledOrganizationBackupsAdmin(
  db: Firestore,
  now = new Date()
): Promise<{ started: number; completed: number; failed: number; staleMarked: number; resumed: number }> {
  const staleMarked = await markStaleOrganizationBackupsFailed(db, now.getTime());

  const types = cronBackupTypeForDate(now);
  let started = 0;
  let completed = 0;
  let failed = 0;
  let resumed = 0;

  const companiesSnap = await db.collection(COMPANIES_COLLECTION).select().get();
  for (const companyDoc of companiesSnap.docs) {
    const organizationId = companyDoc.id;
    const companyData = (await companyDoc.ref.get()).data() as {
      companyName?: string;
      name?: string;
      deletedAt?: unknown;
      isDeleted?: boolean;
    };
    if (companyData?.isDeleted === true || companyData?.deletedAt) continue;

    const orgName = String(companyData.companyName || companyData.name || organizationId).trim();

    for (const backupType of types) {
      started += 1;
      const backupId = await createOrganizationBackupRecord(db, {
        organizationId,
        organizationName: orgName,
        backupType,
        createdBy: null,
      });

      let done = false;
      let guard = 0;
      while (!done && guard < 8) {
        guard += 1;
        const result = await runOrganizationBackupJob(db, organizationId, backupId, null);
        done = result.done;
        if (result.status === "FAILED") failed += 1;
        if (result.status === "COMPLETED") completed += 1;
      }
    }
  }

  const inProgress = await db
    .collectionGroup(ORGANIZATION_BACKUPS_SUBCOLLECTION)
    .where("status", "in", ["CREATING", "VERIFYING"])
    .limit(20)
    .get()
    .catch(() => null);

  if (inProgress) {
    for (const doc of inProgress.docs) {
      const d = doc.data() as { organizationId?: string };
      const organizationId = d.organizationId ?? doc.ref.parent.parent?.id;
      if (!organizationId) continue;
      resumed += 1;
      let done = false;
      let guard = 0;
      while (!done && guard < 5) {
        guard += 1;
        const result = await runOrganizationBackupJob(db, organizationId, doc.id, null);
        done = result.done;
      }
    }
  }

  await purgeExpiredOrganizationBackupsAdmin(db);
  logBackupEvent("BACKUP_RETENTION_CLEANUP", { phase: "purge_expired" });
  return { started, completed, failed, staleMarked, resumed };
}
