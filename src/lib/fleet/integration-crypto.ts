import {
  decryptCredentialSecret,
  encryptCredentialSecret,
  isEmailCredentialsEncryptionConfigured,
} from "@/lib/email-mailbox/credential-crypto";

/** Sdílený šifrovací klíč integrací (fallback na EMAIL_CREDENTIALS_ENCRYPTION_KEY). */
export function isFleetIntegrationEncryptionConfigured(): boolean {
  return isEmailCredentialsEncryptionConfigured();
}

export function encryptFleetSecret(plaintext: string): string {
  return encryptCredentialSecret(plaintext);
}

export function decryptFleetSecret(payload: string): string {
  return decryptCredentialSecret(payload);
}
