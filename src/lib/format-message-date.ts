/**
 * Datum a metadata zpráv / poznámek (chat, výkresy, dokumenty).
 * Podporuje Firestore Timestamp, Date, ISO string, legacy pole.
 */

import {
  formatMessageDateFromValue,
  MESSAGE_DATE_UNKNOWN,
  safeTime,
} from "@/lib/date-safe";
import { authorRoleLabelCs } from "@/lib/job-customer-chat";

export { MESSAGE_DATE_UNKNOWN, formatMessageDateFromValue };

const TIMESTAMP_KEYS = [
  "createdAt",
  "updatedAt",
  "timestamp",
  "sentAt",
  "created",
  "date",
  "customerCommentAt",
  "created_at",
  "createdAtMs",
] as const;

/** Vrátí první použitelný časový údaj ze záznamu zprávy. */
export function messageTimestampFromRecord(
  message: Record<string, unknown> | null | undefined
): unknown {
  if (!message) return null;
  for (const key of TIMESTAMP_KEYS) {
    const v = message[key];
    if (v != null && safeTime(v) > 0) return v;
  }
  return message.createdAt ?? message.updatedAt ?? null;
}

/** Datum zprávy z objektu (createdAt a legacy pole). */
export function formatMessageDate(
  message: Record<string, unknown> | null | undefined
): string {
  return formatMessageDateFromValue(messageTimestampFromRecord(message));
}

export function compareMessagesByCreatedAt(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): number {
  return safeTime(messageTimestampFromRecord(a)) - safeTime(messageTimestampFromRecord(b));
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function messageAuthorNameFromRecord(
  message: Record<string, unknown> | null | undefined
): string {
  if (!message) return "—";
  const name = trimStr(
    message.createdByName ??
      message.authorName ??
      message.senderName ??
      message.createdBy ??
      message.authorId ??
      message.senderId
  );
  return name || "—";
}

export function messageAuthorRoleFromRecord(
  message: Record<string, unknown> | null | undefined
): string {
  if (!message) return "";
  return trimStr(
    message.createdByRole ??
      message.authorRole ??
      message.senderRole ??
      message.authorType
  );
}

export function messageAuthorRoleLabelFromRecord(
  message: Record<string, unknown> | null | undefined
): string {
  const role = messageAuthorRoleFromRecord(message).toLowerCase();
  if (!role) return "—";
  if (role === "employee") return "Zaměstnanec";
  if (role === "admin" || role === "owner" || role === "manager") return "Administrátor";
  if (role === "customer") return "Zákazník";
  const fromChat = authorRoleLabelCs(role);
  if (fromChat && fromChat !== role) return fromChat;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Pole pro zápis nové zprávy / poznámky (canonical + legacy aliasy). */
export function buildMessageAuthorPersistFields(params: {
  userId: string;
  authorName: string;
  authorRole: string;
}): {
  createdBy: string;
  createdByName: string;
  createdByRole: string;
  authorId: string;
  authorName: string;
  authorRole: string;
} {
  const userId = trimStr(params.userId);
  const authorName = trimStr(params.authorName) || "—";
  const authorRole = trimStr(params.authorRole) || "admin";
  return {
    createdBy: userId,
    createdByName: authorName,
    createdByRole: authorRole,
    authorId: userId,
    authorName,
    authorRole,
  };
}
