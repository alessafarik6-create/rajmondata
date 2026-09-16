import type { Firestore } from "firebase-admin/firestore";
import {
  createOrganizationBackupRecord,
  runOrganizationBackupJob,
} from "@/lib/organization-backup/export-service";

/** Snapshot před rizikovou operací (migrace, hromadné mazání, import). */
export async function createPreRiskOrganizationBackupAdmin(
  db: Firestore,
  params: {
    organizationId: string;
    organizationName: string;
    createdBy: string | null;
    reason: string;
  }
): Promise<string> {
  const backupId = await createOrganizationBackupRecord(db, {
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    backupType: "PRE_MIGRATION",
    createdBy: params.createdBy,
  });

  let done = false;
  let guard = 0;
  while (!done && guard < 200) {
    guard += 1;
    const r = await runOrganizationBackupJob(db, params.organizationId, backupId, params.createdBy);
    done = r.done;
    if (r.status === "FAILED") break;
  }

  return backupId;
}
