import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import type { EmailMessageAttachmentMeta, EmailMessageDoc } from "@/lib/email-mailbox/types";
import { userVisibleAttachments } from "@/lib/email-mailbox/attachment-meta";

export function findMessageAttachment(
  message: EmailMessageDoc,
  attachmentId: string
): EmailMessageAttachmentMeta | null {
  const list = message.attachments ?? [];
  return list.find((a) => a.id === attachmentId) ?? null;
}

export async function assertEmailAttachmentAccess(
  db: Firestore,
  companyId: string,
  messageId: string,
  attachmentId: string,
  callerUid: string,
  mode: "read" | "write" = "read"
): Promise<
  | { ok: true; message: EmailMessageDoc & { id: string }; attachment: EmailMessageAttachmentMeta }
  | { ok: false; status: number; error: string }
> {
  const access = await assertMessageAccess(db, companyId, messageId, callerUid, mode);
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }
  const attachment = findMessageAttachment(access.message, attachmentId);
  if (!attachment) {
    return { ok: false, status: 404, error: "Příloha nenalezena." };
  }
  if (attachment.userVisible === false || attachment.hidden) {
    return { ok: false, status: 404, error: "Příloha není dostupná." };
  }
  if (!attachment.storagePath) {
    return { ok: false, status: 410, error: "Soubor přílohy nebyl uložen (příliš velký nebo chybějící storage)." };
  }
  return { ok: true, message: access.message, attachment };
}

export async function downloadEmailAttachmentBuffer(
  storagePath: string
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const bucket = getAdminStorageBucket();
  if (!bucket) throw new Error("Storage není dostupný.");
  const file = bucket.file(storagePath);
  const [meta] = await file.getMetadata().catch(() => [{ contentType: null }]);
  const [buf] = await file.download();
  return {
    buffer: buf,
    contentType: (meta as { contentType?: string }).contentType ?? null,
  };
}

export function visibleAttachmentsForMessage(message: EmailMessageDoc): EmailMessageAttachmentMeta[] {
  return userVisibleAttachments(message.attachments);
}
