import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  buildNewJobFolderImageMirrorDocument,
  companyDocumentIdForJobFolderImage,
} from "@/lib/job-linked-document-sync";
import type { JobMediaFileType } from "@/lib/job-media-types";
import { buildJobFolderImageStorageObjectPath } from "@/lib/job-photo-upload";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";

export const CHAT_JOB_MEDIA_FOLDER_SOURCE = "chat-import";

export function formatCzechDateForChatFolder(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function chatAttachmentFolderDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildChatAttachmentFolderName(date: Date, senderLabel?: string | null): string {
  const ds = formatCzechDateForChatFolder(date);
  const name = String(senderLabel ?? "").trim();
  if (name) return `Chat – ${name} – ${ds}`;
  return `Chat – ${ds}`;
}

export function jobFolderImageIdFromChatAttachment(messageId: string, attachmentId: string): string {
  return `chatAtt_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function inferJobMediaFileType(fileName: string, mimeType: string): JobMediaFileType {
  const base = fileName.toLowerCase();
  const mt = mimeType.toLowerCase();
  if (mt.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(base)) return "image";
  if (mt.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(base)) return "image";
  if (mt.includes("pdf") || base.endsWith(".pdf")) return "pdf";
  return "office";
}

function storageDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  const enc = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${enc}?alt=media&token=${encodeURIComponent(token)}`;
}

async function copyStorageAndGetUrl(srcPath: string, destPath: string): Promise<string | null> {
  const bucket = getAdminStorageBucket();
  if (!bucket) return null;
  const src = String(srcPath).trim().replace(/^\//, "");
  const dest = String(destPath).trim().replace(/^\//, "");
  if (!src || !dest) return null;
  try {
    const srcFile = bucket.file(src);
    const destFile = bucket.file(dest);
    const [exists] = await destFile.exists();
    if (!exists) {
      const [srcExists] = await srcFile.exists();
      if (!srcExists) return null;
      await srcFile.copy(destFile);
    }
    const [meta] = await destFile.getMetadata();
    const rawToken = meta.metadata?.firebaseStorageDownloadTokens;
    const token =
      typeof rawToken === "string" ? rawToken.split(",")[0]?.trim() : null;
    if (token) return storageDownloadUrl(bucket.name, dest, token);
    const [signedUrl] = await destFile.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    return typeof signedUrl === "string" ? signedUrl : null;
  } catch {
    return null;
  }
}

function jobsFoldersCol(db: Firestore, companyId: string, jobId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jobId).collection("folders");
}

function folderImagesCol(db: Firestore, companyId: string, jobId: string, folderId: string) {
  return jobsFoldersCol(db, companyId, jobId).doc(folderId).collection("images");
}

export async function findOrCreateChatAttachmentFolder(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  userId: string;
  assignDate?: Date;
  senderLabel?: string | null;
}): Promise<{ folderId: string; folderName: string; created: boolean }> {
  const assignDate = params.assignDate ?? new Date();
  const dateKey = chatAttachmentFolderDateKey(assignDate);
  const folderName = buildChatAttachmentFolderName(assignDate, params.senderLabel);

  const snap = await jobsFoldersCol(params.db, params.companyId, params.jobId)
    .where("chatImportDateKey", "==", dateKey)
    .limit(20)
    .get()
    .catch(async () => jobsFoldersCol(params.db, params.companyId, params.jobId).limit(80).get());

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.source === CHAT_JOB_MEDIA_FOLDER_SOURCE || String(data.name ?? "") === folderName) {
      return {
        folderId: doc.id,
        folderName: String(data.name ?? folderName),
        created: false,
      };
    }
  }

  const folderRef = jobsFoldersCol(params.db, params.companyId, params.jobId).doc();
  const ts = FieldValue.serverTimestamp();
  await folderRef.set({
    id: folderRef.id,
    name: folderName,
    type: "files",
    source: CHAT_JOB_MEDIA_FOLDER_SOURCE,
    chatImportDateKey: dateKey,
    companyId: params.companyId,
    jobId: params.jobId,
    employeeVisible: true,
    allowEmployeeUpload: false,
    employeeUploadAllowed: false,
    customerVisible: false,
    customerAnnotatable: false,
    internalOnly: false,
    createdAt: ts,
    createdBy: params.userId,
  });

  return { folderId: folderRef.id, folderName, created: true };
}

