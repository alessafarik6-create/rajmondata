export const COMPANY_CHAT_CONVERSATION_ID = "company";

export type ChatAttachmentMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  downloadUrl?: string | null;
  /** Po přiřazení k zakázce */
  linkedJobId?: string | null;
  linkedJobName?: string | null;
  linkedFolderId?: string | null;
  linkedJobMediaImageId?: string | null;
};

export type ChatMessageDoc = {
  id: string;
  senderId: string;
  senderRole: "employee" | "admin";
  text: string;
  createdAt?: { seconds?: number; nanoseconds?: number } | unknown;
  read?: boolean;
  companyId?: string;
  senderName?: string;
  senderPhotoURL?: string;
  employeeId?: string;
  conversationId?: string;
  participantIds?: string[];
  attachments?: ChatAttachmentMeta[];
  /** DM: uid příjemce (pro unread u zaměstnance) */
  recipientUserId?: string | null;
};

export function buildDirectConversationId(uidA: string, uidB: string): string {
  const a = String(uidA).trim();
  const b = String(uidB).trim();
  if (!a || !b) return "";
  return a < b ? `dm_${a}_${b}` : `dm_${b}_${a}`;
}

export function directMessageParticipantIds(uidA: string, uidB: string): string[] {
  const a = String(uidA).trim();
  const b = String(uidB).trim();
  if (!a || !b) return [];
  return a < b ? [a, b] : [b, a];
}

export function messageConversationKey(m: Pick<ChatMessageDoc, "conversationId">): string {
  const cid = String(m.conversationId ?? "").trim();
  return cid || COMPANY_CHAT_CONVERSATION_ID;
}

export function chatAttachmentStoragePath(
  companyId: string,
  conversationId: string,
  messageId: string,
  attachmentId: string,
  fileName: string
): string {
  const safe = fileName.replace(/^.*[\\/]/, "").replace(/\s+/g, "_").slice(0, 120) || "file";
  return `companies/${companyId}/chat/${conversationId}/${messageId}/${attachmentId}_${safe}`;
}
