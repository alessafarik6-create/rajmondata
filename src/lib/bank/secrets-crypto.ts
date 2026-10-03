import {
  decryptCredentialSecret,
  encryptCredentialSecret,
  isEmailCredentialsEncryptionConfigured,
} from "@/lib/email-mailbox/credential-crypto";

export function isBankSecretsEncryptionConfigured(): boolean {
  return isEmailCredentialsEncryptionConfigured();
}

export function encryptBankSecret(plaintext: string): string {
  return encryptCredentialSecret(plaintext);
}

export function decryptBankSecret(payload: string): string {
  return decryptCredentialSecret(payload);
}

export function encryptBankCertificateP12(p12: Buffer): string {
  return encryptBankSecret(p12.toString("base64"));
}

export function decryptBankCertificateP12(payload: string): Buffer {
  return Buffer.from(decryptBankSecret(payload), "base64");
}

export function maskClientId(clientId: string): string {
  const s = String(clientId ?? "").trim();
  if (s.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}
