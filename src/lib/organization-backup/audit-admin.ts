import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type BackupAuditAction =
  | "backup_create"
  | "backup_complete"
  | "backup_failed"
  | "backup_delete_requested"
  | "backup_delete"
  | "backup_restore_start"
  | "backup_restore_complete"
  | "backup_restore_failed"
  | "backup_download_metadata";

export async function logOrganizationBackupAuditAdmin(
  db: Firestore,
  params: {
    organizationId: string;
    userId: string | null;
    backupId: string;
    action: BackupAuditAction;
    status: "ok" | "error";
    details?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const orgId = params.organizationId.trim();
  if (!orgId) return;
  try {
    await db.collection(COMPANIES_COLLECTION).doc(orgId).collection("activityLogs").add({
      organizationId: orgId,
      companyId: orgId,
      actionType: params.action,
      actionLabel: `Záloha: ${params.action}`,
      entityType: "organization_backup",
      entityId: params.backupId,
      details: params.details?.slice(0, 4000) ?? null,
      metadata: params.metadata ?? null,
      userId: params.userId,
      status: params.status,
      sourceModule: "backups",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("[organization-backup audit]", (e as Error)?.message ?? e);
  }
}
