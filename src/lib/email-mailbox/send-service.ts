import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getEmailProviderAdapter } from "@/lib/email-mailbox/adapters";
import {
  loadEmailAccount,
  loadEmailCredentials,
} from "@/lib/email-mailbox/account-store";
import { saveOutboundMessage } from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

export async function sendEmailFromAccount(
  db: Firestore,
  companyId: string,
  accountId: string,
  payload: {
    to: string[];
    cc?: string[];
    subject: string;
    textBody: string;
    htmlBody?: string;
    inReplyTo?: string | null;
    references?: string[];
    replyToMessage?: Pick<EmailMessageDoc, "messageId" | "references" | "subject"> | null;
    attachments?: { filename: string; contentType: string; content: Buffer }[];
  }
): Promise<{ messageDocId: string; messageId: string | null }> {
  const account = await loadEmailAccount(db, companyId, accountId);
  if (!account) throw new Error("E-mailový účet nenalezen.");
  const credentials = await loadEmailCredentials(db, companyId, accountId);
  if (!credentials) throw new Error("Chybí přihlašovací údaje.");

  const adapter = getEmailProviderAdapter(account.provider);
  if (!adapter) throw new Error("Provider není implementován.");

  let subject = payload.subject;
  if (payload.replyToMessage && !subject.toLowerCase().startsWith("re:")) {
    subject = `Re: ${payload.replyToMessage.subject}`;
  }

  const inReplyTo = payload.inReplyTo ?? payload.replyToMessage?.messageId ?? null;
  const references = [
    ...(payload.replyToMessage?.references ?? []),
    ...(payload.replyToMessage?.messageId ? [payload.replyToMessage.messageId] : []),
    ...(payload.references ?? []),
  ].filter(Boolean);

  const sent = await adapter.sendMessage(account, credentials, {
    to: payload.to,
    cc: payload.cc,
    subject,
    textBody: payload.textBody,
    htmlBody: payload.htmlBody,
    inReplyTo,
    references,
    attachments: payload.attachments,
  });

  const messageDocId = await saveOutboundMessage(db, companyId, {
    organizationId: companyId,
    emailAccountId: accountId,
    messageId: sent.messageId,
    inReplyTo,
    references,
    from: account.email,
    to: payload.to,
    cc: payload.cc ?? [],
    subject,
    textBody: payload.textBody,
    htmlBody: payload.htmlBody ?? null,
    receivedAt: null,
    sentAt: Timestamp.fromDate(new Date()),
    direction: "outbound",
    folder: account.sentFolderPath ?? "Sent",
    needsReply: false,
    resolved: true,
  });

  if (payload.replyToMessage?.messageId) {
    const snap = await db
      .collection("companies")
      .doc(companyId)
      .collection("email_messages")
      .where("messageId", "==", payload.replyToMessage.messageId)
      .limit(1)
      .get();
    if (!snap.empty) {
      await snap.docs[0]!.ref.update({
        repliedAt: FieldValue.serverTimestamp(),
        needsReply: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return { messageDocId, messageId: sent.messageId };
}
