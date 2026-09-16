import {
  BACKUP_PENDING_DELETION_DAYS,
  BACKUP_RETENTION_DAYS,
  type OrganizationBackupType,
} from "@/lib/organization-backup/constants";

export function computeBackupExpiresAt(
  backupType: OrganizationBackupType,
  createdAt: Date
): Date {
  const days = BACKUP_RETENTION_DAYS[backupType] ?? 90;
  const d = new Date(createdAt.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function computePendingDeletionPurgeAt(pendingDeletionAt: Date): Date {
  const d = new Date(pendingDeletionAt.getTime());
  d.setUTCDate(d.getUTCDate() + BACKUP_PENDING_DELETION_DAYS);
  return d;
}

export function cronBackupTypeForDate(now: Date): OrganizationBackupType[] {
  const types: OrganizationBackupType[] = ["DAILY"];
  if (now.getUTCDay() === 0) types.push("WEEKLY");
  if (now.getUTCDate() === 1) types.push("MONTHLY");
  return types;
}
