import crypto from "node:crypto";
import type { Bucket } from "@google-cloud/storage";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import { EMAIL_ATTACHMENT_MAX_BYTES } from "@/lib/email-mailbox/message-content-limits";
import { sanitizeStorageFilename } from "@/lib/email-mailbox/attachment-meta";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

export async function uploadEmailAttachments(params: {
  bucket: Bucket | null;
  companyId: string;
  accountId: string;
  attachments: {
    filename: string;
    contentType: string;
    content: Buffer;
    disposition?: "attachment" | "inline" | null;
    contentId?: string | null;
    related?: boolean;
    userVisible?: boolean;
  }[];
}): Promise<EmailMessageAttachmentMeta[]> {
  const out: EmailMessageAttachmentMeta[] = [];
  for (const att of params.attachments) {
    if (!att.filename?.trim()) continue;
    const size = att.content?.length ?? 0;
    if (size <= 0) continue;
    if (size > EMAIL_ATTACHMENT_MAX_BYTES) {
      logEmailPhase("EMAIL_SYNC_ATTACHMENT_STORED", {
        skipped: true,
        size,
        filename: att.filename.slice(0, 80),
      });
      out.push({
        id: crypto.randomUUID(),
        filename: att.filename,
        contentType: att.contentType || "application/octet-stream",
        size,
        storagePath: null,
        disposition: att.disposition ?? "attachment",
        contentId: att.contentId ?? null,
        related: att.related ?? false,
        userVisible: att.userVisible !== false,
      });
      continue;
    }
    const id = crypto.randomUUID();
    let storagePath: string | null = null;
    const safeName = sanitizeStorageFilename(att.filename);
    if (params.bucket) {
      storagePath = `companies/${params.companyId}/email_attachments/${params.accountId}/${id}_${safeName}`;
      await params.bucket.file(storagePath).save(att.content, {
        contentType: att.contentType,
        resumable: size > 2 * 1024 * 1024,
        metadata: {
          metadata: {
            organizationId: params.companyId,
            emailAccountId: params.accountId,
          },
        },
      });
      logEmailPhase("EMAIL_SYNC_ATTACHMENT_STORED", {
        size,
        filename: att.filename.slice(0, 80),
      });
    }
    out.push({
      id,
      filename: att.filename,
      contentType: att.contentType || "application/octet-stream",
      size,
      storagePath,
      disposition: att.disposition ?? "attachment",
      contentId: att.contentId ?? null,
      related: att.related ?? false,
      userVisible: att.userVisible !== false,
    });
  }
  return out;
}
