/** Bezpečné logy zálohování (bez citlivých dat). */
export type BackupLogEvent =
  | "BACKUP_CREATED"
  | "BACKUP_STARTED"
  | "BACKUP_COLLECTION_START"
  | "BACKUP_COLLECTION_DONE"
  | "BACKUP_FILES_START"
  | "BACKUP_FILES_DONE"
  | "BACKUP_MANIFEST_CREATED"
  | "BACKUP_VALIDATION_OK"
  | "BACKUP_COMPLETED"
  | "BACKUP_FAILED"
  | "BACKUP_RETENTION_CLEANUP"
  | "BACKUP_STALE_MARKED_FAILED";

export function logBackupEvent(
  event: BackupLogEvent,
  meta: Record<string, string | number | boolean | null | undefined>
): void {
  console.info("[organization-backup]", event, JSON.stringify(meta));
}
