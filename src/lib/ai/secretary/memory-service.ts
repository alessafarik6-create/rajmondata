import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  AI_SECRETARY_MEMORIES_COLLECTION,
  ALLOWED_WORKFLOW_ACTIONS,
  type AiSecretaryMemoryDoc,
  type AiSecretaryWorkflowStep,
} from "@/lib/ai/secretary/memory-types";

const SECRET_BLOCK =
  /\b(heslo|password|api\s*key|token|certifik|bankovn[ií]|secret|p12|client\s*secret)\b/i;

export function utteranceLooksLikeSecret(text: string): boolean {
  return SECRET_BLOCK.test(text);
}

function normalizePhrase(p: string): string {
  return p.trim().toLowerCase().replace(/\s+/g, " ");
}

export function validateWorkflowSteps(steps: AiSecretaryWorkflowStep[]): string | null {
  for (const s of steps) {
    if (!ALLOWED_WORKFLOW_ACTIONS.has(s.action)) {
      return `Nepovolený krok workflow: ${s.action}`;
    }
  }
  return null;
}

export async function listActiveMemories(
  db: Firestore,
  organizationId: string,
  userId: string,
  limit = 40
): Promise<(AiSecretaryMemoryDoc & { id: string })[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(AI_SECRETARY_MEMORIES_COLLECTION)
    .where("status", "==", "active")
    .limit(limit)
    .get();

  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as AiSecretaryMemoryDoc) }))
    .filter(
      (m) =>
        m.scope === "organization" ||
        (m.scope === "user" && String(m.userId ?? "") === userId)
    );
}

export async function matchMemoryByUtterance(
  db: Firestore,
  organizationId: string,
  userId: string,
  utterance: string
): Promise<(AiSecretaryMemoryDoc & { id: string; matchScore: number }) | null> {
  const q = normalizePhrase(utterance);
  if (!q) return null;
  const items = await listActiveMemories(db, organizationId, userId, 60);
  let best: (AiSecretaryMemoryDoc & { id: string; matchScore: number }) | null = null;

  for (const m of items) {
    for (const phrase of m.triggerPhrases ?? []) {
      const p = normalizePhrase(phrase);
      if (!p) continue;
      if (q === p) {
        return { ...m, matchScore: 100 };
      }
      if (q.includes(p) || p.includes(q)) {
        const score = Math.min(95, 50 + p.length);
        if (!best || score > best.matchScore) {
          best = { ...m, matchScore: score };
        }
      }
    }
  }
  return best;
}

export async function saveMemoryVersion(
  db: Firestore,
  input: AiSecretaryMemoryDoc & { id?: string }
): Promise<string> {
  const col = db
    .collection(COMPANIES_COLLECTION)
    .doc(input.organizationId)
    .collection(AI_SECRETARY_MEMORIES_COLLECTION);

  const ref = input.id ? col.doc(input.id) : col.doc();
  await ref.set({
    ...input,
    useCount: input.useCount ?? 0,
    lastUsedAt: input.lastUsedAt ?? null,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function bumpMemoryUsage(
  db: Firestore,
  organizationId: string,
  memoryId: string
): Promise<void> {
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(AI_SECRETARY_MEMORIES_COLLECTION)
    .doc(memoryId)
    .set(
      {
        useCount: FieldValue.increment(1),
        lastUsedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}
