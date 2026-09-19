import type { Firestore } from "firebase-admin/firestore";
import {
  decryptCredentialSecret,
  isEmailCredentialsEncryptionConfigured,
} from "@/lib/email-mailbox/credential-crypto";
import { logEmailPhase } from "@/lib/email-mailbox/email-log";
import {
  EMAIL_ACCOUNT_CREDENTIALS_DOC,
  type EmailCredentialsPlain,
} from "@/lib/email-mailbox/types";
import { emailAccountsCol, loadEmailAccount } from "@/lib/email-mailbox/account-store";

/** Název ENV proměnné ve Vercel / .env — 32 bajtů (base64 nebo hex). */
export const EMAIL_CREDENTIALS_ENCRYPTION_KEY_ENV = "EMAIL_CREDENTIALS_ENCRYPTION_KEY";

export type EmailCredentialErrorCode =
  | "EMAIL_ENCRYPTION_KEY_MISSING"
  | "EMAIL_CREDENTIAL_MISSING"
  | "EMAIL_CREDENTIAL_DECRYPT_FAILED"
  | "ACCOUNT_NOT_FOUND";

export type EmailCredentialResolveResult =
  | { ok: true; credentials: EmailCredentialsPlain }
  | { ok: false; errorCode: EmailCredentialErrorCode; message: string };

export function messageForCredentialError(code: EmailCredentialErrorCode): string {
  switch (code) {
    case "EMAIL_ENCRYPTION_KEY_MISSING":
      return "Server nemá nastaven šifrovací klíč pro e-mailové účty. Kontaktujte správce.";
    case "EMAIL_CREDENTIAL_MISSING":
      return "Chybí uložené přihlašovací údaje. Zadejte heslo schránky znovu v nastavení.";
    case "EMAIL_CREDENTIAL_DECRYPT_FAILED":
      return "Přihlašovací údaje e-mailového účtu je potřeba zadat znovu.";
    case "ACCOUNT_NOT_FOUND":
      return "E-mailový účet nebyl nalezen.";
    default:
      return "Nelze načíst přihlašovací údaje.";
  }
}

export async function resolveEmailCredentials(
  db: Firestore,
  companyId: string,
  accountId: string
): Promise<EmailCredentialResolveResult> {
  if (!isEmailCredentialsEncryptionConfigured()) {
    logEmailPhase("EMAIL_ENCRYPTION_KEY_MISSING", { companyId, accountId });
    return {
      ok: false,
      errorCode: "EMAIL_ENCRYPTION_KEY_MISSING",
      message: messageForCredentialError("EMAIL_ENCRYPTION_KEY_MISSING"),
    };
  }

  const account = await loadEmailAccount(db, companyId, accountId);
  if (!account) {
    logEmailPhase("EMAIL_CREDENTIAL_MISSING", { reason: "account_not_found", accountId });
    return {
      ok: false,
      errorCode: "ACCOUNT_NOT_FOUND",
      message: messageForCredentialError("ACCOUNT_NOT_FOUND"),
    };
  }

  logEmailPhase("EMAIL_ACCOUNT_FOUND", { accountId, email: account.email });

  const credSnap = await emailAccountsCol(db, companyId)
    .doc(accountId)
    .collection("private")
    .doc(EMAIL_ACCOUNT_CREDENTIALS_DOC)
    .get();

  if (!credSnap.exists) {
    logEmailPhase("EMAIL_CREDENTIAL_MISSING", { accountId, reason: "no_private_doc" });
    return {
      ok: false,
      errorCode: "EMAIL_CREDENTIAL_MISSING",
      message: messageForCredentialError("EMAIL_CREDENTIAL_MISSING"),
    };
  }

  const data = credSnap.data() as { encryptedPassword?: string; encryptedUsername?: string };
  if (!data.encryptedPassword?.trim()) {
    logEmailPhase("EMAIL_CREDENTIAL_MISSING", { accountId, reason: "no_encrypted_password" });
    return {
      ok: false,
      errorCode: "EMAIL_CREDENTIAL_MISSING",
      message: messageForCredentialError("EMAIL_CREDENTIAL_MISSING"),
    };
  }

  logEmailPhase("EMAIL_CREDENTIAL_FOUND", { accountId });

  try {
    const password = decryptCredentialSecret(data.encryptedPassword);
    const username = data.encryptedUsername?.trim()
      ? decryptCredentialSecret(data.encryptedUsername)
      : account.email;
    logEmailPhase("EMAIL_CREDENTIAL_DECRYPT_OK", { accountId });
    return { ok: true, credentials: { username, password } };
  } catch {
    logEmailPhase("EMAIL_CREDENTIAL_DECRYPT_FAILED", { accountId });
    return {
      ok: false,
      errorCode: "EMAIL_CREDENTIAL_DECRYPT_FAILED",
      message: messageForCredentialError("EMAIL_CREDENTIAL_DECRYPT_FAILED"),
    };
  }
}

/** Status pro UI — nepředpokládej „Připojeno“, pokud credentials nejsou použitelné. */
export function accountStatusFromCredentialResult(
  storedStatus: string,
  cred: EmailCredentialResolveResult
): string {
  if (!cred.ok) {
    switch (cred.errorCode) {
      case "EMAIL_ENCRYPTION_KEY_MISSING":
        return "attention";
      case "EMAIL_CREDENTIAL_MISSING":
        return "credentials_missing";
      case "EMAIL_CREDENTIAL_DECRYPT_FAILED":
        return "credentials_decrypt_failed";
      default:
        return "error";
    }
  }
  if (storedStatus === "syncing") return "syncing";
  if (storedStatus === "error") return "error";
  return "connected";
}

export function accountStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Připojeno";
    case "syncing":
      return "Synchronizuje se";
    case "credentials_missing":
      return "Chybí credentials";
    case "credentials_decrypt_failed":
      return "Credentials nelze dešifrovat";
    case "attention":
      return "Vyžaduje pozornost";
    case "error":
      return "Chyba přihlášení";
    default:
      return status;
  }
}
