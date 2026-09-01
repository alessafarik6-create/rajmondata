/**
 * Ukládání historie AI generací (Admin SDK).
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { AI_GENERATIONS_COLLECTION } from "@/lib/ai/config";
import type { AiGenerationRecord, AiValidatedQuoteResult } from "@/lib/ai/types";
import type { AiInquiryCrmContext } from "@/lib/ai/crm-context-builder";
import { summarizeAiCrmContext } from "@/lib/ai/crm-context-builder";
import type { AiQuoteModelOutput } from "@/lib/ai/types";
import type { AiTokenUsage } from "@/lib/ai/types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function saveAiGenerationCompleted(
  db: Firestore,
  params: {
    generationId: string;
    companyId: string;
    leadKey: string;
    importLeadId?: string | null;
    customerId?: string | null;
    createdByUid: string;
    model: string;
    context: AiInquiryCrmContext;
    aiOutputRaw: AiQuoteModelOutput;
    validated: AiValidatedQuoteResult;
    usage: AiTokenUsage;
    requestDurationMs: number;
  }
): Promise<void> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection(AI_GENERATIONS_COLLECTION)
    .doc(params.generationId);

  const { generationId: _gid, ...validatedRest } = params.validated;

  await ref.set({
    companyId: params.companyId,
    leadKey: params.leadKey,
    importLeadId: params.importLeadId ?? params.leadKey,
    customerId: params.customerId ?? null,
    createdByUid: params.createdByUid,
    createdAt: FieldValue.serverTimestamp(),
    model: params.model,
    status: "completed",
    inputContextSummary: summarizeAiCrmContext(params.context),
    aiOutputRaw: params.aiOutputRaw,
    validatedOutput: validatedRest,
    usage: params.usage,
    requestDurationMs: params.requestDurationMs,
    usedByUser: false,
    usedAt: null,
    finalOfferSnapshot: null,
  } satisfies Omit<AiGenerationRecord, "id">);
}

export async function saveAiGenerationFailed(
  db: Firestore,
  params: {
    generationId?: string;
    companyId: string;
    leadKey: string;
    createdByUid: string;
    model: string;
    errorMessage: string;
    requestDurationMs?: number | null;
    usage?: AiTokenUsage;
  }
): Promise<string> {
  const ref = params.generationId
    ? db
        .collection(COMPANIES_COLLECTION)
        .doc(params.companyId)
        .collection(AI_GENERATIONS_COLLECTION)
        .doc(params.generationId)
    : db
        .collection(COMPANIES_COLLECTION)
        .doc(params.companyId)
        .collection(AI_GENERATIONS_COLLECTION)
        .doc();

  await ref.set({
    companyId: params.companyId,
    leadKey: params.leadKey,
    createdByUid: params.createdByUid,
    createdAt: FieldValue.serverTimestamp(),
    model: params.model,
    status: "failed",
    errorMessage: params.errorMessage.slice(0, 2000),
    requestDurationMs: params.requestDurationMs ?? null,
    usage: params.usage ?? null,
    usedByUser: false,
  });

  return ref.id;
}

export async function markAiGenerationUsed(
  db: Firestore,
  params: {
    companyId: string;
    generationId: string;
    callerUid: string;
    finalOfferSnapshot: Record<string, unknown>;
    aiSnapshot?: Record<string, unknown>;
  }
): Promise<void> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection(AI_GENERATIONS_COLLECTION)
    .doc(params.generationId);

  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("AI generace nebyla nalezena.");
  }
  const data = snap.data() as Record<string, unknown>;
  if (String(data.companyId ?? "") !== params.companyId) {
    throw new Error("Přístup k AI generaci odepřen.");
  }

  await ref.set(
    {
      usedByUser: true,
      usedAt: FieldValue.serverTimestamp(),
      usedByUid: params.callerUid,
      finalOfferSnapshot: params.finalOfferSnapshot,
      aiSnapshotAtUse: params.aiSnapshot ?? null,
    },
    { merge: true }
  );
}
