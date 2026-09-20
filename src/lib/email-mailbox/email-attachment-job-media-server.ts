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
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";

export const EMAIL_JOB_MEDIA_FOLDER_SOURCE = "email-import";

export function formatCzechDateForEmailFolder(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function emailAttachmentFolderDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildEmailAttachmentFolderName(date: Date, mailboxEmail?: string | null): string {
  const ds = formatCzechDateForEmailFolder(date);
  const mb = String(mailboxEmail ?? "").trim();
  if (mb) return `Přílohy z e-mailu – ${mb} – ${ds}`;
  return `Přílohy z e-mailu – ${ds}`;
}

export function jobFolderImageIdFromEmailAttachment(messageId: string, attachmentId: string): string {
  return `emailAtt_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function inferJobMediaFileType(fileName: string, mimeType: string): JobMediaFileType {
  const base = fileName.toLowerCase();
  const mt = mimeType.toLowerCase();
  if (mt.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(base)) return "image";
  if (mt.includes("pdf") || base.endsWith(".pdf")) return "pdf";
  if (base.endsWith(".csv") || mt.includes("csv")) return "csv";
  if (/\.(zip|rar|7z)$/i.test(base) || mt.includes("zip") || mt.includes("rar")) return "archive";
  if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(base)) return "office";
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

export async function findOrCreateEmailAttachmentFolder(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  userId: string;
  assignDate?: Date;
  mailboxEmail?: string | null;
}): Promise<{ folderId: string; folderName: string; created: boolean }> {
  const assignDate = params.assignDate ?? new Date();
  const dateKey = emailAttachmentFolderDateKey(assignDate);
  const folderName = buildEmailAttachmentFolderName(assignDate, params.mailboxEmail);

  const snap = await jobsFoldersCol(params.db, params.companyId, params.jobId)
    .where("emailImportDateKey", "==", dateKey)
    .limit(20)
    .get()
    .catch(async () => jobsFoldersCol(params.db, params.companyId, params.jobId).limit(80).get());

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.source === EMAIL_JOB_MEDIA_FOLDER_SOURCE || String(data.name ?? "") === folderName) {
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
    source: EMAIL_JOB_MEDIA_FOLDER_SOURCE,
    emailImportDateKey: dateKey,
    companyId: params.companyId,
    jobId: params.jobId,
    employeeVisible: false,
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

function buildEmailSourceNote(params: {
  mailboxEmail?: string | null;
  emailSubject?: string | null;
  assignedAt: Date;
}): string {
  const lines = ["Zdroj: E-mail", `Datum: ${params.assignedAt.toLocaleString("cs-CZ")}`];
  if (params.mailboxEmail?.trim()) lines.push(`Schránka: ${params.mailboxEmail.trim()}`);
  if (params.emailSubject?.trim()) lines.push(`Předmět: ${params.emailSubject.trim().slice(0, 200)}`);
  return lines.join("\n");
}

export async function importEmailAttachmentToJobMedia(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  folderId: string;
  folderName: string;
  messageId: string;
  emailAccountId: string;
  attachment: EmailMessageAttachmentMeta;
  createdByUserId: string;
  mailboxEmail?: string | null;
  emailSubject?: string | null;
}): Promise<
  | {
      ok: true;
      duplicate: false;
      imageId: string;
      storagePath: string;
      fileUrl: string;
    }
  | { ok: true; duplicate: true; imageId: string; folderId: string; folderName: string }
  | { ok: false; error: string }
> {
  if (!params.attachment.storagePath) {
    return { ok: false, error: "Příloha nemá soubor ve storage." };
  }

  const imageId = jobFolderImageIdFromEmailAttachment(params.messageId, params.attachment.id);
  const imageRef = folderImagesCol(params.db, params.companyId, params.jobId, params.folderId).doc(
    imageId
  );
  const existing = await imageRef.get();
  if (existing.exists) {
    const ex = existing.data() as Record<string, unknown>;
    const exMsg = String(ex.sourceEmailMessageId ?? "");
    const exAtt = String(ex.sourceEmailAttachmentId ?? "");
    if (exMsg === params.messageId && exAtt === params.attachment.id) {
      return {
        ok: true,
        duplicate: true,
        imageId,
        folderId: params.folderId,
        folderName: params.folderName,
      };
    }
  }

  const safeName =
    params.attachment.filename.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "priloha";
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
  const fileType = inferJobMediaFileType(safeName, params.attachment.contentType);
  const note = buildEmailSourceNote({
    mailboxEmail: params.mailboxEmail,
    emailSubject: params.emailSubject,
    assignedAt,
  });
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
    mimeType: params.attachment.contentType,
    fileSizeBytes: params.attachment.size ?? null,
    note,
    uploadSource: "email-attachment",
    sourceOrigin: "email",
    sourceEmailMessageId: params.messageId,
    sourceEmailAttachmentId: params.attachment.id,
    sourceEmailAccountId: params.emailAccountId,
    sourceMailboxEmail: params.mailboxEmail ?? null,
    sourceEmailSubject: params.emailSubject ?? null,
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
        mimeType: params.attachment.contentType,
        fileUrl,
        storagePath: destPath,
        note,
      }),
      { merge: true }
    );

  return {
    ok: true,
    duplicate: false,
    imageId,
    storagePath: destPath,
    fileUrl,
  };
}

/** Doplní chybějící fotodokumentaci u existujících vazeb (bez duplicit). */
export async function repairEmailAttachmentJobMediaForJob(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  userId: string;
  mailboxEmailByAccountId?: Map<string, string>;
}): Promise<{ repaired: number; skipped: number; failed: number }> {
  const linksSnap = await params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("email_attachment_job_links")
    .where("jobId", "==", params.jobId)
    .limit(200)
    .get();

  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  const folderCache = new Map<string, { folderId: string; folderName: string }>();

  for (const linkDoc of linksSnap.docs) {
    const link = linkDoc.data() as Record<string, unknown>;
    const messageId = String(link.emailMessageId ?? "");
    const attachmentId = String(link.emailAttachmentId ?? "");
    const emailAccountId = String(link.emailAccountId ?? "");
    const storagePath = String(link.storagePath ?? "");
    if (!messageId || !attachmentId || !storagePath) {
      skipped += 1;
      continue;
    }

    const imageId = jobFolderImageIdFromEmailAttachment(messageId, attachmentId);
    const foldersSnap = await jobsFoldersCol(params.db, params.companyId, params.jobId).limit(80).get();
    let found = false;
    for (const f of foldersSnap.docs) {
      const img = await folderImagesCol(params.db, params.companyId, params.jobId, f.id)
        .doc(imageId)
        .get();
      if (img.exists) {
        found = true;
        break;
      }
    }
    if (found) {
      skipped += 1;
      continue;
    }

    const assignDate = new Date();
    const cacheKey = emailAttachmentFolderDateKey(assignDate);
    let folder = folderCache.get(cacheKey);
    if (!folder) {
      const created = await findOrCreateEmailAttachmentFolder({
        db: params.db,
        companyId: params.companyId,
        jobId: params.jobId,
        userId: params.userId,
        assignDate,
        mailboxEmail: params.mailboxEmailByAccountId?.get(emailAccountId) ?? null,
      });
      folder = { folderId: created.folderId, folderName: created.folderName };
      folderCache.set(cacheKey, folder);
    }

    const msgSnap = await emailMessagesCol(params.db, params.companyId).doc(messageId).get();
    const msgData = msgSnap.exists ? (msgSnap.data() as Record<string, unknown>) : {};
    const attList = Array.isArray(msgData.attachments) ? msgData.attachments : [];
    let attMeta = attList.find(
      (a: { id?: string }) => String(a?.id ?? "") === attachmentId
    ) as EmailMessageAttachmentMeta | undefined;

    if (!attMeta?.storagePath) {
      attMeta = {
        id: attachmentId,
        filename: String(link.documentId ?? attachmentId),
        contentType: "application/octet-stream",
        size: 0,
        storagePath,
      };
    }

    const r = await importEmailAttachmentToJobMedia({
      db: params.db,
      companyId: params.companyId,
      jobId: params.jobId,
      jobDisplayName: null,
      folderId: folder.folderId,
      folderName: folder.folderName,
      messageId,
      emailAccountId,
      attachment: attMeta,
      createdByUserId: params.userId,
      mailboxEmail: params.mailboxEmailByAccountId?.get(emailAccountId) ?? null,
      emailSubject: String(msgData.subject ?? ""),
    });

    if (r.ok && !r.duplicate) repaired += 1;
    else if (r.ok && r.duplicate) skipped += 1;
    else failed += 1;
  }

  return { repaired, skipped, failed };
}
