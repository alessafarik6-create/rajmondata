import crypto from "node:crypto";
import {
  decryptCredentialSecret,
  encryptCredentialSecret,
  isEmailCredentialsEncryptionConfigured,
} from "@/lib/email-mailbox/credential-crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function dedicatedKey(): Buffer | null {
  const raw = String(process.env.SATELITNI_SLEDOVANI_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, raw.length === 64 && /^[0-9a-f]+$/i.test(raw) ? "hex" : "base64");
  return buf.length === 32 ? buf : null;
}

export function isSatelitniEncryptionConfigured(): boolean {
  return Boolean(dedicatedKey()) || isEmailCredentialsEncryptionConfigured();
}

export function encryptSatelitniSecret(plaintext: string): string {
  const key = dedicatedKey();
  if (!key) return encryptCredentialSecret(plaintext);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSatelitniSecret(payload: string): string {
  const key = dedicatedKey();
  if (!key) return decryptCredentialSecret(payload);
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
