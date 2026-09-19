/** Bezpečné logování fází e-mail integrace — nikdy nelogovat hesla. */
export type EmailLogPhase =
  | "EMAIL_CONNECT_START"
  | "EMAIL_IMAP_CONNECTED"
  | "EMAIL_SMTP_CONNECTED"
  | "EMAIL_SYNC_START"
  | "EMAIL_SYNC_MESSAGES_FOUND"
  | "EMAIL_SYNC_COMPLETED"
  | "EMAIL_CONNECT_ERROR";

export function logEmailPhase(
  phase: EmailLogPhase,
  meta?: Record<string, string | number | boolean | null | undefined>
): void {
  const safe = meta ? JSON.stringify(meta) : "";
  console.log(`[email-mailbox] ${phase}${safe ? ` ${safe}` : ""}`);
}
