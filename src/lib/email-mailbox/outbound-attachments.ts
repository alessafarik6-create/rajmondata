import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { assertEmailAttachmentAccess } from "@/lib/email-mailbox/attachment-access";
import { downloadEmailAttachmentBuffer } from "@/lib/email-mailbox/attachment-access";
import type { JobDocumentEmailAttachmentRef } from "@/lib/job-document-email-attachments";
import {
  parseJobDocumentEmailAttachmentRefs,
  resolveJobDocumentEmailExtraAttachments,
} from "@/lib/job-document-email-attachments-server";

const MAX_OUTBOUND_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export async function resolveForwardEmailAttachments(
  db: Firestore,
  companyId: string,
  messageId: string,
  attachmentIds: string[],
  callerUid: string
): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
  const out: { filename: string; contentType: string; content: Buffer }[] = [];
  for (const attId of attachmentIds) {
    const access = await assertEmailAttachmentAccess(
      db,
      companyId,
      messageId,
      attId,
      callerUid,
      "read"
    );
    if (!access.ok) continue;
    const { buffer } = await downloadEmailAttachmentBuffer(access.attachment.storagePath!);
    if (buffer.length > MAX_OUTBOUND_ATTACHMENT_BYTES) continue;
    out.push({
      filename: access.attachment.filename,
      contentType: access.attachment.contentType || "application/octet-stream",
      content: buffer,
    });
  }
  return out;
}

export async function resolveRajmondataEmailAttachments(
  db: Firestore,
  companyId: string,
  jobId: string,
  rawRefs: unknown
): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
  const refs: JobDocumentEmailAttachmentRef[] = parseJobDocumentEmailAttachmentRefs(rawRefs);
  if (!refs.length || !jobId) return [];
  const loaded = await resolveJobDocumentEmailExtraAttachments(db, {
    companyId,
    jobId,
    refs,
  });
  return loaded.map((a) => ({
    filename: a.filename,
    contentType: a.contentType || "application/octet-stream",
    content: a.content,
  }));
}

export function parseUploadFiles(
  files: File[]
): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
  return Promise.all(
    files.map(async (f) => {
      const buf = Buffer.from(await f.arrayBuffer());
      if (buf.length > MAX_OUTBOUND_ATTACHMENT_BYTES) {
        throw new Error(`Příloha „${f.name}“ je příliš velká (max 12 MB).`);
      }
      return {
        filename: f.name,
        contentType: f.type || "application/octet-stream",
        content: buf,
      };
    })
  );
}
