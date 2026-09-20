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
import { EMAIL_IMAP_SYNC_TIMEOUT_MS } from "@/lib/email-mailbox/sync-timeout";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_BOOTSTRAP_WINDOW,
  EMAIL_SYNC_BATCH_SIZE,
} from "@/lib/email-mailbox/message-content-limits";
import { isLikelySignatureInlineAttachment } from "@/lib/email-mailbox/attachment-meta";

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

/** ImapFlow.search() vrací `false | number[]` — false není nullish. */
function uidsFromSearchResult(result: false | number[] | undefined | null): number[] {
  if (!Array.isArray(result)) return [];
  return [...result].sort((a, b) => a - b);
}

function imapFlagsIncludeSeen(flags: unknown): boolean {
  if (flags instanceof Set) return flags.has("\\Seen");
  if (Array.isArray(flags)) {
    return flags.some((f) => f === "\\Seen");
  }
  return false;
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
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: Math.min(EMAIL_IMAP_SYNC_TIMEOUT_MS, 120_000),
  });
}

function throwMappedImapSyncError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("auth") ||
    lower.includes("credentials") ||
    lower.includes("login") ||
    lower.includes("invalid password")
  ) {
    logEmailPhase("EMAIL_IMAP_AUTH_FAILED", { detail: msg.slice(0, 120) });
    const e = new Error(
      "Přihlášení k e-mailu selhalo. Zkontrolujte heslo / heslo aplikace."
    );
    (e as Error & { code?: string }).code = "IMAP_AUTH_FAILED";
    throw e;
  }
  if (lower.includes("timeout") || lower.includes("etimedout")) {
    logEmailPhase("EMAIL_IMAP_CONNECTION_FAILED", { detail: msg.slice(0, 120) });
    const e = new Error("IMAP server neodpověděl včas.");
    (e as Error & { code?: string }).code = "IMAP_TIMEOUT";
    throw e;
  }
  logEmailPhase("EMAIL_SYNC_ERROR", { detail: msg.slice(0, 200) });
  throw err instanceof Error ? err : new Error(msg);
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
    opts: {
      sinceUid?: number | null;
      batchSize?: number;
      bootstrapWindow?: number;
      syncPhase?: "incremental" | "bootstrap_newest" | "bootstrap_backfill";
      backfillFloorUid?: number | null;
      backfillCursorUid?: number | null;
      storedUidValidity?: number | null;
    }
  ): Promise<{
    messages: InboundEmailPayload[];
    lastUid: number | null;
    sentFolderPath: string | null;
    inboxUidValidity: number | null;
    uidNext: number | null;
    mailboxExists: number | null;
    hasMore: boolean;
    remainingEstimate: number;
    bootstrapWindow?: { floorUid: number; ceilingUid: number } | null;
    nextBackfillCursorUid?: number | null;
  }> {
    const batchSize = opts.batchSize ?? EMAIL_SYNC_BATCH_SIZE;
    const bootstrapWindow = opts.bootstrapWindow ?? EMAIL_BOOTSTRAP_WINDOW;
    const syncPhase = opts.syncPhase ?? "incremental";
    const client = buildImapClient(account, credentials);
    const out: InboundEmailPayload[] = [];
    let lastUid: number | null = opts.sinceUid ?? null;
    let sentFolderPath: string | null = account.sentFolderPath ?? null;
    let inboxUidValidity: number | null = null;
    let uidNext: number | null = null;
    let mailboxExists: number | null = null;

    logEmailPhase("EMAIL_IMAP_CONNECT_START", { host: account.imapHost, email: account.email });
    try {
      await client.connect();
      logEmailPhase("EMAIL_IMAP_CONNECTED", { email: account.email });
      if (!sentFolderPath) {
        sentFolderPath = await findSentFolder(client);
      }
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mailbox = client.mailbox;
        if (mailbox && typeof mailbox === "object") {
          const uv = mailbox.uidValidity;
          const un = mailbox.uidNext;
          inboxUidValidity = uv != null ? Number(uv) : null;
          uidNext = un != null ? Number(un) : null;
          mailboxExists = mailbox.exists ?? null;
        }
        logEmailPhase("EMAIL_MAILBOX_OPENED", { folder: "INBOX", email: account.email });
        logEmailPhase("EMAIL_UIDVALIDITY", { uidValidity: inboxUidValidity });
        logEmailPhase("EMAIL_UID_NEXT", { uidNext });
        logEmailPhase("EMAIL_LAST_SYNCED_UID", { lastSyncedUid: opts.sinceUid ?? null });

        let sinceUid = Math.max(0, Number(opts.sinceUid ?? 0));
        const storedValidity = opts.storedUidValidity ?? account.inboxUidValidity ?? null;
        if (
          storedValidity != null &&
          inboxUidValidity != null &&
          storedValidity !== inboxUidValidity
        ) {
          logEmailPhase("EMAIL_UIDVALIDITY", {
            reset: true,
            previous: storedValidity,
            current: inboxUidValidity,
          });
          sinceUid = 0;
          lastUid = null;
        }

        let uidBatch: number[] = [];
        let hasMore = false;
        let remainingEstimate = 0;
        let bootstrapWindowMeta: { floorUid: number; ceilingUid: number } | null = null;
        let nextBackfillCursorUid: number | null = null;

        if (syncPhase === "incremental" && sinceUid > 0) {
          const searchResult = await client.search({ uid: `${sinceUid + 1}:*` }, { uid: true });
          const pending = uidsFromSearchResult(searchResult)
            .filter((u) => u > sinceUid)
            .sort((a, b) => a - b);
          uidBatch = pending.slice(0, batchSize);
          remainingEstimate = Math.max(0, pending.length - uidBatch.length);
          hasMore = remainingEstimate > 0;
        } else if (syncPhase === "bootstrap_backfill") {
          const floor = Number(opts.backfillFloorUid ?? 0);
          const cursor = Number(opts.backfillCursorUid ?? 0);
          if (floor > 0 && cursor > floor) {
            const searchResult = await client.search({ uid: `${floor}:${cursor - 1}` }, { uid: true });
            const pending = uidsFromSearchResult(searchResult)
              .filter((u) => u >= floor && u < cursor)
              .sort((a, b) => b - a);
            uidBatch = pending.slice(0, batchSize);
            remainingEstimate = Math.max(0, pending.length - uidBatch.length);
            hasMore = remainingEstimate > 0 || uidBatch.length > 0;
            if (uidBatch.length > 0) {
              nextBackfillCursorUid = Math.min(...uidBatch);
            }
          }
        } else {
          const searchResult = await client.search({ all: true }, { uid: true });
          const all = uidsFromSearchResult(searchResult);
          const window = all.length > bootstrapWindow ? all.slice(-bootstrapWindow) : all;
          if (window.length > 0) {
            bootstrapWindowMeta = {
              floorUid: window[0]!,
              ceilingUid: window[window.length - 1]!,
            };
          }
          uidBatch = window.slice(-batchSize);
          const olderInWindow = window.length - uidBatch.length;
          remainingEstimate = olderInWindow;
          hasMore = olderInWindow > 0;
          if (bootstrapWindowMeta && uidBatch.length > 0) {
            nextBackfillCursorUid = Math.min(...uidBatch);
          }
        }

        logEmailPhase("EMAIL_SYNC_BATCH_START", { phase: syncPhase, size: uidBatch.length });
        logEmailPhase("EMAIL_SYNC_BATCH_SIZE", { batchSize: uidBatch.length, remainingEstimate });
        logEmailPhase("EMAIL_NEW_UIDS_COUNT", { count: uidBatch.length });
        if (uidBatch.length > 0) {
          logEmailPhase("EMAIL_NEW_UID_RANGE", {
            from: uidBatch[0] ?? null,
            to: uidBatch[uidBatch.length - 1] ?? null,
          });
        }

        for (const uid of uidBatch) {
          let source: Buffer | null = null;
          let seen = false;
          for await (const msg of client.fetch(
            `${uid}`,
            { uid: true, source: true, flags: true },
            { uid: true }
          )) {
            if (msg.source instanceof Buffer) source = msg.source;
            else if (typeof msg.source === "string") source = Buffer.from(msg.source);
            seen = imapFlagsIncludeSeen(msg.flags);
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
            if (!att.content) continue;
            const filename =
              String(att.filename ?? "").trim() ||
              (att.contentId ? `inline-${String(att.contentId).replace(/[<>]/g, "")}` : "") ||
              "priloha.bin";
            const size = att.size ?? att.content.length ?? 0;
            if (size <= 0) continue;
            const disposition =
              att.contentDisposition === "inline"
                ? "inline"
                : att.contentDisposition === "attachment"
                  ? "attachment"
                  : null;
            const contentId = att.contentId ? String(att.contentId) : null;
            const related = Boolean((att as { related?: boolean }).related);
            const userVisible = !isLikelySignatureInlineAttachment({
              filename,
              contentType: att.contentType || "application/octet-stream",
              size,
              disposition,
              contentId,
              related,
            });
            if (!userVisible) continue;
            if (size > EMAIL_ATTACHMENT_MAX_BYTES) continue;
            attachments.push({
              filename,
              contentType: att.contentType || "application/octet-stream",
              content: att.content,
              disposition,
              contentId,
              related,
              userVisible: true,
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
        logEmailPhase("EMAIL_MESSAGES_FETCHED", { count: out.length });
        logEmailPhase("EMAIL_SYNC_BATCH_DONE", { fetched: out.length, hasMore, remainingEstimate });

        return {
          messages: out,
          lastUid,
          sentFolderPath,
          inboxUidValidity,
          uidNext,
          mailboxExists,
          hasMore,
          remainingEstimate,
          bootstrapWindow: bootstrapWindowMeta,
          nextBackfillCursorUid,
        };
      } finally {
        lock.release();
      }
    } catch (err) {
      throwMappedImapSyncError(err);
    } finally {
      await client.logout().catch(() => undefined);
    }

    return {
      messages: out,
      lastUid,
      sentFolderPath,
      inboxUidValidity,
      uidNext,
      mailboxExists,
      hasMore: false,
      remainingEstimate: 0,
      bootstrapWindow: null,
      nextBackfillCursorUid: null,
    };
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
