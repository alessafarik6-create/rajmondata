import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type AddressObject } from "mailparser";
import type {
  ConnectionTestResult,
  EmailProviderAdapter,
  InboundEmailPayload,
  OutboundEmailPayload,
} from "@/lib/email-mailbox/adapters/types";
import type { EmailAccountDoc, EmailCredentialsPlain } from "@/lib/email-mailbox/types";

function mapConnectionError(err: unknown, phase: "imap" | "smtp"): ConnectionTestResult {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("auth") || lower.includes("credentials") || lower.includes("login")) {
    return {
      ok: false,
      imapOk: phase === "imap" ? false : undefined,
      smtpOk: phase === "smtp" ? false : undefined,
      errorCode: phase === "imap" ? "imap_auth" : "smtp_auth",
      message:
        phase === "imap"
          ? "Přihlášení k příchozí poště selhalo."
          : "SMTP přihlášení selhalo.",
    };
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("timeout") ||
    lower.includes("etimedout")
  ) {
    return {
      ok: false,
      errorCode: "network",
      message: "Server není dostupný.",
    };
  }
  if (lower.includes("invalid") || lower.includes("password")) {
    return {
      ok: false,
      errorCode: phase === "imap" ? "imap_auth" : "smtp_auth",
      message: "Heslo nebo heslo aplikace je nesprávné.",
    };
  }
  return {
    ok: false,
    errorCode: "unknown",
    message: phase === "imap" ? "Přihlášení k příchozí poště selhalo." : "SMTP přihlášení selhalo.",
  };
}

function addressesFromField(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const obj = Array.isArray(field) ? field[0] : field;
  if (!obj || !("value" in obj)) return [];
  return (obj.value ?? []).map((v) => v.address).filter(Boolean) as string[];
}

function buildImapClient(
  account: Pick<EmailAccountDoc, "email" | "imapHost" | "imapPort" | "imapSecure">,
  credentials: EmailCredentialsPlain
) {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: {
      user: credentials.username || account.email,
      pass: credentials.password,
    },
    logger: false,
  });
}

async function findSentFolder(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  for (const box of list) {
    const special = box.specialUse ?? "";
    if (special.includes("\\Sent")) return box.path;
  }
  for (const box of list) {
    const p = box.path.toLowerCase();
    if (p.includes("sent") || p.includes("odeslan") || p.includes("odeslané")) {
      return box.path;
    }
  }
  return null;
}

