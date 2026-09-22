import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";

export type ChatMessageAccessContext = {
  uid: string;
  role: string;
  companyId: string;
};

export async function loadChatMessageForAccess(
  db: Firestore,
  companyId: string,
  messageId: string
): Promise<
  | { ok: true; data: Record<string, unknown>; attachments: ChatAttachmentMeta[] }
  | { ok: false; status: number; error: string }
> {
  const msgRef = db.collection("companies").doc(companyId).collection("chat").doc(messageId);
  const snap = await msgRef.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Zpráva nenalezena." };
  }
  const data = snap.data() as Record<string, unknown>;
  const attachments = Array.isArray(data.attachments)
    ? (data.attachments as ChatAttachmentMeta[])
    : [];
  return { ok: true, data, attachments };
}

export function callerCanAccessChatMessage(
  ctx: ChatMessageAccessContext,
  msg: Record<string, unknown>
): boolean {
  const cid = String(msg.conversationId ?? "company");
  const participantIds = Array.isArray(msg.participantIds)
    ? (msg.participantIds as string[])
    : [];
  const privileged = ["owner", "admin", "manager"].includes(String(ctx.role));
  if (cid === "company" || !msg.conversationId) return true;
  return participantIds.includes(ctx.uid) || privileged;
}

export function findChatAttachment(
  attachments: ChatAttachmentMeta[],
  attachmentId: string
): ChatAttachmentMeta | null {
  return attachments.find((a) => a.id === attachmentId) ?? null;
}
