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
  status: "pending" | "cancelled" | "confirmed";
  createdAt: Timestamp;
  expiresAt: Timestamp;
  userId: string;
  organizationId: string;
};

const CONFIRM_RE =
  /\b(ano|jo|jasně|potvrzuji|udělej\s*to|udělej|platí|souhlasím|zapiš|zapis|ok\b|okay)\b/i;

const DENY_RE = /\b(ne|nene|zruš|zrus|stop|nemám|nechci)\b/i;

export function userUtteranceConfirmsAction(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (DENY_RE.test(t) && !CONFIRM_RE.test(t)) return false;
  return CONFIRM_RE.test(t);
}

export function userUtteranceDeniesAction(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return DENY_RE.test(t) && !CONFIRM_RE.test(t);
}

async function cancelOtherPendingForUser(
  db: Firestore,
  companyId: string,
  userId: string,
  exceptId?: string
): Promise<void> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PENDING_COLLECTION)
    .where("userId", "==", userId)
    .where("status", "==", "pending")
    .limit(20)
    .get();
  const batch = db.batch();
  for (const doc of snap.docs) {
    if (exceptId && doc.id === exceptId) continue;
    batch.update(doc.ref, { status: "cancelled", updatedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit().catch(() => undefined);
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
  await cancelOtherPendingForUser(db, input.companyId, input.userId);
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
      status: "pending",
      organizationId: input.companyId,
      userId: input.userId,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(now + TTL_MS),
    });
  return { pendingId, summary: input.summary };
}

export async function updatePendingSecretaryAction(
  db: Firestore,
  input: {
    companyId: string;
    userId: string;
    pendingId: string;
    payloadPatch: Record<string, unknown>;
    summary: string;
  }
): Promise<{ ok: boolean; message?: string }> {
  const pending = await loadPendingSecretaryAction(
    db,
    input.companyId,
    input.pendingId,
    input.userId
  );
  if (!pending) return { ok: false, message: "Návrh vypršel nebo neexistuje." };
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection(PENDING_COLLECTION)
    .doc(input.pendingId)
    .set(
      {
        payload: { ...pending.payload, ...input.payloadPatch },
        summary: input.summary,
        status: "pending",
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
      },
      { merge: true }
    );
  return { ok: true };
}

export async function cancelPendingSecretaryAction(
  db: Firestore,
  companyId: string,
  pendingId: string,
  userId: string
): Promise<{ ok: boolean }> {
  const pending = await loadPendingSecretaryAction(db, companyId, pendingId, userId);
  if (!pending) return { ok: false };
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PENDING_COLLECTION)
    .doc(pendingId)
    .set({ status: "cancelled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
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
  if (data.status === "cancelled" || data.status === "confirmed") return null;
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
