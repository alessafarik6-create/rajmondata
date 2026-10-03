import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { fleetIntegrationRef } from "@/lib/fleet/stores";
import {
  decryptSatelitniSecret,
  encryptSatelitniSecret,
  isSatelitniEncryptionConfigured,
} from "@/lib/integrations/satelitni-sledovani/crypto";

export const SATELITNI_OAUTH_TOKENS_DOC = "satelitni_oauth_tokens";
export const SATELITNI_OAUTH_PENDING_COLLECTION = "satelitni_oauth_pending";

export type SatelitniOAuthTokensDoc = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: Timestamp;
  updatedAt?: Timestamp;
};

export type SatelitniOAuthPendingDoc = {
  organizationId: string;
  userId: string;
  codeVerifier: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

function privateRef(db: Firestore, organizationId: string) {
  return fleetIntegrationRef(db, organizationId).collection("private");
}

export async function saveSatelitniOAuthTokens(
  db: Firestore,
  organizationId: string,
  input: { accessToken: string; refreshToken: string; expiresInSec: number }
): Promise<void> {
  if (!isSatelitniEncryptionConfigured()) {
    throw new Error("Chybí šifrovací klíč pro OAuth tokeny.");
  }
  const expiresAt = Timestamp.fromMillis(Date.now() + Math.max(60, input.expiresInSec) * 1000);
  await privateRef(db, organizationId).doc(SATELITNI_OAUTH_TOKENS_DOC).set({
    accessTokenEncrypted: encryptSatelitniSecret(input.accessToken),
    refreshTokenEncrypted: encryptSatelitniSecret(input.refreshToken),
    expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function loadSatelitniOAuthTokens(
  db: Firestore,
  organizationId: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date } | null> {
  const snap = await privateRef(db, organizationId).doc(SATELITNI_OAUTH_TOKENS_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() as SatelitniOAuthTokensDoc;
  try {
    return {
      accessToken: decryptSatelitniSecret(data.accessTokenEncrypted),
      refreshToken: decryptSatelitniSecret(data.refreshTokenEncrypted),
      expiresAt: data.expiresAt.toDate(),
    };
  } catch {
    return null;
  }
}

export async function clearSatelitniOAuthTokens(db: Firestore, organizationId: string): Promise<void> {
  await privateRef(db, organizationId).doc(SATELITNI_OAUTH_TOKENS_DOC).delete().catch(() => undefined);
}

export async function saveOAuthPending(
  db: Firestore,
  organizationId: string,
  state: string,
  input: { userId: string; codeVerifier: string }
): Promise<void> {
  const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
  await fleetIntegrationRef(db, organizationId)
    .collection(SATELITNI_OAUTH_PENDING_COLLECTION)
    .doc(state)
    .set({
      organizationId,
      userId: input.userId,
      codeVerifier: input.codeVerifier,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
}

export async function consumeOAuthPending(
  db: Firestore,
  organizationId: string,
  state: string
): Promise<{ codeVerifier: string; userId: string } | null> {
  const ref = fleetIntegrationRef(db, organizationId)
    .collection(SATELITNI_OAUTH_PENDING_COLLECTION)
    .doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as SatelitniOAuthPendingDoc;
  await ref.delete().catch(() => undefined);
  if (data.expiresAt.toMillis() < Date.now()) return null;
  if (data.organizationId !== organizationId) return null;
  return { codeVerifier: data.codeVerifier, userId: data.userId };
}
