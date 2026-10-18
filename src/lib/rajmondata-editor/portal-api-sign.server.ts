import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const PORTAL_TIMESTAMP_HEADER = "X-Portal-Timestamp";
export const PORTAL_NONCE_HEADER = "X-Portal-Nonce";
export const PORTAL_SIGNATURE_HEADER = "X-Portal-Signature";

export function getPortalApiSecret(): string {
  return (
    process.env.PORTAL_API_SECRET?.trim() ||
    process.env.RAJMONDATA_EDITOR_INTEGRATION_SECRET?.trim() ||
    ""
  );
}

/** SHA-256 těla requestu (UTF-8) — hex, malá písmena. */
export function sha256HexUtf8(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Podpis dle smlouvy editoru:
 * HMAC-SHA256(secret, timestamp + "." + nonce + "." + SHA256(rawBody))
 */
export function computePortalRequestSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: string
): string {
  const signedPayload = `${timestamp}.${nonce}.${sha256HexUtf8(rawBody)}`;
  return createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
}

/** Serializace JSON pro podpis — stejný string musí jít do fetch body i do podpisu. */
export function serializePortalJsonBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function signaturesEqual(expected: string, given: string): boolean {
  const a = expected.trim().toLowerCase();
  const b = given.trim().toLowerCase();
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Ověření HMAC od editoru (server → portál). */
export function verifyPortalInboundSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader?: string | null,
  nonceHeader?: string | null
): boolean {
  const secret = getPortalApiSecret();
  if (!secret || !signatureHeader?.trim()) return false;

  const timestamp = timestampHeader?.trim() ?? "";
  const nonce = nonceHeader?.trim() ?? "";
  if (timestamp && nonce) {
    const expected = computePortalRequestSignature(secret, timestamp, nonce, rawBody);
    if (signaturesEqual(expected, signatureHeader)) return true;
  }

  /** @deprecated starý formát — pouze pro příchozí volání bez timestamp/nonce */
  const legacyExpected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return signaturesEqual(legacyExpected, signatureHeader);
}

export function isEditorIntegrationAuthorized(
  authorizationHeader: string | null,
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader?: string | null,
  nonceHeader?: string | null
): boolean {
  const secret = getPortalApiSecret();
  if (!secret) return false;
  const auth = authorizationHeader ?? "";
  if (auth === `Bearer ${secret}`) return true;
  return verifyPortalInboundSignature(rawBody, signatureHeader, timestampHeader, nonceHeader);
}

export function signPortalJsonBody(body: string): {
  timestamp: string;
  nonce: string;
  signature: string;
  headers: Record<string, string>;
} {
  const secret = getPortalApiSecret();
  if (!secret) {
    throw new Error("PORTAL_API_SECRET není nastaveno.");
  }
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = computePortalRequestSignature(secret, timestamp, nonce, body);
  return {
    timestamp,
    nonce,
    signature,
    headers: {
      "Content-Type": "application/json",
      [PORTAL_TIMESTAMP_HEADER]: timestamp,
      [PORTAL_NONCE_HEADER]: nonce,
      [PORTAL_SIGNATURE_HEADER]: signature,
    },
  };
}
