import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { cronBackupTypeForDate } from "@/lib/organization-backup/retention";
import {
  createOrganizationBackupRecord,
  runOrganizationBackupJob,
} from "@/lib/organization-backup/export-service";
import { purgeExpiredOrganizationBackupsAdmin } from "@/lib/organization-backup/cleanup-admin";

export async function runScheduledOrganizationBackupsAdmin(
  db: Firestore,
  now = new Date()
): Promise<{ started: number; completed: number; failed: number }> {
  const types = cronBackupTypeForDate(now);
  let started = 0;
  let completed = 0;
  let failed = 0;

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
      while (!done && guard < 200) {
        guard += 1;
        const result = await runOrganizationBackupJob(db, organizationId, backupId, null);
        done = result.done;
        if (result.status === "FAILED") failed += 1;
        if (result.status === "COMPLETED") completed += 1;
      }
    }
  }

  await purgeExpiredOrganizationBackupsAdmin(db);
  return { started, completed, failed };
}
