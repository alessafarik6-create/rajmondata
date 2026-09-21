import type { Firestore } from "firebase-admin/firestore";
import {
  ensureUserDefaultAccountMigrated,
  listEmailAccountsAccessibleToUser,
  resolveAccountOwnerUserId,
} from "@/lib/email-mailbox/account-access";
import {
  isEmailAccountConnected,
  isEmailAccountSyncable,
  pickDefaultAccountId,
} from "@/lib/email-mailbox/account-default";
import { emailMessagesCol, computeDashboardEmailStats } from "@/lib/email-mailbox/message-store";
import type { EmailAccountDoc, EmailMessageDoc } from "@/lib/email-mailbox/types";
import { messageVisibleToUser } from "@/lib/email-mailbox/message-access";

export type EmailMailboxAccessErrorCode =
  | "EMAIL_PERMISSION_DENIED"
  | "EMAIL_MAILBOX_NOT_CONFIGURED"
  | "EMAIL_MAILBOX_DISCONNECTED"
  | "EMAIL_PROVIDER_ERROR";

export type ResolvedActiveMailbox = {
  mailboxId: string;
  provider: string;
  emailAddress: string;
  active: boolean;
  connectionStatus: string;
};

export type UserMailboxContext =
  | { ok: true; mailbox: ResolvedActiveMailbox; accountIds: Set<string> }
  | { ok: false; code: EmailMailboxAccessErrorCode; userMessage: string };

const USER_MESSAGES: Record<EmailMailboxAccessErrorCode, string> = {
  EMAIL_PERMISSION_DENIED: "K modulu E-mail nemáte oprávnění.",
  EMAIL_MAILBOX_NOT_CONFIGURED: "Nemáte připojenou aktivní e-mailovou schránku.",
  EMAIL_MAILBOX_DISCONNECTED: "Vaše e-mailová schránka je momentálně odpojená.",
  EMAIL_PROVIDER_ERROR: "E-mailová schránka má problém s připojením. Zkuste synchronizaci v nastavení.",
};

export function emailAccessUserMessage(code: EmailMailboxAccessErrorCode): string {
  return USER_MESSAGES[code];
}

/** Výchozí osobní schránka přihlášeného uživatele (ne cizí / sdílené bez explicitního toolu). */
export async function resolveActiveMailboxForUser(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
}): Promise<ResolvedActiveMailbox | null> {
  const { db, organizationId, userId } = input;
  await ensureUserDefaultAccountMigrated(db, organizationId, userId);
  const accessible = await listEmailAccountsAccessibleToUser(db, organizationId, userId, "read");
  const owned = accessible.filter((a) => resolveAccountOwnerUserId(a) === userId);
  if (!owned.length) return null;

  const defaultId = pickDefaultAccountId(owned);
  const account = owned.find((a) => a.id === defaultId) ?? owned[0];
  if (!account) return null;

  return {
    mailboxId: account.id,
    provider: String(account.provider ?? "IMAP_SMTP"),
    emailAddress: String(account.email ?? ""),
    active: account.isActive !== false,
    connectionStatus: String(account.status ?? "unknown"),
  };
}

export async function getCurrentUserMailboxContext(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
  hasEmailPortalRead: boolean;
}): Promise<UserMailboxContext> {
  if (!input.hasEmailPortalRead) {
    return {
      ok: false,
      code: "EMAIL_PERMISSION_DENIED",
      userMessage: USER_MESSAGES.EMAIL_PERMISSION_DENIED,
    };
  }

  const mailbox = await resolveActiveMailboxForUser({
    db: input.db,
    organizationId: input.organizationId,
    userId: input.userId,
  });

  if (!mailbox) {
    return {
      ok: false,
      code: "EMAIL_MAILBOX_NOT_CONFIGURED",
      userMessage: USER_MESSAGES.EMAIL_MAILBOX_NOT_CONFIGURED,
    };
  }

  const accessible = await listEmailAccountsAccessibleToUser(
    input.db,
    input.organizationId,
    input.userId,
    "read"
  );
  const account = accessible.find((a) => a.id === mailbox.mailboxId);
  if (!account) {
    return {
      ok: false,
      code: "EMAIL_MAILBOX_NOT_CONFIGURED",
      userMessage: USER_MESSAGES.EMAIL_MAILBOX_NOT_CONFIGURED,
    };
  }

  if (!isEmailAccountSyncable(account)) {
    return {
      ok: false,
      code: "EMAIL_MAILBOX_DISCONNECTED",
      userMessage: USER_MESSAGES.EMAIL_MAILBOX_DISCONNECTED,
    };
  }

  if (account.lastError && !isEmailAccountConnected(account)) {
    return {
      ok: false,
      code: "EMAIL_PROVIDER_ERROR",
      userMessage: USER_MESSAGES.EMAIL_PROVIDER_ERROR,
    };
  }

  return {
    ok: true,
    mailbox: {
      ...mailbox,
      connectionStatus: String(account.status ?? mailbox.connectionStatus),
      active: account.isActive !== false,
    },
    accountIds: new Set([mailbox.mailboxId]),
  };
}

