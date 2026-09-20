export type EmailProviderKind = "SEZNAM" | "IMAP_SMTP" | "GOOGLE" | "MICROSOFT";

export type EmailAccountStatus =
  | "connected"
  | "error"
  | "auth_error"
  | "disconnected"
  | "pending"
  | "syncing"
  | "attention"
  | "credentials_missing"
  | "credentials_decrypt_failed";

export type EmailLastSyncStatus =
  | "SUCCESS"
  | "SYNC_PARTIAL"
  | "AUTH_ERROR"
  | "SYNC_ERROR"
  | "CREDENTIAL_ERROR"
  | "DECRYPT_ERROR"
  | "CONNECTION_ERROR";

export type EmailMessageDirection = "inbound" | "outbound";

export type { EmailMessageWorkflowView } from "@/lib/email-mailbox/intelligence-types";

export type EmailMailboxFolder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

/** Osobní schránka uživatele vs. sdílená firemní schránka (info@…). */
export type EmailAccountType = "PERSONAL" | "SHARED";

export type EmailMailboxMemberPermission = "READ" | "WRITE";

/** Viditelnost těla e-mailu u zakázky — výchozí je soukromé. */
export type EmailJobVisibility = "private" | "shared";

import type { Timestamp } from "firebase-admin/firestore";

export type EmailAccountDoc = {
  organizationId: string;
  /** Vlastník schránky (Firebase Auth uid). */
  userId?: string | null;
  accountType?: EmailAccountType | null;
  provider: EmailProviderKind;
  email: string;
  displayName?: string | null;
  status: EmailAccountStatus;
  /** Normalizovaná adresa pro deduplikaci (lowercase). */
  normalizedEmail?: string | null;
  /** Výchozí schránka uživatele pro odesílání / nové e-maily. */
  isDefault?: boolean | null;
  /** false = odpojeno, sync vypnut; záznam a historie zůstávají. */
  isActive?: boolean | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Poslední synchronizované IMAP UID v INBOX (pro inkrementální sync). */
  lastInboxUid?: number | null;
  /** IMAP UIDVALIDITY pro INBOX — při změně reset inkrementálního syncu. */
  inboxUidValidity?: number | null;
  sentFolderPath?: string | null;
  lastSyncAt?: Timestamp | null;
  lastSyncStatus?: EmailLastSyncStatus | null;
  lastError?: string | null;
  /** Spodní hranice bootstrap okna (posledních N zpráv při prvním připojení). */
  inboxBackfillFloorUid?: number | null;
  /** Horní hranice bootstrap okna. */
  inboxBackfillCeilingUid?: number | null;
  /** Kurzor backfillu směrem ke starším UID. */
  inboxBackfillCursorUid?: number | null;
  createdByUserId?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type EmailMessageAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath?: string | null;
  aiSuggestedAction?: string | null;
};

import type {
  EmailAiCategory,
  EmailAiPriority,
  EmailWorkflowState,
} from "@/lib/email-mailbox/intelligence-types";

export type EmailMessageAiFields = {
  aiSummary?: string | null;
  aiClassification?: string | null;
  aiCategory?: EmailAiCategory | null;
  aiPriority?: EmailAiPriority | "low" | "normal" | "high" | null;
  needsReply?: boolean;
  requiresAction?: boolean;
  suggestedCustomerId?: string | null;
  suggestedJobId?: string | null;
  suggestedInquiryId?: string | null;
  suggestedCustomerName?: string | null;
  suggestedJobLabel?: string | null;
  jobMatchConfidence?: "low" | "medium" | "high" | null;
  suggestedActions?: string[] | null;
  aiReviewPending?: boolean;
  inquiryDraft?: Record<string, unknown> | null;
  workflowState?: EmailWorkflowState | null;
  threadId?: string | null;
  assignedToUserId?: string | null;
  assignedByUserId?: string | null;
  assignedToEmployeeId?: string | null;
  assignmentNote?: string | null;
  assignmentDueAt?: Timestamp | null;
  assignmentStatus?: "pending" | "in_progress" | "done" | "cancelled" | null;
  reminderAt?: Timestamp | null;
  userMarkedSpam?: boolean;
};

export type EmailMessageDoc = {
  organizationId: string;
  emailAccountId: string;
  /** Vlastník komunikace (uid vlastníka schránky v době sync/odeslání). */
  ownerUserId?: string | null;
  providerMessageId?: string | null;
  imapUid?: number | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedAt?: Timestamp | null;
  sentAt?: Timestamp | null;
  direction: EmailMessageDirection;
  folder: string;
  customerId?: string | null;
  inquiryId?: string | null;
  offerId?: string | null;
  jobId?: string | null;
  /** Zda je obsah zprávy viditelný u přiřazené zakázky pro ostatní. */
  jobVisibility?: EmailJobVisibility | null;
  resolved?: boolean;
  isRead?: boolean;
  isDraft?: boolean;
  deleted?: boolean;
  customerName?: string | null;
  jobLabel?: string | null;
  aiInsights?: string[] | null;
  repliedAt?: Timestamp | null;
  attachments?: EmailMessageAttachmentMeta[];
  aiDraftReply?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
} & EmailMessageAiFields;

export type EmailCredentialsPlain = {
  username: string;
  password: string;
};

export const EMAIL_ACCOUNTS_SUBCOLLECTION = "email_accounts";
export const EMAIL_MESSAGES_SUBCOLLECTION = "email_messages";
export const EMAIL_ACCOUNT_CREDENTIALS_DOC = "credentials";
export const EMAIL_MAILBOX_MEMBERS_SUBCOLLECTION = "members";

export type EmailMailboxMemberDoc = {
  userId: string;
  permission: EmailMailboxMemberPermission;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
