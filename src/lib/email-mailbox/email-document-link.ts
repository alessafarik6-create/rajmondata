import { buildPortalEmailMessageUrl } from "@/lib/email-mailbox/email-attachment-job-ui-links";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

export function companyDocumentIdForEmailAttachmentClient(
  messageId: string,
  attachmentId: string
): string {
  return `emailAtt_${messageId}_${attachmentId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export function buildEmailDocumentOpenHref(params: {
  documentId: string;
  messageId?: string | null;
}): string {
  const id = String(params.documentId ?? "").trim();
  if (!id) return "/portal/documents";
  const q = new URLSearchParams();
  q.set("documentId", id);
  const msg = String(params.messageId ?? "").trim();
  if (msg) {
    q.set("fromEmail", "1");
    q.set("messageId", msg);
    q.set("returnEmailPath", buildPortalEmailMessageUrl(msg));
  }
  return `/portal/documents?${q.toString()}`;
}

export function resolveEmailDocumentIdFromAttachment(
  messageId: string,
  att: EmailMessageAttachmentMeta
): string | null {
  const explicit =
    String(att.linkedDocumentId ?? "").trim() ||
    String(att.createdDocumentId ?? "").trim();
  if (explicit) return explicit;
  if (messageId && att.id) {
    return companyDocumentIdForEmailAttachmentClient(messageId, att.id);
  }
  return null;
}
