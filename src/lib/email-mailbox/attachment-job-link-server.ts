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

export const EMAIL_ATTACHMENT_JOB_LINKS_SUBCOLLECTION = "email_attachment_job_links";

export function companyDocumentIdForEmailAttachment(
  messageId: string,
  attachmentId: string
): string {
  return `emailAtt_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

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
}): Promise<
  | { documentId: string; linkId: string; duplicate: false; jobLabel: string }
  | { documentId: string; linkId: string | null; duplicate: true; jobLabel: string }
> {
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

  const documentId = companyDocumentIdForEmailAttachment(params.messageId, params.attachment.id);
  const docRef = params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("documents")
    .doc(documentId);

  const existingDoc = await docRef.get();
  if (existingDoc.exists) {
    const ex = existingDoc.data() as Record<string, unknown>;
    const exJob = String(ex.jobId ?? "").trim();
    if (exJob === params.jobId) {
      return {
        documentId,
        linkId: null,
        duplicate: true,
        jobLabel: jobCheck.jobLabel,
      };
    }
  }

  const jobName = params.jobDisplayName?.trim() || jobCheck.jobName;

  const ts = FieldValue.serverTimestamp();
  const dateIso = new Date().toISOString().slice(0, 10);

  await docRef.set(
    {
      type: "received",
      documentKind: category === "invoice" ? "prijate" : "prijate",
      source: "email-attachment",
      sourceType: "email",
      sourceId: params.messageId,
      emailMessageId: params.messageId,
      emailAttachmentId: params.attachment.id,
      emailAccountId: params.emailAccountId,
      jobId: params.jobId,
      jobName,
      number: params.attachment.filename.slice(0, 120),
      entityName: jobName,
      description: `E-mailová příloha: ${params.attachment.filename}`,
      date: dateIso,
      fileName: params.attachment.filename,
      fileType: params.attachment.contentType,
      mimeType: params.attachment.contentType,
      storagePath: params.attachment.storagePath,
      fileUrl: null,
      emailAttachmentCategory: category,
      vat: 0,
      organizationId: params.companyId,
      createdBy: params.createdByUserId,
      createdAt: ts,
      updatedAt: ts,
    },
    { merge: true }
  );

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
      createdBy: params.createdByUserId,
      createdAt: ts,
    });

  return { documentId, linkId: linkRef.id, duplicate: false, jobLabel: jobCheck.jobLabel };
}
