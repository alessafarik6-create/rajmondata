import "server-only";

import { createHmac, randomBytes } from "crypto";

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

/** Serializace JSON pro podpis — stabilní pořadí klíčů na úrovni volajícího objektu. */
export function serializePortalJsonBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
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
  const signature = createHmac("sha256", secret).update(body).digest("hex");
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