export type UserEmailDashboardSnapshot = {
  waitingForReply: number;
  overdue: number;
  urgent: number;
  unread: number;
  waitingSamples: Array<{
    messageId: string;
    subject: string;
    sender: string;
    receivedAt: string;
    waitingHours: number;
    threadId?: string;
  }>;
};

function senderShort(from: string | null | undefined): string {
  const s = String(from ?? "").trim();
  if (!s) return "—";
  const m = /<([^>]+)>/.exec(s);
  return (m?.[1] ?? s).slice(0, 120);
}

function receivedAtToMs(value: unknown): number {
  if (!value) return NaN;
  if (typeof value === "string") return Date.parse(value);
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return d.getTime();
  }
  return Date.parse(String(value));
}

function waitingHoursSince(receivedAt: unknown): number {
  const t = receivedAtToMs(receivedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 3_600_000));
}

/** Stejná logika pro dashboard widget, AI briefing a AI dotazy — aktivní schránka uživatele. */
export async function loadUserEmailDashboardSnapshot(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
  hasEmailPortalRead: boolean;
  messageLimit?: number;
}): Promise<
  | { ok: true; mailbox: ResolvedActiveMailbox; snapshot: UserEmailDashboardSnapshot }
  | { ok: false; context: UserMailboxContext & { ok: false } }
> {
  const ctx = await getCurrentUserMailboxContext({
    db: input.db,
    organizationId: input.organizationId,
    userId: input.userId,
    hasEmailPortalRead: input.hasEmailPortalRead,
  });
  if (!ctx.ok) {
    return { ok: false, context: ctx };
  }

  const limit = input.messageLimit ?? 200;
  const snap = await emailMessagesCol(input.db, input.organizationId)
    .orderBy("receivedAt", "desc")
    .limit(limit)
    .get();

  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as EmailMessageDoc) }))
    .filter((m) => messageVisibleToUser(m, input.userId, ctx.accountIds));

  const dash = computeDashboardEmailStats(rows, input.userId);
  let unread = 0;
  for (const m of rows) {
    if (!m.isRead && m.direction === "inbound" && !m.deleted && !m.isDraft) unread += 1;
  }

  const waitingSamples = rows
    .filter((m) => m.needsReply && !m.resolved && m.direction === "inbound" && !m.deleted)
    .slice(0, 8)
    .map((m) => ({
      messageId: m.id,
      subject: String(m.subject ?? "E-mail").slice(0, 160),
      sender: senderShort(m.from),
      receivedAt: receivedAtToMs(m.receivedAt)
        ? new Date(receivedAtToMs(m.receivedAt)).toISOString()
        : "",
      waitingHours: waitingHoursSince(m.receivedAt),
      threadId: m.threadId ? String(m.threadId) : undefined,
    }));

  return {
    ok: true,
    mailbox: ctx.mailbox,
    snapshot: {
      waitingForReply: dash.waitingReply,
      overdue: dash.overdue,
      urgent: dash.urgent,
      unread,
      waitingSamples,
    },
  };
}

export function pickPersonalOwnedAccounts(
  accounts: (EmailAccountDoc & { id: string })[],
  userId: string
): (EmailAccountDoc & { id: string })[] {
  return accounts.filter((a) => resolveAccountOwnerUserId(a) === userId);
}
