import type {
  OrganizationBackupStatus,
  OrganizationBackupType,
} from "@/lib/organization-backup/constants";

export type OrganizationBackupRecordCounts = {
  total: number;
  byTopCollection: Record<string, number>;
};

export type OrganizationBackupDoc = {
  id: string;
  organizationId: string;
  organizationName: string;
  backupType: OrganizationBackupType;
  status: OrganizationBackupStatus;
  schemaVersion: number;
  createdAt: FirebaseFirestore.Timestamp | null;
  createdBy: string | null;
  completedAt: FirebaseFirestore.Timestamp | null;
  storagePath: string | null;
  sizeBytes: number;
  recordCount: number;
  fileCount: number;
  recordCounts: OrganizationBackupRecordCounts | null;
  checksum: string | null;
  error: string | null;
  expiresAt: FirebaseFirestore.Timestamp | null;
  pendingDeletionAt: FirebaseFirestore.Timestamp | null;
  /** Obnova / export */
  restoreJobId?: string | null;
  sourceBackupId?: string | null;
  checkpoint?: OrganizationBackupCheckpoint | null;
  verifiedAt?: FirebaseFirestore.Timestamp | null;
  lastSuccessfulAutomaticAt?: FirebaseFirestore.Timestamp | null;
};

export type OrganizationBackupCheckpoint = {
  phase: "firestore" | "files" | "verify" | "done";
  firestoreDocIndex: number;
  fileIndex: number;
  /** Relativní cesta v bucketu k sloučenému NDJSON exportu. */
  firestoreNdjsonPath: string;
  /** Dílčí NDJSON soubory během dávkového exportu. */
  firestoreNdjsonParts?: string[];
  /** Seznam produkčních storage cest ke kopírování. */
  filePaths: string[];
  /** Průběh dávkového exportu Firestore. */
  firestoreBatch?: import("@/lib/organization-backup/firestore-export-batch").FirestoreExportBatchState;
};

export type FirestoreExportLine = {
  path: string;
  id: string;
  data: Record<string, unknown> | null;
};

export type BackupManifest = {
  schemaVersion: number;
  backupId: string;
  organizationId: string;
  organizationName: string;
  backupType: OrganizationBackupType;
  createdAt: string;
  createdBy: string | null;
  recordCounts: OrganizationBackupRecordCounts;
  fileCount: number;
  sizeBytes: number;
  firestoreNdjsonPath: string;
  firestoreNdjsonParts?: string[];
  filesManifestPath: string;
  checksum: string;
  finishedAt?: string;
};

export type BackupFileEntry = {
  sourcePath: string;
  backupPath: string;
  sizeBytes: number;
  md5: string | null;
};
