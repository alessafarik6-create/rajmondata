export type EmailProviderKind = "SEZNAM" | "IMAP_SMTP" | "GOOGLE" | "MICROSOFT";

export type EmailAccountStatus = "connected" | "error" | "disconnected" | "pending";

export type EmailMessageDirection = "inbound" | "outbound";

export type EmailMessageWorkflowView =
  | "inbox"
  | "waiting_reply"
  | "ai_review"
  | "assigned"
  | "unassigned"
  | "resolved";

import type { Timestamp } from "firebase-admin/firestore";

export type EmailAccountDoc = {
  organizationId: string;
  provider: EmailProviderKind;
  email: string;
  displayName?: string | null;
  status: EmailAccountStatus;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Poslední synchronizované IMAP UID v INBOX (pro inkrementální sync). */
  lastInboxUid?: number | null;
  sentFolderPath?: string | null;
  lastSyncAt?: Timestamp | null;
  lastError?: string | null;
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

export type EmailMessageAiFields = {
  aiSummary?: string | null;
  aiClassification?: string | null;
  aiPriority?: "low" | "normal" | "high" | null;
  needsReply?: boolean;
  suggestedCustomerId?: string | null;
  suggestedJobId?: string | null;
  suggestedInquiryId?: string | null;
  suggestedActions?: string[] | null;
  aiReviewPending?: boolean;
  inquiryDraft?: Record<string, unknown> | null;
};

export type EmailMessageDoc = {
  organizationId: string;
  emailAccountId: string;
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
  resolved?: boolean;
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
