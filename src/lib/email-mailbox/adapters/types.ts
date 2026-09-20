import type { EmailAccountDoc, EmailCredentialsPlain } from "@/lib/email-mailbox/types";

export type EmailFolderInfo = {
  path: string;
  name: string;
  specialUse?: string | null;
};

export type InboundEmailPayload = {
  imapUid: number;
  folder: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedAt: Date;
  sentAt?: Date | null;
  isRead?: boolean;
  attachments: {
    filename: string;
    contentType: string;
    content: Buffer;
  }[];
};

export type OutboundEmailPayload = {
  to: string[];
  cc?: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: {
    filename: string;
    contentType: string;
    content: Buffer;
  }[];
};

export type ConnectionTestResult = {
  ok: boolean;
  imapOk?: boolean;
  smtpOk?: boolean;
  errorCode?:
    | "imap_auth"
    | "smtp_auth"
    | "IMAP_AUTH_FAILED"
    | "SMTP_AUTH_FAILED"
    | "network"
    | "config"
    | "unknown";
  message?: string;
};

export interface EmailProviderAdapter {
  testConnection(
    account: Pick<
      EmailAccountDoc,
      "email" | "imapHost" | "imapPort" | "imapSecure" | "smtpHost" | "smtpPort" | "smtpSecure"
    >,
    credentials: EmailCredentialsPlain
  ): Promise<ConnectionTestResult>;

  syncInbound(
    account: EmailAccountDoc,
    credentials: EmailCredentialsPlain,
    opts: {
      sinceUid?: number | null;
      maxMessages?: number;
      storedUidValidity?: number | null;
    }
  ): Promise<{
    messages: InboundEmailPayload[];
    lastUid: number | null;
    sentFolderPath: string | null;
    inboxUidValidity: number | null;
    uidNext: number | null;
    mailboxExists: number | null;
  }>;

  sendMessage(
    account: EmailAccountDoc,
    credentials: EmailCredentialsPlain,
    message: OutboundEmailPayload
  ): Promise<{ messageId: string | null; appendToSent?: InboundEmailPayload | null }>;

  listFolders?(
    account: EmailAccountDoc,
    credentials: EmailCredentialsPlain
  ): Promise<EmailFolderInfo[]>;
}
