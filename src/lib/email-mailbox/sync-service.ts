import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { analyzeEmailMessageWithAi } from "@/lib/email-mailbox/ai-analyze-message";
import {
  emailAccountsCol,
  loadEmailAccount,
} from "@/lib/email-mailbox/account-store";
import {
  migrateLegacyEmailAccountIfNeeded,
  resolveAccountOwnerUserId,
} from "@/lib/email-mailbox/account-access";
import {
  accountStatusFromCredentialResult,
  resolveEmailCredentials,
} from "@/lib/email-mailbox/credential-resolver";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import { saveInboundMessage } from "@/lib/email-mailbox/message-store";
import type {
  EmailAccountStatus,
  EmailLastSyncStatus,
  EmailMessageAttachmentMeta,
} from "@/lib/email-mailbox/types";
import {
  extractEmailAddress,
  resolveCustomerByEmail,
  resolveJobHint,
} from "@/lib/email-mailbox/contact-resolve";
import {
  EmailSyncTimeoutError,
  isEmailSyncStateStale,
  withEmailSyncTimeout,
} from "@/lib/email-mailbox/sync-timeout";

const DEFAULT_MAX_MESSAGES = 100;

export type SyncEmailAccountResult = {
  success: boolean;
  imported: number;
  skipped: number;
  accountId?: string;
  lastSyncAt?: string | null;
  error?: string;
  errorCode?: string;
};

function mapSyncFailure(err: unknown): {
  status: EmailAccountStatus;
  lastSyncStatus: EmailLastSyncStatus;
  message: string;
  errorCode: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as Error & { code?: string }).code;
  const lower = msg.toLowerCase();
  const auth =
    code === "IMAP_AUTH_FAILED" ||
    lower.includes("auth") ||
    lower.includes("login") ||
    lower.includes("credentials") ||
    lower.includes("heslo");
  if (err instanceof EmailSyncTimeoutError || code === "IMAP_TIMEOUT" || lower.includes("timeout")) {
    return {
      status: "error",
      lastSyncStatus: "SYNC_ERROR",
      message: "Synchronizace překročila časový limit. Zkuste to znovu.",
      errorCode: "IMAP_TIMEOUT",
    };
  }
  if (auth) {
    return {
      status: "auth_error",
      lastSyncStatus: "AUTH_ERROR",
      message: "Přihlášení k e-mailu selhalo. Zkontrolujte heslo / heslo aplikace.",
      errorCode: "IMAP_AUTH_FAILED",
    };
  }
  return {
    status: "error",
    lastSyncStatus: "SYNC_ERROR",
    message: msg.slice(0, 500),
    errorCode: "SYNC_FAILED",
  };
}

