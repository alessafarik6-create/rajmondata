import type { Timestamp } from "firebase-admin/firestore";

export function firestoreTimestampToIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const sec = typeof v.seconds === "number" ? v.seconds : typeof v._seconds === "number" ? v._seconds : null;
    if (sec != null) return new Date(sec * 1000).toISOString();
  }
  return null;
}

export function serializeBackupForApi(id: string, data: Record<string, unknown>) {
  const checkpoint = data.checkpoint as Record<string, unknown> | undefined;
  const recordCount = Number(data.recordCount ?? 0);
  const fileCount = Number(data.fileCount ?? 0);
  const fileIndex = Number(checkpoint?.fileIndex ?? 0);
  const filePathsLen = Array.isArray(checkpoint?.filePaths) ? checkpoint.filePaths.length : fileCount;
  const phase = String(checkpoint?.phase ?? "");

  let progressPercent = 0;
  if (data.status === "COMPLETED") progressPercent = 100;
  else if (data.status === "FAILED") progressPercent = 0;
  else if (phase === "firestore") progressPercent = Math.min(65, Math.round((recordCount / 5000) * 65));
  else if (phase === "files" && filePathsLen > 0) {
    progressPercent = 65 + Math.round((fileIndex / filePathsLen) * 30);
  } else if (phase === "verify") progressPercent = 96;

  const cp = data.checkpoint as Record<string, unknown> | undefined;
  const { checkpoint: _omit, ...rest } = data;

  return {
    id,
    ...rest,
    status: data.status,
    backupType: data.backupType,
    recordCount: data.recordCount,
    fileCount: data.fileCount,
    sizeBytes: data.sizeBytes,
    recordCounts: data.recordCounts,
    error: data.error,
    checkpoint: cp
      ? {
          phase: cp.phase,
          fileIndex: cp.fileIndex,
          filePaths: Array.isArray(cp.filePaths) ? cp.filePaths.length : 0,
        }
      : undefined,
    createdAt: firestoreTimestampToIso(data.createdAt),
    completedAt: firestoreTimestampToIso(data.completedAt),
    startedAt: firestoreTimestampToIso(data.startedAt),
    verifiedAt: firestoreTimestampToIso(data.verifiedAt),
    expiresAt: firestoreTimestampToIso(data.expiresAt),
    progressPercent,
    recordsProcessed: recordCount,
    filesProcessed: fileIndex,
  };
}
