import { createHash, createHmac } from "crypto";

/** Stejná logika jako portal-api-sign.server.ts (bez importu server-only). */
function sha256HexUtf8(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function computePortalRequestSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: string
): string {
  const signedPayload = `${timestamp}.${nonce}.${sha256HexUtf8(rawBody)}`;
  return createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
}

const body = JSON.stringify({ organizationId: "org-1", moduleActive: true });
const secret = "test-secret-for-unit";
const timestamp = "1700000000000";
const nonce = "a".repeat(32);
const signature = computePortalRequestSignature(secret, timestamp, nonce, body);

const expectedPayload = `${timestamp}.${nonce}.${sha256HexUtf8(body)}`;
const manual = createHmac("sha256", secret).update(expectedPayload, "utf8").digest("hex");

if (signature !== manual || signature.length !== 64) {
  throw new Error("Portal HMAC spec mismatch");
}

/** Nesmí se podpisovat jen raw body (starý chybný algoritmus). */
const legacyWrong = createHmac("sha256", secret).update(body, "utf8").digest("hex");
if (signature === legacyWrong) {
  throw new Error("Signature must not equal legacy body-only HMAC");
}

console.log("[portal-api-sign.test] OK");
