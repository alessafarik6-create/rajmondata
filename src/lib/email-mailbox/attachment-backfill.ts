import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

/** Doplnění příloh u již existující zprávy (re-sync bez duplicitního e-mailu). */
export function shouldBackfillMessageAttachments(
  existing: EmailMessageAttachmentMeta[] | null | undefined,
  incoming: EmailMessageAttachmentMeta[]
): boolean {
  if (!incoming.length) return false;
  const prev = existing ?? [];
  if (prev.length === 0) return true;
  const stored = prev.filter((a) => Boolean(a.storagePath)).length;
  const incomingStored = incoming.filter((a) => Boolean(a.storagePath)).length;
  return incomingStored > stored;
}
