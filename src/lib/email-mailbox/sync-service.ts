import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { analyzeEmailMessageWithAi } from "@/lib/email-mailbox/ai-analyze-message";
import { computeEmailThreadId } from "@/lib/email-mailbox/threading";
import { appendEmailMessageTimeline } from "@/lib/email-mailbox/message-timeline";
import { runEmailAutomationForMessage } from "@/lib/email-mailbox/automation-engine";
import {
  emailAccountsCol,
  loadEmailAccount,
} from "@/lib/email-mailbox/account-store";
import {
  migrateLegacyEmailAccountIfNeeded,
  resolveAccountOwnerUserId,
} from "@/lib/email-mailbox/account-access";
import {
  resolveEmailCredentials,
  type EmailCredentialErrorCode,
} from "@/lib/email-mailbox/credential-resolver";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import {
  emailMessagesCol,
  inboundMessageDocId,
  saveInboundMessage,
} from "@/lib/email-mailbox/message-store";
import type {
  EmailAccountDoc,
  EmailAccountStatus,
  EmailLastSyncStatus,
  EmailMessageDoc,
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
import {
  EMAIL_BOOTSTRAP_WINDOW,
  EMAIL_SYNC_BATCH_SIZE,
  prepareHtmlBodyForFirestore,
  prepareTextBodyForFirestore,
} from "@/lib/email-mailbox/message-content-limits";
import { uploadEmailAttachments } from "@/lib/email-mailbox/attachment-upload";
import { shouldBackfillMessageAttachments } from "@/lib/email-mailbox/attachment-backfill";

export type SyncEmailAccountResult = {
  success: boolean;
  imported: number;
  skipped: number;
  processed: number;
  remaining: number;
  hasMore: boolean;
  accountId?: string;
  lastSyncAt?: string | null;
  lastSyncedUid?: number | null;
  error?: string;
  errorCode?: string;
};

function credentialToSyncError(code: EmailCredentialErrorCode): {
  status: EmailAccountStatus;
  lastSyncStatus: EmailLastSyncStatus;
  errorCode: string;
} {
  switch (code) {
    case "EMAIL_CREDENTIAL_DECRYPT_FAILED":
      return { status: "credentials_decrypt_failed", lastSyncStatus: "DECRYPT_ERROR", errorCode: "DECRYPT_ERROR" };
    case "EMAIL_CREDENTIAL_MISSING":
      return { status: "credentials_missing", lastSyncStatus: "CREDENTIAL_ERROR", errorCode: "CREDENTIAL_ERROR" };
    case "EMAIL_ENCRYPTION_KEY_MISSING":
      return { status: "attention", lastSyncStatus: "CREDENTIAL_ERROR", errorCode: "CONNECTION_ERROR" };
    default:
      return { status: "error", lastSyncStatus: "CREDENTIAL_ERROR", errorCode: "CREDENTIAL_ERROR" };
  }
}

function mapSyncFailure(err: unknown): {
  status: EmailAccountStatus;
  lastSyncStatus: EmailLastSyncStatus;
  message: string;
  errorCode: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as Error & { code?: string }).code;
  const lower = msg.toLowerCase();
  if (lower.includes("invalid_argument") && lower.includes("payload size")) {
    return {
      status: "error",
      lastSyncStatus: "SYNC_ERROR",
      message: "Zpráva byla příliš velká pro uložení. Sync pokračuje po dávkách s omezením těla.",
      errorCode: "DOCUMENT_TOO_LARGE",
    };
  }
  const auth =
    code === "IMAP_AUTH_FAILED" ||
    (lower.includes("auth") && !lower.includes("decrypt")) ||
    lower.includes("login") ||
    lower.includes("invalid password");
  if (err instanceof EmailSyncTimeoutError || code === "IMAP_TIMEOUT" || lower.includes("timeout")) {
    return {
      status: "error",
      lastSyncStatus: "CONNECTION_ERROR",
      message: "Synchronizace překročila časový limit. Zkuste to znovu.",
      errorCode: "IMAP_TIMEOUT",
    };
  }
  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")) {
    return {
      status: "error",
      lastSyncStatus: "CONNECTION_ERROR",
      message: "Server e-mailu není dostupný.",
      errorCode: "CONNECTION_ERROR",
    };
  }
  if (auth) {
    return {
      status: "auth_error",
      lastSyncStatus: "AUTH_ERROR",
      message: "Přihlášení k e-mailu selhalo. Zkontrolujte e-mail, heslo / heslo aplikace.",
      errorCode: "AUTH_ERROR",
    };
  }
  return {
    status: "error",
    lastSyncStatus: "SYNC_ERROR",
    message: msg.slice(0, 500),
    errorCode: "SYNC_FAILED",
  };
}

