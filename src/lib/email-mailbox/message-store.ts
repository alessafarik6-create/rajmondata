import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  EMAIL_MESSAGES_SUBCOLLECTION,
  type EmailMessageDoc,
} from "@/lib/email-mailbox/types";
export {
  buildMessageViewFilter,
  messageIsStaleNeedsReply,
  computeFolderCounts,
  computeDashboardEmailStats,
} from "@/lib/email-mailbox/workflow-views";

export function emailMessagesCol(db: Firestore, companyId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection(EMAIL_MESSAGES_SUBCOLLECTION);
}

export async function findMessageByImapUid(
  db: Firestore,
  companyId: string,
  emailAccountId: string,
  imapUid: number
): Promise<string | null> {
  const snap = await emailMessagesCol(db, companyId)
    .where("emailAccountId", "==", emailAccountId)
    .where("imapUid", "==", imapUid)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0]!.id;
}

export async function findMessageByMessageId(
  db: Firestore,
  companyId: string,
  emailAccountId: string,
  messageId: string
): Promise<string | null> {
  const snap = await emailMessagesCol(db, companyId)
    .where("emailAccountId", "==", emailAccountId)
    .where("messageId", "==", messageId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0]!.id;
}

export function inboundMessageDocId(
  emailAccountId: string,
  messageId: string | null | undefined,
  imapUid: number | null | undefined,
  folder?: string | null
): string {
  const folderKey = String(folder ?? "INBOX").trim().toUpperCase() || "INBOX";
  if (messageId?.trim()) {
    const hash = crypto
      .createHash("sha256")
      .update(`${emailAccountId}|${folderKey}|${messageId.trim().toLowerCase()}`)
      .digest("hex")
      .slice(0, 40);
    return `m_${hash}`;
  }
  if (imapUid != null && imapUid > 0) {
    return `u_${emailAccountId}_${folderKey}_${imapUid}`;
  }
  return crypto.randomUUID();
}

export async function saveInboundMessage(
  db: Firestore,
  companyId: string,
  data: Omit<EmailMessageDoc, "createdAt" | "updatedAt">,
  docId?: string
): Promise<{ id: string; created: boolean }> {
  const id =
    docId ??
    inboundMessageDocId(
      data.emailAccountId,
      data.messageId,
      data.imapUid ?? null,
      data.folder
    );
  const ref = emailMessagesCol(db, companyId).doc(id);
  const existing = await ref.get();
  if (existing.exists) return { id: ref.id, created: false };
  await ref.set({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, created: true };
}

export async function saveOutboundMessage(
  db: Firestore,
  companyId: string,
  data: Omit<EmailMessageDoc, "createdAt" | "updatedAt">
): Promise<string> {
  const ref = emailMessagesCol(db, companyId).doc();
  await ref.set({
    ...data,
    direction: "outbound",
    sentAt: Timestamp.fromDate(new Date()),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}
