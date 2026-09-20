/** Verze schématu exportu — při změně struktury zálohy zvýšit. */
export const ORGANIZATION_BACKUP_SCHEMA_VERSION = 1;

export const ORGANIZATION_BACKUPS_SUBCOLLECTION = "organization_backups";

export type OrganizationBackupType =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "MANUAL"
  | "PRE_RESTORE"
  | "PRE_MIGRATION"
  | "EXPORT";

export type OrganizationBackupStatus =
  | "CREATING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "RESTORING"
  | "PENDING_DELETION";

/** Retention ve dnech podle typu (po expiresAt se smaže fyzicky). */
export const BACKUP_RETENTION_DAYS: Record<OrganizationBackupType, number> = {
  DAILY: 30,
  WEEKLY: 84,
  MONTHLY: 365,
  MANUAL: 90,
  PRE_RESTORE: 90,
  PRE_MIGRATION: 30,
  EXPORT: 14,
};

/** Po označení ke smazání — fyzické odstranění až po N dnech. */
export const BACKUP_PENDING_DELETION_DAYS = 7;

/** Bezpečnostní limit dokumentů na jednu zálohu (log + FAILED pokud překročeno). */
export const BACKUP_MAX_FIRESTORE_DOCS = 120_000;

/** Max souborů ke kopírování v jednom běhu jobu (pokračování přes checkpoint). */
export const BACKUP_MAX_FILES_PER_RUN = 800;

/** Max Firestore dokumentů exportovaných v jednom běhu jobu (dávkování proti timeoutu). */
export const BACKUP_MAX_DOCS_PER_RUN = 500;

export const STORAGE_PATH_KEYS = [
  "storagePath",
  "fileStoragePath",
  "pdfStoragePath",
  "finalSignedStoragePath",
  "coverStoragePath",
  "imageStoragePath",
  "attachmentStoragePath",
  "logoStoragePath",
  "organizationLogoStoragePath",
] as const;
