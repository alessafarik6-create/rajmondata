import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  consumePendingSecretaryAction,
  loadPendingSecretaryAction,
  proposeSecretaryAction,
  userUtteranceConfirmsAction,
} from "@/lib/ai/secretary/confirmation";
import {
  listActiveMemories,
  matchMemoryByUtterance,
  saveMemoryVersion,
  utteranceLooksLikeSecret,
  validateWorkflowSteps,
} from "@/lib/ai/secretary/memory-service";
import {
  AI_SECRETARY_MEMORIES_COLLECTION,
  type AiSecretaryMemoryDoc,
  type AiSecretaryWorkflowStep,
} from "@/lib/ai/secretary/memory-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { logSecretaryAudit } from "@/lib/ai/secretary/audit";

export async function listAiMemoriesTool(
  db: Firestore,
  organizationId: string,
  userId: string
) {
  const items = await listActiveMemories(db, organizationId, userId, 30);
  return {
    ok: true,
    memories: items.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      scope: m.scope,
      version: m.version,
      useCount: m.useCount,
      lastUsedAt: m.lastUsedAt,
      triggerPhrases: (m.triggerPhrases ?? []).slice(0, 5),
    })),
  };
}

export async function getAiMemoryTool(db: Firestore, organizationId: string, memoryId: string) {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(AI_SECRETARY_MEMORIES_COLLECTION)
    .doc(memoryId)
    .get();
  if (!snap.exists) return { ok: false, error: "Paměť nenalezena." };
  const m = snap.data() as AiSecretaryMemoryDoc;
  return {
    ok: true,
    memory: {
      id: snap.id,
      name: m.name,
      type: m.type,
      description: m.description,
      triggerPhrases: m.triggerPhrases,
      steps: m.steps,
      version: m.version,
      status: m.status,
    },
  };
}

export async function matchAiMemoryTool(
  db: Firestore,
  organizationId: string,
  userId: string,
  utterance: string
) {
  const hit = await matchMemoryByUtterance(db, organizationId, userId, utterance);
  if (!hit) return { ok: true, matched: false };
  return {
    ok: true,
    matched: true,
    memoryId: hit.id,
    name: hit.name,
    type: hit.type,
    matchScore: hit.matchScore,
    steps: hit.steps,
    description: hit.description,
    hint: "Proveď kroky postupně přes existující nástroje. Write kroky vždy s potvrzením.",
  };
}

export async function createAiMemoryDraftTool(
  db: Firestore,
  input: {
    companyId: string;
    userId: string;
    name: string;
    type: AiSecretaryMemoryDoc["type"];
    triggerPhrases: string[];
    description?: string;
    steps: AiSecretaryWorkflowStep[];
    scope?: AiSecretaryMemoryDoc["scope"];
  }
) {
  const textBlob = `${input.name} ${input.description ?? ""} ${JSON.stringify(input.steps)}`;
  if (utteranceLooksLikeSecret(textBlob)) {
    return { ok: false, error: "Do paměti nelze ukládat hesla, tokeny ani jiné tajné údaje." };
  }
  const stepErr = validateWorkflowSteps(input.steps);
  if (stepErr) return { ok: false, error: stepErr };

  const summary = `Uložit ${input.type === "preference" ? "preferenci" : "postup"} „${input.name}“ (${input.triggerPhrases.join(", ")})?`;
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: input.companyId,
    userId: input.userId,
    type: "ai_memory_create",
    payload: {
      name: input.name,
      type: input.type,
      triggerPhrases: input.triggerPhrases,
      description: input.description ?? null,
      steps: input.steps,
      scope: input.scope ?? "user",
    },
    summary,
  });
  return { ok: true, pendingActionId: pendingId, summary, requiresConfirmation: true };
}

export async function confirmAiMemoryCreateTool(
  db: Firestore,
  input: { companyId: string; userId: string; pendingActionId: string; userConfirmationText?: string }
) {
  if (!userUtteranceConfirmsAction(input.userConfirmationText)) {
    return { ok: false, message: "Bez potvrzení nelze uložit paměť." };
  }
  const pending = await loadPendingSecretaryAction(
    db,
    input.companyId,
    input.pendingActionId,
    input.userId
  );
  if (!pending || pending.type !== "ai_memory_create") {
    return { ok: false, message: "Návrh paměti vypršel nebo neexistuje." };
  }
  const p = pending.payload;
  const memoryId = await saveMemoryVersion(db, {
    organizationId: input.companyId,
    scope: (p.scope as AiSecretaryMemoryDoc["scope"]) ?? "user",
    userId: p.scope === "organization" ? null : input.userId,
    type: p.type as AiSecretaryMemoryDoc["type"],
    name: String(p.name),
    triggerPhrases: Array.isArray(p.triggerPhrases) ? (p.triggerPhrases as string[]) : [],
    description: p.description != null ? String(p.description) : null,
    steps: (p.steps as AiSecretaryWorkflowStep[]) ?? [],
    requiredCapabilities: [],
    status: "active",
    createdByUserId: input.userId,
    version: 1,
    useCount: 0,
    lastUsedAt: null,
  });

  await consumePendingSecretaryAction(db, input.companyId, input.pendingActionId);

  await logSecretaryAudit(db, {
    companyId: input.companyId,
    userId: input.userId,
    action: "ai_memory_created",
    detail: memoryId,
  });

  return { ok: true, memoryId, message: "Paměť uložena." };
}

export async function disableAiMemoryDraftTool(
  db: Firestore,
  input: { companyId: string; userId: string; memoryId: string; name?: string }
) {
  const summary = `Vypnout postup „${input.name ?? input.memoryId}“?`;
  const { pendingId } = await proposeSecretaryAction(db, {
    companyId: input.companyId,
    userId: input.userId,
    type: "ai_memory_disable",
    payload: { memoryId: input.memoryId },
    summary,
  });
  return { ok: true, pendingActionId: pendingId, summary };
}

export async function confirmAiMemoryDisableTool(
  db: Firestore,
  input: { companyId: string; userId: string; pendingActionId: string; userConfirmationText?: string }
) {
  if (!userUtteranceConfirmsAction(input.userConfirmationText)) {
    return { ok: false, message: "Bez potvrzení nelze vypnout postup." };
  }
  const pending = await loadPendingSecretaryAction(
    db,
    input.companyId,
    input.pendingActionId,
    input.userId
  );
  if (!pending || pending.type !== "ai_memory_disable") {
    return { ok: false, message: "Návrh vypršel nebo neexistuje." };
  }
  const memoryId = String(pending.payload.memoryId ?? "");
  await consumePendingSecretaryAction(db, input.companyId, input.pendingActionId);
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection(AI_SECRETARY_MEMORIES_COLLECTION)
    .doc(memoryId)
    .set({ status: "disabled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await logSecretaryAudit(db, {
    companyId: input.companyId,
    userId: input.userId,
    action: "ai_memory_disabled",
    detail: memoryId,
  });
  return { ok: true, message: "Postup vypnut." };
}
