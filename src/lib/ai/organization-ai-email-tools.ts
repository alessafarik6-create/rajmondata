import type { Firestore } from "firebase-admin/firestore";
import { loadUserEmailDashboardSnapshot } from "@/lib/email-mailbox/user-mailbox-context";

/** User-scoped e-mail data pro AI — vždy aktivní schránka přihlášeného uživatele. */
export async function getUnreadEmailsForUser(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
  hasEmailPortalRead: boolean;
}) {
  const loaded = await loadUserEmailDashboardSnapshot({ ...input, messageLimit: 120 });
  if (!loaded.ok) return loaded;
  return {
    ok: true as const,
    mailboxId: loaded.mailbox.mailboxId,
    unread: loaded.snapshot.unread,
  };
}

export async function getEmailsWaitingForReplyForUser(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
  hasEmailPortalRead: boolean;
}) {
  const loaded = await loadUserEmailDashboardSnapshot({ ...input, messageLimit: 200 });
  if (!loaded.ok) return loaded;
  return {
    ok: true as const,
    mailboxId: loaded.mailbox.mailboxId,
    count: loaded.snapshot.waitingForReply,
    samples: loaded.snapshot.waitingSamples,
  };
}

export async function getOverdueEmailsForUser(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
  hasEmailPortalRead: boolean;
}) {
  const loaded = await loadUserEmailDashboardSnapshot({ ...input, messageLimit: 200 });
  if (!loaded.ok) return loaded;
  return {
    ok: true as const,
    mailboxId: loaded.mailbox.mailboxId,
    count: loaded.snapshot.overdue,
  };
}
