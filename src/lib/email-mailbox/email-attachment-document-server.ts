import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { companyDocumentIdForEmailAttachment } from "@/lib/email-mailbox/attachment-job-link-server";

export async function findExistingDocumentForEmailAttachment(
  db: Firestore,
  companyId: string,
  messageId: string,
  attachmentId: string
): Promise<{ id: string; exists: boolean }> {
  const deterministicId = companyDocumentIdForEmailAttachment(messageId, attachmentId);
  const detRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("documents")
    .doc(deterministicId);
  const detSnap = await detRef.get();
  if (detSnap.exists && detSnap.data()?.isDeleted !== true) {
    return { id: detSnap.id, exists: true };
  }

  const q = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("documents")
    .where("emailMessageId", "==", messageId)
    .where("emailAttachmentId", "==", attachmentId)
    .limit(1)
    .get()
    .catch(() => null);

  const hit = q?.docs?.find((d) => d.data()?.isDeleted !== true);
  if (hit) return { id: hit.id, exists: true };

  const q2 = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("documents")
    .where("sourceEmailMessageId", "==", messageId)
    .where("sourceAttachmentId", "==", attachmentId)
    .limit(1)
    .get()
    .catch(() => null);

  const hit2 = q2?.docs?.find((d) => d.data()?.isDeleted !== true);
  if (hit2) return { id: hit2.id, exists: true };

  return { id: deterministicId, exists: false };
}

export function patchEmailAttachmentDocumentMeta(
  attachments: EmailMessageAttachmentMeta[],
  attachmentId: string,
  patch: Partial<EmailMessageAttachmentMeta>
): EmailMessageAttachmentMeta[] {
  return attachments.map((a) => (a.id === attachmentId ? { ...a, ...patch } : a));
}
