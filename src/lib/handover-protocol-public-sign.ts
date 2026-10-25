import { randomBytes } from "crypto";

/** Globální kolekce — dokument ID = token (server-side only). */
export const HANDOVER_PUBLIC_SIGN_TOKENS = "handoverPublicSignTokens";

/** 14 dní */
export const HANDOVER_SIGN_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function generateHandoverPublicSignToken(): string {
  return randomBytes(32).toString("base64url");
}

export function handoverPublicSignUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/predavaci-protokol/${encodeURIComponent(token)}`;
}
