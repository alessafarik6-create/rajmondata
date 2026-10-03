import { randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

const PENDING_COLLECTION = "aiSecretaryPending";
const TTL_MS = 15 * 60 * 1000;

export type PendingSecretaryAction = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  summary: string;
  requiresConfirmation: true;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  userId: string;
};

const CONFIRM_RE =
  /\b(ano|jo|jasně|potvrzuji|udělej\s*to|udělej|platí|souhlasím|ok\b|okay)\b/i;

export function userUtteranceConfirmsAction(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return CONFIRM_RE.test(t);
}

export async function proposeSecretaryAction(
  db: Firestore,
  input: {
    companyId: string;
    userId: string;
    type: string;
    payload: Record<string, unknown>;
    summary: string;
  }
): Promise<{ pendingId: string; summary: string }> {
  const pendingId = randomUUID();
  const now = Date.now();
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection(PENDING_COLLECTION)
    .doc(pendingId)
    .set({
      type: input.type,
      payload: input.payload,
      summary: input.summary,
      requiresConfirmation: true,
      userId: input.userId,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(now + TTL_MS),
    });
  return { pendingId, summary: input.summary };
}

export async function loadPendingSecretaryAction(
  db: Firestore,
  companyId: string,
  pendingId: string,
  userId: string
): Promise<PendingSecretaryAction | null> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PENDING_COLLECTION)
    .doc(pendingId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as PendingSecretaryAction;
  if (data.userId !== userId) return null;
  if (data.expiresAt.toMillis() < Date.now()) return null;
  return { ...data, id: snap.id };
}

export async function consumePendingSecretaryAction(
  db: Firestore,
  companyId: string,
  pendingId: string
): Promise<void> {
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PENDING_COLLECTION)
    .doc(pendingId)
    .delete()
    .catch(() => undefined);
}
