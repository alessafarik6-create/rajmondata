import {
  decryptCredentialSecret,
  encryptCredentialSecret,
  isEmailCredentialsEncryptionConfigured,
} from "@/lib/email-mailbox/credential-crypto";

export function isHikvisionIntegrationEncryptionConfigured(): boolean {
  return isEmailCredentialsEncryptionConfigured();
}

export function encryptHikvisionSecret(plaintext: string): string {
  return encryptCredentialSecret(plaintext);
}

export function decryptHikvisionSecret(payload: string): string {
  return decryptCredentialSecret(payload);
}
