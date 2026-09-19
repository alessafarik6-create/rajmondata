import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  EMAIL_MESSAGES_SUBCOLLECTION,
  type EmailMessageDoc,
  type EmailMessageWorkflowView,
} from "@/lib/email-mailbox/types";

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

export function buildMessageViewFilter(view: EmailMessageWorkflowView) {
  const now = Date.now();
  const staleMs = 48 * 60 * 60 * 1000;
  switch (view) {
    case "waiting_reply":
      return (m: EmailMessageDoc) =>
        Boolean(m.needsReply) && !m.resolved && m.direction === "inbound";
    case "ai_review":
      return (m: EmailMessageDoc) => Boolean(m.aiReviewPending);
    case "assigned":
      return (m: EmailMessageDoc) =>
        Boolean(m.customerId || m.jobId || m.inquiryId) && !m.resolved;
    case "unassigned":
      return (m: EmailMessageDoc) =>
        m.direction === "inbound" && !m.customerId && !m.jobId && !m.inquiryId && !m.resolved;
    case "resolved":
      return (m: EmailMessageDoc) => Boolean(m.resolved);
    case "sent":
      return (m: EmailMessageDoc) =>
        m.direction === "outbound" && !m.isDraft && !m.deleted;
    case "drafts":
      return (m: EmailMessageDoc) => Boolean(m.isDraft) && !m.deleted;
    case "archive":
      return (m: EmailMessageDoc) => Boolean(m.resolved) && !m.deleted;
    case "spam":
      return (m: EmailMessageDoc) =>
        String(m.aiClassification ?? "").toLowerCase() === "spam" && !m.deleted;
    case "trash":
      return (m: EmailMessageDoc) => Boolean(m.deleted);
    case "inbox":
    default:
      return (m: EmailMessageDoc) =>
        m.direction === "inbound" &&
        !m.deleted &&
        !m.isDraft &&
        !m.resolved &&
        String(m.aiClassification ?? "").toLowerCase() !== "spam";
  }
}

export function messageIsStaleNeedsReply(m: EmailMessageDoc): boolean {
  if (!m.needsReply || m.resolved || m.repliedAt) return false;
  const ts = m.receivedAt?.toMillis?.() ?? 0;
  if (!ts) return false;
  return Date.now() - ts > 48 * 60 * 60 * 1000;
}

export function inboundMessageDocId(
  emailAccountId: string,
  messageId: string | null | undefined,
  imapUid: number | null | undefined
): string {
  if (messageId?.trim()) {
    const hash = crypto
      .createHash("sha256")
      .update(`${emailAccountId}|${messageId.trim().toLowerCase()}`)
      .digest("hex")
      .slice(0, 40);
    return `m_${hash}`;
  }
  if (imapUid != null && imapUid > 0) {
    return `u_${emailAccountId}_${imapUid}`;
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
    inboundMessageDocId(data.emailAccountId, data.messageId, data.imapUid ?? null);
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
