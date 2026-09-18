import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  decryptCredentialSecret,
  encryptCredentialSecret,
} from "@/lib/email-mailbox/credential-crypto";
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
  const snap = await emailAccountsCol(db, companyId)
    .doc(accountId)
    .collection("private")
    .doc(EMAIL_ACCOUNT_CREDENTIALS_DOC)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as { encryptedPassword?: string; encryptedUsername?: string };
  if (!data.encryptedPassword) return null;
  const account = await loadEmailAccount(db, companyId, accountId);
  if (!account) return null;
  const password = decryptCredentialSecret(data.encryptedPassword);
  const username = data.encryptedUsername
    ? decryptCredentialSecret(data.encryptedUsername)
    : account.email;
  return { username, password };
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

export async function listEmailAccounts(
  db: Firestore,
  companyId: string
): Promise<(EmailAccountDoc & { id: string })[]> {
  const snap = await emailAccountsCol(db, companyId).orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as EmailAccountDoc) }));
}