export class ImapSmtpEmailAdapter implements EmailProviderAdapter {
  async testConnection(
    account: Pick<
      EmailAccountDoc,
      "email" | "imapHost" | "imapPort" | "imapSecure" | "smtpHost" | "smtpPort" | "smtpSecure"
    >,
    credentials: EmailCredentialsPlain
  ): Promise<ConnectionTestResult> {
    if (!account.imapHost?.trim() || !account.smtpHost?.trim()) {
      return { ok: false, errorCode: "config", message: "Chybí adresa IMAP nebo SMTP serveru." };
    }

    const client = buildImapClient(account, credentials);
    try {
      await client.connect();
      await client.mailboxOpen("INBOX");
      await client.logout();
    } catch (err) {
      const r = mapConnectionError(err, "imap");
      return { ...r, imapOk: false, smtpOk: undefined };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: {
          user: credentials.username || account.email,
          pass: credentials.password,
        },
      });
      await transporter.verify();
    } catch (err) {
      const r = mapConnectionError(err, "smtp");
      return { ...r, imapOk: true, smtpOk: false };
    }

    return { ok: true, imapOk: true, smtpOk: true };
  }

  async syncInbound(
    account: EmailAccountDoc,
    credentials: EmailCredentialsPlain,
    opts: { sinceUid?: number | null; maxMessages?: number }
  ): Promise<{ messages: InboundEmailPayload[]; lastUid: number | null; sentFolderPath: string | null }> {
    const maxMessages = opts.maxMessages ?? 30;
    const client = buildImapClient(account, credentials);
    const out: InboundEmailPayload[] = [];
    let lastUid: number | null = opts.sinceUid ?? null;
    let sentFolderPath: string | null = account.sentFolderPath ?? null;

    await client.connect();
    try {
      if (!sentFolderPath) {
        sentFolderPath = await findSentFolder(client);
      }
      const lock = await client.getMailboxLock("INBOX");
      try {
        const sinceUid = Math.max(0, Number(opts.sinceUid ?? 0));
        const range = sinceUid > 0 ? `${sinceUid + 1}:*` : "1:*";
        const fetched: { uid: number; source: Buffer }[] = [];
        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          if (!msg.uid || !msg.source) continue;
          fetched.push({ uid: msg.uid, source: msg.source });
        }
        fetched.sort((a, b) => a.uid - b.uid);
        const slice = fetched.slice(-maxMessages);
        for (const row of slice) {
          const parsed = await simpleParser(row.source);
          const refsRaw = parsed.references;
          const references = Array.isArray(refsRaw)
            ? refsRaw.map(String)
            : refsRaw
              ? [String(refsRaw)]
              : [];
          const attachments: InboundEmailPayload["attachments"] = [];
          for (const att of parsed.attachments ?? []) {
            if (!att.content || !att.filename) continue;
            if (att.size > 8 * 1024 * 1024) continue;
            attachments.push({
              filename: att.filename,
              contentType: att.contentType || "application/octet-stream",
              content: att.content,
            });
          }
          out.push({
            imapUid: row.uid,
            folder: "INBOX",
            messageId: parsed.messageId ?? null,
            inReplyTo: parsed.inReplyTo ?? null,
            references,
            from: parsed.from?.text ?? "",
            to: addressesFromField(parsed.to),
            cc: addressesFromField(parsed.cc),
            subject: parsed.subject ?? "(bez předmětu)",
            textBody: parsed.text ?? null,
            htmlBody: typeof parsed.html === "string" ? parsed.html : null,
            receivedAt: parsed.date ?? new Date(),
            attachments,
          });
          lastUid = Math.max(lastUid ?? 0, row.uid);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    return { messages: out, lastUid, sentFolderPath };
  }

  async sendMessage(
    account: EmailAccountDoc,
    credentials: EmailCredentialsPlain,
    message: OutboundEmailPayload
  ): Promise<{ messageId: string | null; appendToSent?: InboundEmailPayload | null }> {
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: {
        user: credentials.username || account.email,
        pass: credentials.password,
      },
    });

    const headers: Record<string, string> = {};
    if (message.inReplyTo) headers["In-Reply-To"] = message.inReplyTo;
    if (message.references?.length) headers.References = message.references.join(" ");

    const info = await transporter.sendMail({
      from: account.displayName
        ? `"${account.displayName}" <${account.email}>`
        : account.email,
      to: message.to.join(", "),
      cc: message.cc?.length ? message.cc.join(", ") : undefined,
      subject: message.subject,
      text: message.textBody,
      html: message.htmlBody,
      headers,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    const messageId = typeof info.messageId === "string" ? info.messageId : null;

    if (account.sentFolderPath) {
      try {
        const raw = buildRawMimeForAppend(account, message, messageId);
        const client = buildImapClient(account, credentials);
        await client.connect();
        try {
          await client.append(account.sentFolderPath, raw, ["\\Seen"]);
        } finally {
          await client.logout();
        }
      } catch {
        /* append to Sent is best-effort */
      }
    }

    return { messageId };
  }
}

function buildRawMimeForAppend(
  account: EmailAccountDoc,
  message: OutboundEmailPayload,
  messageId: string | null
): string {
  const mid = messageId ?? `<${Date.now()}@${account.email.split("@")[1] ?? "local"}>`;
  const lines = [
    `From: ${account.email}`,
    `To: ${message.to.join(", ")}`,
    message.cc?.length ? `Cc: ${message.cc.join(", ")}` : null,
    `Subject: ${message.subject}`,
    `Message-ID: ${mid}`,
    message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : null,
    message.references?.length ? `References: ${message.references.join(" ")}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.textBody,
  ].filter(Boolean);
  return lines.join("\r\n");
}

export const imapSmtpEmailAdapter = new ImapSmtpEmailAdapter();
