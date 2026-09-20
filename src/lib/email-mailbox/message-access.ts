import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

/**
 * Viditelnost zprávy: schránka uživatele NEBO interní přiřazení kolegovi.
 * (SMTP přeposlání neukládá kopii jinému uživateli — jen interní assignment.)
 */
export function messageVisibleToUser(
  message: EmailMessageDoc,
  callerUid: string,
  accessibleAccountIds: Set<string>
): boolean {
  if (accessibleAccountIds.has(message.emailAccountId)) return true;
  const assignee = String(message.assignedToUserId ?? "").trim();
  if (assignee && assignee === callerUid) return true;
  return false;
}

/** @deprecated alias — používej messageVisibleToUser */
export function messageBelongsToUser(
  message: EmailMessageDoc,
  callerUid: string,
  accessibleAccountIds: Set<string>
): boolean {
  return messageVisibleToUser(message, callerUid, accessibleAccountIds);
}