export async function syncEmailAccount(
  db: Firestore,
  companyId: string,
  accountId: string,
  opts?: { maxMessages?: number; skipAi?: boolean }
): Promise<SyncEmailAccountResult> {
  const loaded = await loadEmailAccount(db, companyId, accountId);
  if (!loaded) {
    return {
      success: false,
      imported: 0,
      skipped: 0,
      accountId,
      error: "Účet nenalezen.",
      errorCode: "ACCOUNT_NOT_FOUND",
    };
  }
  let account = await migrateLegacyEmailAccountIfNeeded(db, companyId, loaded);
  const ownerUserId = resolveAccountOwnerUserId(account);
  if (account.organizationId && account.organizationId !== companyId) {
    return {
      success: false,
      imported: 0,
      skipped: 0,
      accountId,
      error: "Neplatná organizace.",
      errorCode: "TENANT_MISMATCH",
    };
  }

  if (account.status === "syncing" && isEmailSyncStateStale(account.updatedAt)) {
    logEmailPhase("EMAIL_SYNC_ERROR", { accountId, reason: "stale_syncing_reset" });
    await emailAccountsCol(db, companyId)
      .doc(accountId)
      .update({
        status: "error",
        lastSyncStatus: "SYNC_ERROR",
        lastError: "Předchozí synchronizace nebyla dokončena.",
        updatedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);
    account = { ...account, status: "error" };
  }

  logEmailPhase("EMAIL_SYNC_START", { companyId, accountId });
  logEmailPhase("EMAIL_ACCOUNT_ID", { accountId });

  const credResult = await resolveEmailCredentials(db, companyId, accountId);
  if (!credResult.ok) {
    const status = accountStatusFromCredentialResult(account.status, credResult) as EmailAccountStatus;
    await emailAccountsCol(db, companyId).doc(accountId).update({
      status,
      lastSyncStatus: "CREDENTIAL_ERROR",
      lastError: credResult.message.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      success: false,
      imported: 0,
      skipped: 0,
      accountId,
      error: credResult.message,
      errorCode: credResult.errorCode,
    };
  }
  const credentials = credResult.credentials;

  const { getEmailProviderAdapter } = await import("@/lib/email-mailbox/adapters");
  const adapter = getEmailProviderAdapter(account.provider);
  if (!adapter) {
    return {
      success: false,
      imported: 0,
      skipped: 0,
      accountId,
      error: "Provider zatím není implementován.",
      errorCode: "PROVIDER",
    };
  }

  const maxMessages = opts?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const isInitial = account.lastInboxUid == null || account.lastInboxUid === 0;
  const accountRef = emailAccountsCol(db, companyId).doc(accountId);

  let syncStarted = false;
  let imported = 0;
  let skipped = 0;
  let outcomeStatus: EmailAccountStatus = "connected";
  let lastSyncStatus: EmailLastSyncStatus = "SUCCESS";
  let lastError: string | null = null;
  let errorCode: string | undefined;
  let lastInboxUid = account.lastInboxUid ?? null;
  let inboxUidValidity = account.inboxUidValidity ?? null;
  let sentFolderPath = account.sentFolderPath ?? null;
  let syncSucceeded = false;

  await accountRef.update({
    status: "syncing",
    updatedAt: FieldValue.serverTimestamp(),
  });
  syncStarted = true;

  try {
    const result = await withEmailSyncTimeout(
      adapter.syncInbound(account, credentials, {
        sinceUid: isInitial ? null : account.lastInboxUid ?? null,
        maxMessages,
        storedUidValidity: account.inboxUidValidity ?? null,
      })
    );

    logEmailPhase("EMAIL_SYNC_MESSAGES_FOUND", { count: result.messages.length });

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
        ownerUserId: ownerUserId || null,
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

    lastInboxUid = result.lastUid ?? lastInboxUid;
    inboxUidValidity = result.inboxUidValidity ?? inboxUidValidity;
    sentFolderPath = result.sentFolderPath ?? sentFolderPath;
    outcomeStatus = "connected";
    lastSyncStatus = "SUCCESS";
    lastError = null;
    syncSucceeded = true;

    logEmailPhase("EMAIL_MESSAGES_SAVED", { imported, skipped });
    logEmailPhase("EMAIL_SYNC_COMPLETED", { imported, skipped, accountId });

    if (!opts?.skipAi && aiQueue.length > 0) {
      void runAiAnalysisBatch(db, companyId, aiQueue).catch(() => {
        /* AI nesmí shodit sync */
      });
    }

    return {
      success: true,
      imported,
      skipped,
      accountId,
      lastSyncAt: new Date().toISOString(),
    };
  } catch (err) {
    const mapped = mapSyncFailure(err);
    outcomeStatus = mapped.status;
    lastSyncStatus = mapped.lastSyncStatus;
    lastError = mapped.message;
    errorCode = mapped.errorCode;
    logEmailPhase("EMAIL_SYNC_ERROR", { accountId, errorCode });
    if (mapped.errorCode === "IMAP_AUTH_FAILED") {
      logEmailPhase("EMAIL_IMAP_AUTH_FAILED", { accountId });
    }
    return {
      success: false,
      imported: 0,
      skipped: 0,
      accountId,
      error: mapped.message,
      errorCode: mapped.errorCode,
    };
  } finally {
    if (syncStarted) {
      const patch: Record<string, unknown> = {
        status: outcomeStatus === "syncing" ? "error" : outcomeStatus,
        lastSyncStatus,
        lastError,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (syncSucceeded) {
        patch.lastSyncAt = FieldValue.serverTimestamp();
        patch.lastInboxUid = lastInboxUid;
        patch.inboxUidValidity = inboxUidValidity;
        patch.sentFolderPath = sentFolderPath;
      }
      await accountRef.update(patch).catch((e) => {
        console.error("[email-mailbox] sync finally update failed", e);
      });
    }
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
