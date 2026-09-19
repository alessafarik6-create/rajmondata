import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

export function isEmailCredentialsEncryptionConfigured(): boolean {
  const raw = String(process.env.EMAIL_CREDENTIALS_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return false;
  try {
    const buf = Buffer.from(raw, raw.length === 64 && /^[0-9a-f]+$/i.test(raw) ? "hex" : "base64");
    return buf.length === 32;
  } catch {
    return false;
  }
}

function getKey(): Buffer {
  const raw = String(process.env.EMAIL_CREDENTIALS_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("EMAIL_CREDENTIALS_ENCRYPTION_KEY není nastaven.");
  }
  const buf = Buffer.from(raw, raw.length === 64 && /^[0-9a-f]+$/i.test(raw) ? "hex" : "base64");
  if (buf.length !== 32) {
    throw new Error("EMAIL_CREDENTIALS_ENCRYPTION_KEY musí být 32 bajtů (base64 nebo hex).");
  }
  return buf;
}

export function encryptCredentialSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptCredentialSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + 16 + 1) {
    throw new Error("Neplatný šifrovaný payload.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
