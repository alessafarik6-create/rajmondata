import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { getEmailProviderAdapter } from "@/lib/email-mailbox/adapters";
import { analyzeEmailMessageWithAi } from "@/lib/email-mailbox/ai-analyze-message";
import {
  emailAccountsCol,
  loadEmailAccount,
  loadEmailCredentials,
} from "@/lib/email-mailbox/account-store";
import {
  findMessageByImapUid,
  findMessageByMessageId,
  saveInboundMessage,
} from "@/lib/email-mailbox/message-store";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";

export async function syncEmailAccount(
  db: Firestore,
  companyId: string,
  accountId: string,
  opts?: { maxMessages?: number }
): Promise<{ imported: number; skipped: number; error?: string }> {
  const account = await loadEmailAccount(db, companyId, accountId);
  if (!account) return { imported: 0, skipped: 0, error: "Účet nenalezen." };
  const credentials = await loadEmailCredentials(db, companyId, accountId);
  if (!credentials) return { imported: 0, skipped: 0, error: "Chybí přihlašovací údaje." };

  const adapter = getEmailProviderAdapter(account.provider);
  if (!adapter) {
    return { imported: 0, skipped: 0, error: "Provider zatím není implementován." };
  }

  try {
    const result = await adapter.syncInbound(account, credentials, {
      sinceUid: account.lastInboxUid ?? null,
      maxMessages: opts?.maxMessages ?? 40,
    });

    let imported = 0;
    let skipped = 0;
    const bucket = getAdminStorageBucket();

    for (const msg of result.messages) {
      if (msg.imapUid) {
        const existingUid = await findMessageByImapUid(db, companyId, accountId, msg.imapUid);
        if (existingUid) {
          skipped++;
          continue;
        }
      }
      if (msg.messageId) {
        const existingMid = await findMessageByMessageId(
          db,
          companyId,
          accountId,
          msg.messageId
        );
        if (existingMid) {
          skipped++;
          continue;
        }
      }

      const attachmentsMeta: EmailMessageAttachmentMeta[] = [];
      for (const att of msg.attachments) {
        const id = crypto.randomUUID();
        let storagePath: string | null = null;
        if (bucket) {
          storagePath = `companies/${companyId}/email_attachments/${accountId}/${id}_${att.filename}`;
          await bucket.file(storagePath).save(att.content, {
            contentType: att.contentType,
            resumable: false,
          });
        }
        attachmentsMeta.push({
          id,
          filename: att.filename,
          contentType: att.contentType,
          size: att.content.length,
          storagePath,
        });
      }

      const base = {
        organizationId: companyId,
        emailAccountId: accountId,
        providerMessageId: msg.messageId ?? null,
        imapUid: msg.imapUid,
        messageId: msg.messageId ?? null,
        inReplyTo: msg.inReplyTo ?? null,
        references: msg.references ?? [],
        from: msg.from,
        to: msg.to,
        cc: msg.cc ?? [],
        subject: msg.subject,
        textBody: msg.textBody ?? null,
        htmlBody: msg.htmlBody ?? null,
        receivedAt: Timestamp.fromDate(msg.receivedAt),
        direction: "inbound" as const,
        folder: msg.folder,
        attachments: attachmentsMeta,
        resolved: false,
        needsReply: false,
        aiReviewPending: false,
      };

      const messageId = await saveInboundMessage(db, companyId, base);
      imported++;

      const ai = await analyzeEmailMessageWithAi(db, companyId, {
        subject: msg.subject,
        textBody: msg.textBody,
        htmlBody: msg.htmlBody,
        from: msg.from,
        attachments: attachmentsMeta,
      });

      if (ai) {
        await db
          .collection("companies")
          .doc(companyId)
          .collection("email_messages")
          .doc(messageId)
          .update({
            aiSummary: ai.summary,
            aiClassification: ai.category,
            aiPriority: ai.priority,
            needsReply: ai.needsReply,
            suggestedActions: ai.suggestedActions,
            inquiryDraft: ai.inquiryDraft ?? null,
            aiReviewPending: Boolean(ai.inquiryDraft || ai.suggestedActions.length),
            updatedAt: FieldValue.serverTimestamp(),
          });
      }
    }

    await emailAccountsCol(db, companyId).doc(accountId).update({
      lastSyncAt: FieldValue.serverTimestamp(),
      lastInboxUid: result.lastUid ?? account.lastInboxUid ?? null,
      sentFolderPath: result.sentFolderPath ?? account.sentFolderPath ?? null,
      status: "connected",
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { imported, skipped };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await emailAccountsCol(db, companyId).doc(accountId).update({
      status: "error",
      lastError: msg.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { imported: 0, skipped: 0, error: msg };
  }
}
