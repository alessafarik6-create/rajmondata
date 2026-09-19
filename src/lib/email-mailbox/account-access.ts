import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  emailAccountsCol,
  listEmailAccounts,
  loadEmailAccount,
} from "@/lib/email-mailbox/account-store";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import type {
  EmailAccountDoc,
  EmailAccountType,
  EmailMailboxMemberPermission,
  EmailMessageDoc,
} from "@/lib/email-mailbox/types";
import { EMAIL_MAILBOX_MEMBERS_SUBCOLLECTION } from "@/lib/email-mailbox/types";

export type MailboxAccessMode = "read" | "write" | "manage";

export function resolveAccountOwnerUserId(account: EmailAccountDoc): string {
  return String(account.userId ?? account.createdByUserId ?? "").trim();
}

export function resolveAccountType(account: EmailAccountDoc): EmailAccountType {
  return account.accountType === "SHARED" ? "SHARED" : "PERSONAL";
}

/** Migrace starých org-wide účtů: userId ← createdByUserId, typ PERSONAL. */
export async function migrateLegacyEmailAccountIfNeeded(
  db: Firestore,
  companyId: string,
  account: EmailAccountDoc & { id: string }
): Promise<EmailAccountDoc & { id: string }> {
  const owner = resolveAccountOwnerUserId(account);
  const needsUserId = !account.userId && Boolean(owner);
  const needsType = !account.accountType;
  if (!needsUserId && !needsType) return account;

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (needsUserId) patch.userId = owner;
  if (needsType) patch.accountType = "PERSONAL";

  await emailAccountsCol(db, companyId).doc(account.id).update(patch).catch(() => undefined);
  return {
    ...account,
    userId: needsUserId ? owner : account.userId,
    accountType: needsType ? "PERSONAL" : account.accountType,
  };
}

async function loadSharedMailboxPermission(
  db: Firestore,
  companyId: string,
  accountId: string,
  callerUid: string
): Promise<EmailMailboxMemberPermission | null> {
  const snap = await emailAccountsCol(db, companyId)
    .doc(accountId)
    .collection(EMAIL_MAILBOX_MEMBERS_SUBCOLLECTION)
    .doc(callerUid)
    .get();
  if (!snap.exists) return null;
  const perm = (snap.data() as { permission?: string })?.permission;
  return perm === "WRITE" ? "WRITE" : perm === "READ" ? "READ" : null;
}

export async function userCanAccessEmailAccount(
  db: Firestore,
  companyId: string,
  account: EmailAccountDoc & { id: string },
  callerUid: string,
  mode: MailboxAccessMode
): Promise<boolean> {
  const migrated = await migrateLegacyEmailAccountIfNeeded(db, companyId, account);
  const owner = resolveAccountOwnerUserId(migrated);
  const type = resolveAccountType(migrated);

  if (type === "PERSONAL") {
    if (!owner) return false;
    return owner === callerUid;
  }

  if (owner === callerUid) return true;
  const memberPerm = await loadSharedMailboxPermission(db, companyId, migrated.id, callerUid);
  if (!memberPerm) return false;
  if (mode === "read") return memberPerm === "READ" || memberPerm === "WRITE";
  if (mode === "write") return memberPerm === "WRITE";
  return false;
}

export async function assertEmailAccountAccess(
  db: Firestore,
  companyId: string,
  accountId: string,
  callerUid: string,
  mode: MailboxAccessMode
): Promise<
  | { ok: true; account: EmailAccountDoc & { id: string } }
  | { ok: false; status: number; error: string; errorCode: string }
> {
  const raw = await loadEmailAccount(db, companyId, accountId);
  if (!raw) {
    return { ok: false, status: 404, error: "Účet nenalezen.", errorCode: "ACCOUNT_NOT_FOUND" };
  }
  const account = await migrateLegacyEmailAccountIfNeeded(db, companyId, raw);
  const allowed = await userCanAccessEmailAccount(db, companyId, account, callerUid, mode);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: "Nemáte přístup k této e-mailové schránce.",
      errorCode: "MAILBOX_FORBIDDEN",
    };
  }
  return { ok: true, account };
}

export async function listEmailAccountsAccessibleToUser(
  db: Firestore,
  companyId: string,
  callerUid: string,
  mode: MailboxAccessMode = "read"
): Promise<(EmailAccountDoc & { id: string })[]> {
  const all = await listEmailAccounts(db, companyId);
  const out: (EmailAccountDoc & { id: string })[] = [];
  for (const row of all) {
    const migrated = await migrateLegacyEmailAccountIfNeeded(db, companyId, row);
    if (await userCanAccessEmailAccount(db, companyId, migrated, callerUid, mode)) {
      out.push(migrated);
    }
  }
  return out;
}

export async function loadAccessibleAccountIdSet(
  db: Firestore,
  companyId: string,
  callerUid: string
): Promise<Set<string>> {
  const rows = await listEmailAccountsAccessibleToUser(db, companyId, callerUid, "read");
  return new Set(rows.map((r) => r.id));
}

/** Zpráva je viditelná, pokud patří ke schránce, ke které má uživatel přístup. */
export function messageBelongsToUser(
  message: EmailMessageDoc,
  _callerUid: string,
  accessibleAccountIds: Set<string>
): boolean {
  return accessibleAccountIds.has(message.emailAccountId);
}

export async function assertMessageAccess(
  db: Firestore,
  companyId: string,
  messageId: string,
  callerUid: string,
  mode: MailboxAccessMode
): Promise<
  | { ok: true; message: EmailMessageDoc & { id: string } }
  | { ok: false; status: number; error: string; errorCode?: string }
> {
  const snap = await emailMessagesCol(db, companyId).doc(messageId).get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Zpráva nenalezena.", errorCode: "MESSAGE_NOT_FOUND" };
  }
  const message = { id: snap.id, ...(snap.data() as EmailMessageDoc) };
  const accountCheck = await assertEmailAccountAccess(
    db,
    companyId,
    message.emailAccountId,
    callerUid,
    mode
  );
  if (!accountCheck.ok) {
    return { ok: false, status: accountCheck.status, error: accountCheck.error, errorCode: accountCheck.errorCode };
  }
  return { ok: true, message };
}

/** Pro unit testy — čistá logika bez Firestore. */
export function personalMailboxVisibleToOwnerOnly(
  account: Pick<EmailAccountDoc, "userId" | "createdByUserId" | "accountType">,
  callerUid: string
): boolean {
  if (resolveAccountType(account as EmailAccountDoc) !== "PERSONAL") return false;
  return resolveAccountOwnerUserId(account as EmailAccountDoc) === callerUid;
}

export function sharedMailboxAllows(
  memberPermission: EmailMailboxMemberPermission | null,
  mode: MailboxAccessMode
): boolean {
  if (!memberPermission) return false;
  if (mode === "read") return true;
  return memberPermission === "WRITE";
}
