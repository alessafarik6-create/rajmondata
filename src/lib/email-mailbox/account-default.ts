import type { EmailAccountDoc } from "@/lib/email-mailbox/types";

export const EMAIL_ACCOUNT_ALL_MAILBOXES = "__all__";

export function normalizeMailboxEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export function isEmailAccountSyncable(account: Pick<EmailAccountDoc, "status" | "isActive">): boolean {
  if (account.isActive === false) return false;
  return account.status !== "disconnected";
}

export function isEmailAccountConnected(account: Pick<EmailAccountDoc, "status" | "isActive">): boolean {
  return isEmailAccountSyncable(account) && account.status === "connected";
}

/** Zajistí jediný výchozí účet — vrátí patch pro ostatní účty (isDefault false). */
export function applySingleDefaultChoice(
  accounts: (EmailAccountDoc & { id: string })[],
  defaultAccountId: string,
  ownerUserId: string
): { defaultId: string; othersClearDefault: string[] } {
  const owned = accounts.filter((a) => String(a.userId ?? a.createdByUserId ?? "") === ownerUserId);
  const exists = owned.some((a) => a.id === defaultAccountId);
  if (!exists) {
    const fallback = owned.find((a) => isEmailAccountSyncable(a))?.id ?? owned[0]?.id ?? defaultAccountId;
    return {
      defaultId: fallback,
      othersClearDefault: owned.filter((a) => a.id !== fallback).map((a) => a.id),
    };
  }
  return {
    defaultId: defaultAccountId,
    othersClearDefault: owned.filter((a) => a.id !== defaultAccountId).map((a) => a.id),
  };
}

export function pickDefaultAccountId(
  accounts: (EmailAccountDoc & { id: string })[]
): string | null {
  const active = accounts.filter((a) => isEmailAccountSyncable(a));
  const explicit = active.find((a) => a.isDefault === true);
  if (explicit) return explicit.id;
  const connected = active.find((a) => a.status === "connected");
  if (connected) return connected.id;
  return active[0]?.id ?? accounts[0]?.id ?? null;
}
