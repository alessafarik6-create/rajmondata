import crypto from "node:crypto";

export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function generatePkceCodeVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function pkceCodeChallengeS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
