import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { analyzeEmailMessageWithAi } from "@/lib/email-mailbox/ai-analyze-message";
import {
  emailAccountsCol,
  loadEmailAccount,
  loadEmailCredentials,
} from "@/lib/email-mailbox/account-store";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import { saveInboundMessage } from "@/lib/email-mailbox/message-store";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import {
  extractEmailAddress,
  resolveCustomerByEmail,
  resolveJobHint,
} from "@/lib/email-mailbox/contact-resolve";

const DEFAULT_MAX_MESSAGES = 100;

export async function syncEmailAccount(
  db: Firestore,
  companyId: string,
  accountId: string,
  opts?: { maxMessages?: number; skipAi?: boolean }
): Promise<{ imported: number; skipped: number; error?: string; errorCode?: string }> {
  const account = await loadEmailAccount(db, companyId, accountId);
  if (!account) {
    return { imported: 0, skipped: 0, error: "Účet nenalezen.", errorCode: "ACCOUNT_NOT_FOUND" };
  }
  if (account.organizationId && account.organizationId !== companyId) {
    return { imported: 0, skipped: 0, error: "Neplatná organizace.", errorCode: "TENANT_MISMATCH" };
  }

  const credentials = await loadEmailCredentials(db, companyId, accountId);
  if (!credentials) {
    return {
      imported: 0,
      skipped: 0,
      error: "Chybí přihlašovací údaje nebo nelze dešifrovat.",
      errorCode: "CREDENTIALS_MISSING",
    };
  }

  const { getEmailProviderAdapter } = await import("@/lib/email-mailbox/adapters");
  const adapter = getEmailProviderAdapter(account.provider);
  if (!adapter) {
    return { imported: 0, skipped: 0, error: "Provider zatím není implementován.", errorCode: "PROVIDER" };
  }

  const maxMessages = opts?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const isInitial = account.lastInboxUid == null || account.lastInboxUid === 0;

  await emailAccountsCol(db, companyId).doc(accountId).update({
    status: "syncing",
    updatedAt: FieldValue.serverTimestamp(),
  });

  logEmailPhase("EMAIL_SYNC_START", { companyId, accountId, maxMessages, initial: isInitial });

  try {
    const result = await adapter.syncInbound(account, credentials, {
      sinceUid: isInitial ? null : account.lastInboxUid ?? null,
      maxMessages,
    });

    logEmailPhase("EMAIL_SYNC_MESSAGES_FOUND", { count: result.messages.length });

    let imported = 0;
    let skipped = 0;
    const bucket = getAdminStorageBucket();
    const aiQueue: { messageId: string; payload: Parameters<typeof analyzeEmailMessageWithAi>[2] }[] =
      [];

    for (const msg of result.messages) {
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
        sentAt: msg.sentAt ? Timestamp.fromDate(msg.sentAt) : null,
        direction: "inbound" as const,
        folder: msg.folder,
        attachments: attachmentsMeta,
        resolved: false,
        needsReply: false,
        aiReviewPending: false,
      };

      const fromEmail = extractEmailAddress(msg.from);
      const customer = await resolveCustomerByEmail(db, companyId, fromEmail);
      let jobHint: { jobId: string; jobLabel: string } | null = null;
      if (customer) {
        jobHint = await resolveJobHint(db, companyId, customer.customerId);
      }

      const { id: savedId, created } = await saveInboundMessage(db, companyId, {
        ...base,
        isRead: Boolean(msg.isRead),
        customerId: customer?.customerId ?? null,
        customerName: customer?.customerName ?? null,
        suggestedCustomerId: customer?.customerId ?? null,
        jobId: jobHint?.jobId ?? null,
        jobLabel: jobHint?.jobLabel ?? null,
        suggestedJobId: jobHint?.jobId ?? null,
      });

      if (!created) {
        skipped++;
        continue;
      }
      imported++;

      if (!opts?.skipAi) {
        aiQueue.push({
          messageId: savedId,
          payload: {
            subject: msg.subject,
            textBody: msg.textBody,
            htmlBody: msg.htmlBody,
            from: msg.from,
            attachments: attachmentsMeta,
          },
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

    logEmailPhase("EMAIL_SYNC_COMPLETED", { imported, skipped });

    if (!opts?.skipAi && aiQueue.length > 0) {
      void runAiAnalysisBatch(db, companyId, aiQueue).catch(() => {
        /* AI nesmí shodit sync */
      });
    }

    return { imported, skipped };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEmailPhase("EMAIL_CONNECT_ERROR", { phase: "sync", accountId, detail: msg.slice(0, 200) });
    await emailAccountsCol(db, companyId).doc(accountId).update({
      status: "error",
      lastError: msg.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const lower = msg.toLowerCase();
    const errorCode =
      lower.includes("auth") || lower.includes("login") || lower.includes("credentials")
        ? "IMAP_AUTH_FAILED"
        : lower.includes("timeout") || lower.includes("etimedout")
          ? "IMAP_TIMEOUT"
          : "SYNC_FAILED";
    return { imported: 0, skipped: 0, error: msg, errorCode };
  }
}

async function runAiAnalysisBatch(
  db: Firestore,
  companyId: string,
  queue: { messageId: string; payload: Parameters<typeof analyzeEmailMessageWithAi>[2] }[]
): Promise<void> {
  for (const item of queue) {
    const ai = await analyzeEmailMessageWithAi(db, companyId, item.payload);
    if (!ai) continue;
    await db
      .collection("companies")
      .doc(companyId)
      .collection("email_messages")
      .doc(item.messageId)
      .update({
        aiSummary: ai.summary,
        aiClassification: ai.category,
        aiPriority: ai.priority,
        needsReply: ai.needsReply,
        suggestedActions: ai.suggestedActions,
        inquiryDraft: ai.inquiryDraft ?? null,
        aiReviewPending: Boolean(ai.inquiryDraft || ai.suggestedActions.length),
        aiInsights: ai.insights ?? [],
        updatedAt: FieldValue.serverTimestamp(),
      });
  }
}
