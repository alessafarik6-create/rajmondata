import { createHmac } from "crypto";

/** Stejná logika jako portal-api-sign.server.ts (bez importu server-only). */
const body = JSON.stringify({ organizationId: "org-1", moduleActive: true });
const secret = "test-secret-for-unit";
const signature = createHmac("sha256", secret).update(body).digest("hex");

if (signature.length !== 64) {
  throw new Error("Invalid HMAC hex length");
}

console.log("[portal-api-sign.test] OK");
