import type { Firestore } from "firebase-admin/firestore";
import {
  loadSatelitniOAuthTokens,
  saveSatelitniOAuthTokens,
} from "@/lib/integrations/satelitni-sledovani/store";
import { refreshSatelitniTokens } from "@/lib/integrations/satelitni-sledovani/oauth";

const refreshLocks = new Map<string, Promise<string>>();

const REFRESH_SKEW_MS = 120_000;

export async function getSatelitniSledovaniAccessToken(
  db: Firestore,
  organizationId: string
): Promise<string> {
  const existing = refreshLocks.get(organizationId);
  if (existing) return existing;

  const job = getSatelitniSledovaniAccessTokenInternal(db, organizationId);
  refreshLocks.set(organizationId, job);
  try {
    return await job;
  } finally {
    refreshLocks.delete(organizationId);
  }
}

async function getSatelitniSledovaniAccessTokenInternal(
  db: Firestore,
  organizationId: string
): Promise<string> {
  const tokens = await loadSatelitniOAuthTokens(db, organizationId);
  if (!tokens) {
    throw new Error("SatelitníSledování.cz není připojeno.");
  }
  const now = Date.now();
  if (tokens.expiresAt.getTime() - now > REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }
  const refreshed = await refreshSatelitniTokens(tokens.refreshToken);
  await saveSatelitniOAuthTokens(db, organizationId, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresInSec: refreshed.expiresIn,
  });
  return refreshed.accessToken;
}
