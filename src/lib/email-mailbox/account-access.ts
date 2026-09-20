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
import {
  applySingleDefaultChoice,
  isEmailAccountSyncable,
  normalizeMailboxEmail,
  pickDefaultAccountId,
} from "@/lib/email-mailbox/account-default";

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
  const needsNorm = !account.normalizedEmail && account.email;
  const needsActive = account.isActive == null;
  if (!needsUserId && !needsType && !needsNorm && !needsActive) return account;

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (needsUserId) patch.userId = owner;
  if (needsType) patch.accountType = "PERSONAL";
  if (needsNorm) patch.normalizedEmail = normalizeMailboxEmail(account.email);
  if (needsActive) patch.isActive = account.status !== "disconnected";

  await emailAccountsCol(db, companyId).doc(account.id).update(patch).catch(() => undefined);
  return {
    ...account,
    userId: needsUserId ? owner : account.userId,
    accountType: needsType ? "PERSONAL" : account.accountType,
    normalizedEmail: needsNorm ? normalizeMailboxEmail(account.email) : account.normalizedEmail,
    isActive: needsActive ? account.status !== "disconnected" : account.isActive,
  };
}

/** Po migraci legacy: jeden isDefault na uživatele (první aktivní / connected). */
export async function ensureUserDefaultAccountMigrated(
  db: Firestore,
  companyId: string,
  callerUid: string
): Promise<void> {
  const rows = await listEmailAccountsAccessibleToUser(db, companyId, callerUid, "read");
  const owned = rows.filter((a) => resolveAccountOwnerUserId(a) === callerUid);
  if (!owned.length) return;
  const hasDefault = owned.some((a) => a.isDefault === true);
  if (hasDefault) return;
  const defaultId = pickDefaultAccountId(owned);
  if (!defaultId) return;
  const { defaultId: did, othersClearDefault } = applySingleDefaultChoice(owned, defaultId, callerUid);
  await emailAccountsCol(db, companyId).doc(did).update({
    isDefault: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  for (const oid of othersClearDefault) {
    await emailAccountsCol(db, companyId)
      .doc(oid)
      .update({ isDefault: false, updatedAt: FieldValue.serverTimestamp() })
      .catch(() => undefined);
  }
}

export async function disconnectEmailAccountSoft(
  db: Firestore,
  companyId: string,
  accountId: string,
  callerUid: string
): Promise<{ ok: true } | { ok: false; status: number; error: string; errorCode?: string }> {
  const access = await assertEmailAccountAccess(db, companyId, accountId, callerUid, "manage");
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error, errorCode: access.errorCode };
  }
  const { deleteEmailCredentials } = await import("@/lib/email-mailbox/account-store");
  await deleteEmailCredentials(db, companyId, accountId);
  await emailAccountsCol(db, companyId).doc(accountId).update({
    status: "disconnected",
    isActive: false,
    isDefault: false,
    lastError: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const remaining = (
    await listEmailAccountsAccessibleToUser(db, companyId, callerUid, "read")
  ).filter((a) => a.id !== accountId && resolveAccountOwnerUserId(a) === callerUid && isEmailAccountSyncable(a));
  if (remaining.length) {
    const nextDefault = pickDefaultAccountId(remaining);
    if (nextDefault) {
      await setDefaultEmailAccountForUser(db, companyId, callerUid, nextDefault);
    }
  }
  return { ok: true };
}

export async function setDefaultEmailAccountForUser(
  db: Firestore,
  companyId: string,
  callerUid: string,
  accountId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await assertEmailAccountAccess(db, companyId, accountId, callerUid, "write");
  if (!access.ok) return { ok: false, error: access.error };
  if (!isEmailAccountSyncable(access.account)) {
    return { ok: false, error: "Odpojený účet nelze nastavit jako výchozí." };
  }
  const all = await listEmailAccountsAccessibleToUser(db, companyId, callerUid, "read");
  const owned = all.filter((a) => resolveAccountOwnerUserId(a) === callerUid);
  const { defaultId, othersClearDefault } = applySingleDefaultChoice(owned, accountId, callerUid);
  await emailAccountsCol(db, companyId).doc(defaultId).update({
    isDefault: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  for (const oid of othersClearDefault) {
    await emailAccountsCol(db, companyId).doc(oid).update({
      isDefault: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return { ok: true };
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

export { messageBelongsToUser, messageVisibleToUser } from "@/lib/email-mailbox/message-access";

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
  const accessibleIds = await loadAccessibleAccountIdSet(db, companyId, callerUid);
  const { messageVisibleToUser } = await import("@/lib/email-mailbox/message-access");
  if (!messageVisibleToUser(message, callerUid, accessibleIds)) {
    return {
      ok: false,
      status: 403,
      error: "Nemáte přístup k této zprávě.",
      errorCode: "MESSAGE_FORBIDDEN",
    };
  }
  if (mode !== "read") {
    const accountCheck = await assertEmailAccountAccess(
      db,
      companyId,
      message.emailAccountId,
      callerUid,
      mode
    );
    if (!accountCheck.ok && message.assignedToUserId !== callerUid) {
      return {
        ok: false,
        status: accountCheck.status,
        error: accountCheck.error,
        errorCode: accountCheck.errorCode,
      };
    }
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
