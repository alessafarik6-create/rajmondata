import type { Firestore } from "firebase/firestore";
import {
  arrayUnion,
  collection,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";

export type JobCommentTargetType = "job" | "file";

export type JobCommentAuthorRole = "admin" | "employee";

export type JobCommentDoc = {
  organizationId: string;
  jobId: string;
  targetType: JobCommentTargetType;
  fileId?: string | null;
  folderId?: string | null;
  fileName?: string | null;
  message: string;
  authorId: string;
  authorName: string;
  authorRole: JobCommentAuthorRole;
  createdAt: unknown;
  readBy?: string[];
};

export function jobCommentsCollection(
  firestore: Firestore,
  companyId: string,
  jobId: string
) {
  return collection(firestore, "companies", companyId, "jobs", jobId, "comments");
}

export function buildJobCommentPayload(params: {
  companyId: string;
  jobId: string;
  targetType: JobCommentTargetType;
  fileId?: string | null;
  folderId?: string | null;
  fileName?: string | null;
  message: string;
  authorId: string;
  authorName: string;
  authorRole: JobCommentAuthorRole;
}): Omit<JobCommentDoc, "createdAt"> & { createdAt: unknown } {
  return {
    organizationId: params.companyId,
    jobId: params.jobId,
    targetType: params.targetType,
    fileId: params.fileId ?? null,
    folderId: params.folderId ?? null,
    fileName: params.fileName ?? null,
    message: params.message,
    authorId: params.authorId,
    authorName: params.authorName,
    authorRole: params.authorRole,
    createdAt: serverTimestamp(),
    readBy: [params.authorId],
  };
}

export async function markJobCommentsRead(params: {
  firestore: Firestore;
  commentRefs: Array<DocumentReference>;
  userId: string;
}): Promise<void> {
  if (!params.commentRefs.length) return;
  const batch = writeBatch(params.firestore);
  for (const ref of params.commentRefs) {
    batch.update(ref, {
      readBy: arrayUnion(params.userId),
    });
  }
  await batch.commit();
}

