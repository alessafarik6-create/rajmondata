import crypto from "node:crypto";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

/** Normalizace předmětu pro seskupení (Re:, Fwd:, …). */
export function normalizeEmailSubject(subject: string): string {
  let s = String(subject ?? "").trim();
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/^(re|fw|fwd|odp|přep):\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

/** Vypočítá stabilní threadId pro uložení na zprávu. */
export function computeEmailThreadId(
  emailAccountId: string,
  message: Pick<EmailMessageDoc, "messageId" | "inReplyTo" | "references" | "subject">
): string {
  const refs = [
    message.messageId?.trim(),
    message.inReplyTo?.trim(),
    ...(message.references ?? []).map((r) => String(r).trim()),
  ].filter(Boolean) as string[];

  const root = refs[0] ?? normalizeEmailSubject(message.subject);
  const hash = crypto
    .createHash("sha256")
    .update(`${emailAccountId}|${root.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `t_${hash}`;
}
