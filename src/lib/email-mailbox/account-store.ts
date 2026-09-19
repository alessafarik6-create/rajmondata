import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { encryptCredentialSecret } from "@/lib/email-mailbox/credential-crypto";
import { resolveEmailCredentials } from "@/lib/email-mailbox/credential-resolver";
import { normalizeMailboxEmail } from "@/lib/email-mailbox/account-default";
import {
  EMAIL_ACCOUNT_CREDENTIALS_DOC,
  EMAIL_ACCOUNTS_SUBCOLLECTION,
  type EmailAccountDoc,
  type EmailCredentialsPlain,
} from "@/lib/email-mailbox/types";

export function emailAccountsCol(db: Firestore, companyId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(companyId).collection(EMAIL_ACCOUNTS_SUBCOLLECTION);
}

export async function loadEmailAccount(
  db: Firestore,
  companyId: string,
  accountId: string
): Promise<(EmailAccountDoc & { id: string }) | null> {
  const snap = await emailAccountsCol(db, companyId).doc(accountId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as EmailAccountDoc) };
}

export async function loadEmailCredentials(
  db: Firestore,
  companyId: string,
  accountId: string
): Promise<EmailCredentialsPlain | null> {
  const resolved = await resolveEmailCredentials(db, companyId, accountId);
  return resolved.ok ? resolved.credentials : null;
}

export async function deleteEmailCredentials(
  db: Firestore,
  companyId: string,
  accountId: string
): Promise<void> {
  await emailAccountsCol(db, companyId)
    .doc(accountId)
    .collection("private")
    .doc(EMAIL_ACCOUNT_CREDENTIALS_DOC)
    .delete();
}

export async function saveEmailCredentials(
  db: Firestore,
  companyId: string,
  accountId: string,
  credentials: EmailCredentialsPlain
): Promise<void> {
  await emailAccountsCol(db, companyId)
    .doc(accountId)
    .collection("private")
    .doc(EMAIL_ACCOUNT_CREDENTIALS_DOC)
    .set({
      encryptedPassword: encryptCredentialSecret(credentials.password),
      encryptedUsername: encryptCredentialSecret(credentials.username),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function findActivePersonalAccountByNormalizedEmail(
  db: Firestore,
  companyId: string,
  userId: string,
  normalizedEmail: string
): Promise<(EmailAccountDoc & { id: string }) | null> {
  const snap = await emailAccountsCol(db, companyId)
    .where("userId", "==", userId)
    .where("normalizedEmail", "==", normalizedEmail)
    .limit(5)
    .get()
    .catch(async () => emailAccountsCol(db, companyId).where("userId", "==", userId).limit(50).get());

  for (const d of snap.docs) {
    const row = d.data() as EmailAccountDoc;
    if (row.accountType === "SHARED") continue;
    if (row.isActive === false || row.status === "disconnected") continue;
    const ne = row.normalizedEmail ?? normalizeMailboxEmail(row.email);
    if (ne === normalizedEmail) return { id: d.id, ...row };
  }
  return null;
}

/** Všechny účty organizace (pouze server — admin status / cron). */
export async function listEmailAccounts(
  db: Firestore,
  companyId: string
): Promise<(EmailAccountDoc & { id: string })[]> {
  try {
    const snap = await emailAccountsCol(db, companyId).orderBy("createdAt", "desc").get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as EmailAccountDoc) }));
  } catch {
    const snap = await emailAccountsCol(db, companyId).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as EmailAccountDoc) }));
    rows.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
    return rows;
  }
}
