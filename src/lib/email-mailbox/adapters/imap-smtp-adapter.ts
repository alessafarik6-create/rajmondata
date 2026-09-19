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
import { logEmailPhase } from "@/lib/email-mailbox/email-log";

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
          ? "Nelze se přihlásit k IMAP. Zkontrolujte e-mail, heslo aplikace a nastavení Seznam.cz."
          : "Nelze se přihlásit k SMTP. Zkontrolujte e-mail, heslo aplikace a nastavení Seznam.cz.",
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

    logEmailPhase("EMAIL_CONNECT_START", { email: account.email, host: account.imapHost });
    const client = buildImapClient(account, credentials);
    try {
      await client.connect();
      await client.mailboxOpen("INBOX");
      logEmailPhase("EMAIL_IMAP_CONNECTED", { email: account.email });
      await client.logout();
    } catch (err) {
      logEmailPhase("EMAIL_CONNECT_ERROR", { phase: "imap", email: account.email });
      const r = mapConnectionError(err, "imap");
      return {
        ...r,
        imapOk: false,
        smtpOk: undefined,
        errorCode: "IMAP_AUTH_FAILED",
        message: r.message,
      };
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
      logEmailPhase("EMAIL_SMTP_CONNECTED", { email: account.email });
    } catch (err) {
      logEmailPhase("EMAIL_CONNECT_ERROR", { phase: "smtp", email: account.email });
      const r = mapConnectionError(err, "smtp");
      return {
        ...r,
        imapOk: true,
        smtpOk: false,
        errorCode: "SMTP_AUTH_FAILED",
        message: r.message,
      };
    }

    return {
      ok: true,
      imapOk: true,
      smtpOk: true,
      message: "IMAP připojení úspěšné. SMTP připojení úspěšné.",
    };
  }

  async syncInbound(
    account: EmailAccountDoc,
    credentials: EmailCredentialsPlain,
    opts: { sinceUid?: number | null; maxMessages?: number }
  ): Promise<{ messages: InboundEmailPayload[]; lastUid: number | null; sentFolderPath: string | null }> {
    const maxMessages = opts.maxMessages ?? 100;
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
        let uidList: number[] = [];
        if (sinceUid > 0) {
          for await (const msg of client.fetch(`${sinceUid + 1}:*`, { uid: true }, { uid: true })) {
            if (msg.uid) uidList.push(msg.uid);
          }
        } else {
          const searchResult = await client.search({ all: true }, { uid: true });
          uidList = (searchResult ?? []).slice().sort((a, b) => a - b);
          if (uidList.length > maxMessages) {
            uidList = uidList.slice(-maxMessages);
          }
        }
        uidList.sort((a, b) => a - b);
        if (uidList.length > maxMessages) {
          uidList = uidList.slice(-maxMessages);
        }

        for (const uid of uidList) {
          let source: Buffer | null = null;
          let seen = false;
          for await (const msg of client.fetch(
            `${uid}`,
            { uid: true, source: true, flags: true },
            { uid: true }
          )) {
            if (msg.source) source = msg.source;
            const flags = msg.flags;
            if (flags instanceof Set) seen = flags.has("\\Seen");
            else if (Array.isArray(flags)) seen = flags.includes("\\Seen");
          }
          if (!source) continue;
          const row = { uid, source, seen };
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
            sentAt: parsed.date ?? null,
            isRead: row.seen,
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
