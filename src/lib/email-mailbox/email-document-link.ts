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
  const deterministic =
    messageId && att.id
      ? companyDocumentIdForEmailAttachmentClient(messageId, att.id)
      : null;
  const fromPlacement = att.emailPlacement?.accountingDocumentId?.trim();
  if (fromPlacement) return fromPlacement;
  const explicit =
    String(att.linkedDocumentId ?? "").trim() ||
    String(att.createdDocumentId ?? "").trim();
  if (explicit) {
    const kind = att.emailPlacement?.contentKind;
    if (kind && kind !== "ACCOUNTING_DOCUMENT") return null;
    if (
      att.emailPlacement?.target === "job" &&
      att.emailPlacement.jobAttachmentRole &&
      att.emailPlacement.jobAttachmentRole !== "invoice"
    ) {
      return null;
    }
    if (
      !att.emailPlacement?.target &&
      att.documentCategory &&
      !["invoice"].includes(att.documentCategory)
    ) {
      return null;
    }
    return explicit;
  }
  return null;
}
