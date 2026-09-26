import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import {
  EMAIL_ATTACHMENT_JOB_CATEGORIES,
  type EmailAttachmentJobCategory,
} from "@/lib/email-mailbox/attachment-meta";
import { assertJobBelongsToCompany } from "@/lib/email-mailbox/job-access-server";
import {
  findOrCreateEmailAttachmentFolder,
  importEmailAttachmentToJobMedia,
} from "@/lib/email-mailbox/email-attachment-job-media-server";

export const EMAIL_ATTACHMENT_JOB_LINKS_SUBCOLLECTION = "email_attachment_job_links";

export function companyDocumentIdForEmailAttachment(
  messageId: string,
  attachmentId: string
): string {
  return `emailAtt_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export type EmailAttachmentJobLinkResult =
  | {
      documentId: string;
      linkId: string;
      duplicate: false;
      jobLabel: string;
      folderId: string;
      folderName: string;
      imageId: string;
    }
  | {
      documentId: string;
      linkId: string | null;
      duplicate: true;
      jobLabel: string;
      folderId: string;
      folderName: string;
      imageId: string;
    };

export async function linkEmailAttachmentToJob(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
  messageId: string;
  emailAccountId: string;
  attachment: EmailMessageAttachmentMeta;
  category: EmailAttachmentJobCategory;
  createdByUserId: string;
  jobDisplayName?: string | null;
  mailboxEmail?: string | null;
  emailSubject?: string | null;
  /** Sdílená složka pro hromadné přiřazení z jednoho e-mailu. */
  sharedFolder?: { folderId: string; folderName: string } | null;
}): Promise<EmailAttachmentJobLinkResult> {
  const category = EMAIL_ATTACHMENT_JOB_CATEGORIES.includes(params.category)
    ? params.category
    : "other";

  if (!params.attachment.storagePath) {
    throw new Error("Příloha nemá uložený soubor ve storage.");
  }

  const jobCheck = await assertJobBelongsToCompany(params.db, params.companyId, params.jobId);
  if (!jobCheck.ok) {
    throw new Error(jobCheck.error);
  }

  let folderId = params.sharedFolder?.folderId ?? "";
  let folderName = params.sharedFolder?.folderName ?? "";
  if (!folderId) {
    const folder = await findOrCreateEmailAttachmentFolder({
      db: params.db,
      companyId: params.companyId,
      jobId: params.jobId,
      userId: params.createdByUserId,
      mailboxEmail: params.mailboxEmail,
    });
    folderId = folder.folderId;
    folderName = folder.folderName;
  }

  const media = await importEmailAttachmentToJobMedia({
    db: params.db,
    companyId: params.companyId,
    jobId: params.jobId,
    jobDisplayName: params.jobDisplayName ?? jobCheck.jobLabel,
    folderId,
    folderName,
    messageId: params.messageId,
    emailAccountId: params.emailAccountId,
    attachment: params.attachment,
    createdByUserId: params.createdByUserId,
    mailboxEmail: params.mailboxEmail,
    emailSubject: params.emailSubject,
  });

  if (!media.ok) {
    throw new Error(media.error);
  }

  if (media.duplicate) {
    return {
      documentId: companyDocumentIdForEmailAttachment(params.messageId, params.attachment.id),
      linkId: null,
      duplicate: true,
      jobLabel: jobCheck.jobLabel,
      folderId: media.folderId,
      folderName: media.folderName,
      imageId: media.imageId,
    };
  }

  const documentId = companyDocumentIdForEmailAttachment(params.messageId, params.attachment.id);
  const jobName = params.jobDisplayName?.trim() || jobCheck.jobName;
  const ts = FieldValue.serverTimestamp();

  /** Výkresy a dokumentace — pouze média zakázky, bez účetního dokladu. */
  if (category === "invoice") {
    const docRef = params.db
      .collection(COMPANIES_COLLECTION)
      .doc(params.companyId)
      .collection("documents")
      .doc(documentId);
    const dateIso = new Date().toISOString().slice(0, 10);
    await docRef.set(
      {
        type: "received",
        documentKind: "prijate",
        source: "email-attachment",
        sourceType: "email",
        sourceId: params.messageId,
        emailMessageId: params.messageId,
        emailAttachmentId: params.attachment.id,
        emailAccountId: params.emailAccountId,
        jobId: params.jobId,
        jobName,
        folderId,
        jobMediaFolderId: folderId,
        jobMediaImageId: media.imageId,
        number: params.attachment.filename.slice(0, 120),
        entityName: jobName,
        description: `E-mailová příloha: ${params.attachment.filename}`,
        date: dateIso,
        fileName: params.attachment.filename,
        fileType: params.attachment.contentType,
        mimeType: params.attachment.contentType,
        storagePath: media.storagePath,
        fileUrl: media.fileUrl,
        emailAttachmentCategory: category,
        vat: 0,
        organizationId: params.companyId,
        createdBy: params.createdByUserId,
        createdAt: ts,
        updatedAt: ts,
      },
      { merge: true }
    );
  }

  const linkRef = await params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection(EMAIL_ATTACHMENT_JOB_LINKS_SUBCOLLECTION)
    .add({
      organizationId: params.companyId,
      jobId: params.jobId,
      emailMessageId: params.messageId,
      emailAttachmentId: params.attachment.id,
      emailAccountId: params.emailAccountId,
      documentId,
      documentCategory: category,
      storagePath: params.attachment.storagePath,
      jobMediaFolderId: folderId,
      jobMediaImageId: media.imageId,
      createdBy: params.createdByUserId,
      createdAt: ts,
    });

  return {
    documentId,
    linkId: linkRef.id,
    duplicate: false,
    jobLabel: jobCheck.jobLabel,
    folderId,
    folderName,
    imageId: media.imageId,
  };
}
