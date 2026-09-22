export const COMPANY_CHAT_CONVERSATION_ID = "company";

export type ChatConversationType = "company" | "dm" | "group";

export type ChatConversationDoc = {
  id: string;
  companyId: string;
  type: ChatConversationType;
  name?: string | null;
  participantIds: string[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function isGroupConversationId(conversationId: string): boolean {
  return String(conversationId).startsWith("group_");
}

export function newGroupConversationId(): string {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : String(Date.now());
  return `group_${id}`;
}

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
  /** Kdo zprávu přečetl — uid → timestamp (DM / skupina). */
  readAtBy?: Record<string, unknown>;
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