export async function importChatAttachmentToJobMedia(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  folderId: string;
  folderName: string;
  messageId: string;
  conversationId: string;
  attachment: ChatAttachmentMeta;
  createdByUserId: string;
  senderLabel?: string | null;
}): Promise<
  | { ok: true; duplicate: false; imageId: string; storagePath: string; fileUrl: string }
  | { ok: true; duplicate: true; imageId: string; folderId: string; folderName: string }
  | { ok: false; error: string }
> {
  if (!params.attachment.storagePath) {
    return { ok: false, error: "Příloha nemá soubor ve storage." };
  }

  const imageId = jobFolderImageIdFromChatAttachment(params.messageId, params.attachment.id);
  const imageRef = folderImagesCol(params.db, params.companyId, params.jobId, params.folderId).doc(
    imageId
  );
  const existing = await imageRef.get();
  if (existing.exists) {
    return {
      ok: true,
      duplicate: true,
      imageId,
      folderId: params.folderId,
      folderName: params.folderName,
    };
  }

  const safeName =
    params.attachment.fileName.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "priloha";
  const destPath = buildJobFolderImageStorageObjectPath(
    params.companyId,
    params.jobId,
    params.folderId,
    `${Date.now()}_${safeName}`
  );

  const fileUrl = await copyStorageAndGetUrl(params.attachment.storagePath, destPath);
  if (!fileUrl) {
    return { ok: false, error: `Soubor ${safeName} se nepodařilo zkopírovat do fotodokumentace.` };
  }

  const assignedAt = new Date();
  const fileType = inferJobMediaFileType(safeName, params.attachment.mimeType);
  const note = [
    "Zdroj: Chat",
    `Datum: ${assignedAt.toLocaleString("cs-CZ")}`,
    params.senderLabel?.trim() ? `Odesílatel: ${params.senderLabel.trim()}` : null,
    params.conversationId ? `Konverzace: ${params.conversationId}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const ts = FieldValue.serverTimestamp();

  await imageRef.set({
    id: imageId,
    companyId: params.companyId,
    jobId: params.jobId,
    folderId: params.folderId,
    imageUrl: fileUrl,
    url: fileUrl,
    originalImageUrl: fileUrl,
    downloadURL: fileUrl,
    storagePath: destPath,
    path: destPath,
    fileName: safeName,
    name: safeName,
    fileType,
    mimeType: params.attachment.mimeType,
    fileSizeBytes: params.attachment.size ?? null,
    note,
    uploadSource: "chat-attachment",
    sourceOrigin: "CHAT",
    sourceMessageId: params.messageId,
    sourceConversationId: params.conversationId,
    sourceChatAttachmentId: params.attachment.id,
    sourceAssignedAt: assignedAt.toISOString(),
    createdAt: ts,
    createdBy: params.createdByUserId,
    uploadedBy: params.createdByUserId,
    uploadedAt: ts,
    visibleInProduction: false,
  });

  const mirrorId = companyDocumentIdForJobFolderImage(params.folderId, imageId);
  await params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("documents")
    .doc(mirrorId)
    .set(
      buildNewJobFolderImageMirrorDocument({
        companyId: params.companyId,
        jobId: params.jobId,
        jobDisplayName: params.jobDisplayName,
        folderId: params.folderId,
        imageId,
        userId: params.createdByUserId,
        fileName: safeName,
        fileType,
        mimeType: params.attachment.mimeType,
        fileUrl,
        storagePath: destPath,
        note,
      }),
      { merge: true }
    );

  return { ok: true, duplicate: false, imageId, storagePath: destPath, fileUrl };
}