function backfillPending(account: EmailAccountDoc): boolean {
  const floor = account.inboxBackfillFloorUid ?? 0;
  const cursor = account.inboxBackfillCursorUid ?? 0;
  return floor > 0 && cursor > floor;
}

function resolveSyncPhase(
  account: EmailAccountDoc,
  preferBackfill: boolean
): {
  syncPhase: "incremental" | "bootstrap_newest" | "bootstrap_backfill";
  sinceUid: number;
} {
  const last = account.lastInboxUid ?? 0;
  if (preferBackfill && backfillPending(account)) {
    return { syncPhase: "bootstrap_backfill", sinceUid: last };
  }
  if (last > 0) {
    return { syncPhase: "incremental", sinceUid: last };
  }
  if (backfillPending(account)) {
    return { syncPhase: "bootstrap_backfill", sinceUid: 0 };
  }
  return { syncPhase: "bootstrap_newest", sinceUid: 0 };
}

export async function syncEmailAccount(
  db: Firestore,
  companyId: string,
  accountId: string,
  opts?: { batchSize?: number; skipAi?: boolean }
): Promise<SyncEmailAccountResult> {
  const batchSize = opts?.batchSize ?? EMAIL_SYNC_BATCH_SIZE;
  const loaded = await loadEmailAccount(db, companyId, accountId);
  if (!loaded) {
    return {
      success: false,
      imported: 0,
      skipped: 0,
      processed: 0,
      remaining: 0,
      hasMore: false,
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
      processed: 0,
      remaining: 0,
      hasMore: false,
      accountId,
      error: "Neplatná organizace.",
      errorCode: "TENANT_MISMATCH",
    };
  }

  if (account.status === "syncing" && isEmailSyncStateStale(account.updatedAt)) {
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
    const mapped = credentialToSyncError(credResult.errorCode);
    if (credResult.errorCode === "EMAIL_CREDENTIAL_DECRYPT_FAILED") {
      logEmailPhase("EMAIL_AUTH_ERROR", { accountId, kind: "DECRYPT_ERROR" });
    } else if (credResult.errorCode === "EMAIL_CREDENTIAL_MISSING") {
      logEmailPhase("EMAIL_AUTH_ERROR", { accountId, kind: "CREDENTIAL_MISSING" });
    }
    await emailAccountsCol(db, companyId).doc(accountId).update({
      status: mapped.status,
      lastSyncStatus: mapped.lastSyncStatus,
      lastError: credResult.message.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      success: false,
      imported: 0,
      skipped: 0,
      processed: 0,
      remaining: 0,
      hasMore: false,
      accountId,
      error: credResult.message,
      errorCode: mapped.errorCode,
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
      processed: 0,
      remaining: 0,
      hasMore: false,
      accountId,
      error: "Provider zatím není implementován.",
      errorCode: "PROVIDER",
    };
  }

  const accountRef = emailAccountsCol(db, companyId).doc(accountId);

  let syncStarted = false;
  let imported = 0;
  let skipped = 0;
  let processed = 0;
  let outcomeStatus: EmailAccountStatus = "connected";
  let lastSyncStatus: EmailLastSyncStatus = "SUCCESS";
  let lastError: string | null = null;
  let errorCode: string | undefined;
  let lastInboxUid = account.lastInboxUid ?? null;
  let inboxUidValidity = account.inboxUidValidity ?? null;
  let sentFolderPath = account.sentFolderPath ?? null;
  let inboxBackfillFloorUid = account.inboxBackfillFloorUid ?? null;
  let inboxBackfillCeilingUid = account.inboxBackfillCeilingUid ?? null;
  let inboxBackfillCursorUid = account.inboxBackfillCursorUid ?? null;
  let syncSucceeded = false;
  let hasMore = false;
  let remaining = 0;

  await accountRef.update({
    status: "syncing",
    updatedAt: FieldValue.serverTimestamp(),
  });
  syncStarted = true;

  try {
    let { syncPhase, sinceUid } = resolveSyncPhase(account, false);
    let result = await withEmailSyncTimeout(
      adapter.syncInbound(account, credentials, {
        sinceUid,
        batchSize,
        bootstrapWindow: EMAIL_BOOTSTRAP_WINDOW,
        syncPhase,
        backfillFloorUid: inboxBackfillFloorUid,
        backfillCursorUid: inboxBackfillCursorUid,
        storedUidValidity: account.inboxUidValidity ?? null,
      })
    );

    if (result.messages.length === 0 && backfillPending(account)) {
      ({ syncPhase, sinceUid } = resolveSyncPhase(account, true));
      result = await withEmailSyncTimeout(
        adapter.syncInbound(account, credentials, {
          sinceUid,
          batchSize,
          bootstrapWindow: EMAIL_BOOTSTRAP_WINDOW,
          syncPhase,
          backfillFloorUid: inboxBackfillFloorUid,
          backfillCursorUid: inboxBackfillCursorUid,
          storedUidValidity: account.inboxUidValidity ?? null,
        })
      );
    }

    hasMore = result.hasMore || backfillPending(account);
    remaining = result.remainingEstimate;
    logEmailPhase("EMAIL_SYNC_MESSAGES_FOUND", { count: result.messages.length });

    const bucket = getAdminStorageBucket();
    const aiQueue: { messageId: string; payload: Parameters<typeof analyzeEmailMessageWithAi>[2] }[] =
      [];

    for (const msg of result.messages) {
      processed++;
      try {
        const attachmentsMeta = await uploadEmailAttachments({
          bucket,
          companyId,
          accountId,
          attachments: msg.attachments,
        });

        const textPrep = prepareTextBodyForFirestore(msg.textBody);
        const htmlPrep = prepareHtmlBodyForFirestore(msg.htmlBody);

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
          subject: (msg.subject ?? "(bez předmětu)").slice(0, 2000),
          textBody: textPrep.text,
          htmlBody: htmlPrep.html,
          receivedAt: Timestamp.fromDate(msg.receivedAt),
          sentAt: msg.sentAt ? Timestamp.fromDate(msg.sentAt) : null,
          direction: "inbound" as const,
          folder: msg.folder,
          attachments: attachmentsMeta,
          resolved: false,
          needsReply: false,
          requiresAction: false,
          workflowState: "new" as const,
          threadId: computeEmailThreadId(accountId, {
            messageId: msg.messageId ?? null,
            inReplyTo: msg.inReplyTo ?? null,
            references: msg.references ?? [],
            subject: (msg.subject ?? "").slice(0, 2000),
          }),
          aiReviewPending: false,
        };

        const fromEmail = extractEmailAddress(msg.from);
        const customer = await resolveCustomerByEmail(db, companyId, fromEmail);
        let jobHint: { jobId: string; jobLabel: string } | null = null;
        if (customer) {
          jobHint = await resolveJobHint(db, companyId, customer.customerId);
        }

        const docId = inboundMessageDocId(
          accountId,
          msg.messageId,
          msg.imapUid,
          msg.folder
        );
        const { id: savedId, created } = await saveInboundMessage(
          db,
          companyId,
          {
            ...base,
            isRead: Boolean(msg.isRead),
            customerId: customer?.customerId ?? null,
            customerName: customer?.customerName ?? null,
            suggestedCustomerId: customer?.customerId ?? null,
            jobId: jobHint?.jobId ?? null,
            jobLabel: jobHint?.jobLabel ?? null,
            suggestedJobId: jobHint?.jobId ?? null,
          },
          docId
        );

        if (!created) {
          const ref = emailMessagesCol(db, companyId).doc(savedId);
          const prevSnap = await ref.get();
          const prev = prevSnap.data() as EmailMessageDoc | undefined;
          if (
            prev &&
            shouldBackfillMessageAttachments(prev.attachments, attachmentsMeta)
          ) {
            await ref.update({
              attachments: attachmentsMeta,
              updatedAt: FieldValue.serverTimestamp(),
            });
            logEmailPhase("EMAIL_SYNC_ATTACHMENT_BACKFILL", { messageId: savedId });
          }
          skipped++;
        } else {
          imported++;
          logEmailPhase("EMAIL_SYNC_MESSAGE_SAVED", { messageId: savedId, uid: msg.imapUid });
          void appendEmailMessageTimeline(db, companyId, savedId, {
            kind: "received",
            label: "Přijat e-mail",
            userId: ownerUserId || null,
          });
          if (!opts?.skipAi) {
            aiQueue.push({
              messageId: savedId,
              payload: {
                subject: msg.subject,
                textBody: textPrep.text,
                htmlBody: htmlPrep.html,
                from: msg.from,
                attachments: attachmentsMeta,
              },
            });
          }
        }

        if (msg.imapUid != null) {
          lastInboxUid = Math.max(lastInboxUid ?? 0, msg.imapUid);
          await accountRef
            .update({
              lastInboxUid,
              updatedAt: FieldValue.serverTimestamp(),
            })
            .catch(() => undefined);
        }
      } catch (saveErr) {
        const s = saveErr instanceof Error ? saveErr.message : String(saveErr);
        logEmailPhase("EMAIL_SYNC_ERROR", { accountId, phase: "save_message", detail: s.slice(0, 120) });
        skipped++;
      }
    }

    inboxUidValidity = result.inboxUidValidity ?? inboxUidValidity;
    sentFolderPath = result.sentFolderPath ?? sentFolderPath;

    if (result.bootstrapWindow) {
      inboxBackfillFloorUid = result.bootstrapWindow.floorUid;
      inboxBackfillCeilingUid = result.bootstrapWindow.ceilingUid;
      inboxBackfillCursorUid = result.nextBackfillCursorUid ?? inboxBackfillCursorUid;
    } else if (result.nextBackfillCursorUid != null) {
      inboxBackfillCursorUid = result.nextBackfillCursorUid;
    }

    if (syncPhase === "bootstrap_backfill" && !hasMore && inboxBackfillFloorUid) {
      inboxBackfillCursorUid = inboxBackfillFloorUid;
    }

    outcomeStatus = "connected";
    lastSyncStatus = hasMore ? "SYNC_PARTIAL" : "SUCCESS";
    lastError = null;
    syncSucceeded = true;

    logEmailPhase("EMAIL_SYNC_PROGRESS", { imported, skipped, remaining, hasMore });
    logEmailPhase(hasMore ? "EMAIL_SYNC_PARTIAL" : "EMAIL_SYNC_COMPLETE", {
      imported,
      skipped,
      accountId,
    });

    if (!opts?.skipAi && aiQueue.length > 0) {
      void runAiAnalysisBatch(db, companyId, aiQueue).catch(() => undefined);
    }

    return {
      success: true,
      imported,
      skipped,
      processed,
      remaining,
      hasMore,
      accountId,
      lastSyncAt: new Date().toISOString(),
      lastSyncedUid: lastInboxUid,
    };
  } catch (err) {
    const mapped = mapSyncFailure(err);
    outcomeStatus = mapped.status;
    lastSyncStatus = mapped.lastSyncStatus;
    lastError = mapped.message;
    errorCode = mapped.errorCode;
    logEmailPhase("EMAIL_SYNC_ERROR", { accountId, errorCode });
    if (mapped.errorCode === "AUTH_ERROR") {
      logEmailPhase("EMAIL_AUTH_ERROR", { accountId });
      logEmailPhase("EMAIL_IMAP_AUTH_FAILED", { accountId });
    }
    return {
      success: false,
      imported,
      skipped,
      processed,
      remaining: 0,
      hasMore: false,
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
        patch.inboxBackfillFloorUid = inboxBackfillFloorUid;
        patch.inboxBackfillCeilingUid = inboxBackfillCeilingUid;
        patch.inboxBackfillCursorUid = inboxBackfillCursorUid;
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
    const ref = db.collection("companies").doc(companyId).collection("email_messages").doc(item.messageId);
    const snap = await ref.get();
    const prev = snap.data() as EmailMessageDoc | undefined;
    const workflowState =
      ai.needsReply && !prev?.workflowState
        ? "waiting_reply"
        : ai.requiresAction
          ? "pending_action"
          : prev?.workflowState ?? "new";

    await ref.update({
      aiSummary: ai.summary,
      aiClassification: ai.category,
      aiCategory: ai.category,
      aiPriority: ai.priority,
      needsReply: ai.needsReply,
      requiresAction: ai.requiresAction,
      suggestedCustomerId: ai.suggestedCustomerId ?? null,
      suggestedJobId: ai.suggestedJobId ?? null,
      suggestedCustomerName: ai.suggestedCustomerName ?? null,
      suggestedJobLabel: ai.suggestedJobLabel ?? null,
      jobMatchConfidence: ai.jobMatchConfidence ?? null,
      suggestedActions: ai.suggestedActions,
      inquiryDraft: ai.inquiryDraft ?? null,
      aiReviewPending: Boolean(ai.inquiryDraft || ai.suggestedActions.length),
      aiInsights: ai.insights ?? [],
      workflowState,
      updatedAt: FieldValue.serverTimestamp(),
    });

    void appendEmailMessageTimeline(db, companyId, item.messageId, {
      kind: "ai_classified",
      label: `AI: ${ai.category}`,
      metadata: { priority: ai.priority, needsReply: ai.needsReply },
    });

    if (prev) {
      void runEmailAutomationForMessage(db, companyId, {
        message: { ...prev, ...ai, aiCategory: ai.category } as EmailMessageDoc,
      }).catch(() => undefined);
    }
  }
}
