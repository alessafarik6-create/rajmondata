/**
 * Orchestrace generování AI návrhu nabídky k poptávce.
 */

import type { Firestore } from "firebase-admin/firestore";
import { isAiFeatureEnabled, getOpenAiModel } from "@/lib/ai/config";
import { buildInquiryAiCrmContext } from "@/lib/ai/crm-context-builder";
import { buildInquiryQuoteUserPrompt } from "@/lib/ai/prompt-builder";
import {
  generateInquiryQuoteWithOpenAi,
  OpenAiClientError,
} from "@/lib/ai/openai-client";
import { parseAiQuoteModelOutput } from "@/lib/ai/inquiry-quote-schema";
import {
  buildInternalNoteFromAiQuote,
  validateAiQuoteResponse,
} from "@/lib/ai/response-validator";
import {
  saveAiGenerationCompleted,
  saveAiGenerationFailed,
} from "@/lib/ai/generation-store";
import type { AiQuoteApplyInitial, AiValidatedQuoteResult } from "@/lib/ai/types";
import type { InquiryVatRate } from "@/lib/inquiry-offer-pricing";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { AI_GENERATIONS_COLLECTION } from "@/lib/ai/config";

export type GenerateInquiryAiQuoteParams = {
  db: Firestore;
  companyId: string;
  leadKey: string;
  callerUid: string;
  vatRate?: InquiryVatRate;
};

export type GenerateInquiryAiQuoteSuccess = {
  ok: true;
  result: AiValidatedQuoteResult;
  applyInitial: AiQuoteApplyInitial;
  contextSummary: Record<string, unknown>;
};

export type GenerateInquiryAiQuoteFailure = {
  ok: false;
  status: number;
  error: string;
  generationId?: string;
};

export async function generateInquiryAiQuote(
  params: GenerateInquiryAiQuoteParams
): Promise<GenerateInquiryAiQuoteSuccess | GenerateInquiryAiQuoteFailure> {
  if (!isAiFeatureEnabled()) {
    return {
      ok: false,
      status: 503,
      error: "AI asistent je dočasně vypnutý administrátorem.",
    };
  }

  const model = getOpenAiModel();
  const started = Date.now();

  let context;
  try {
    context = await buildInquiryAiCrmContext(
      params.db,
      params.companyId,
      params.leadKey
    );
  } catch (err) {
    return {
      ok: false,
      status: 404,
      error:
        err instanceof Error ? err.message : "Poptávku se nepodařilo načíst.",
    };
  }

  const userPrompt = buildInquiryQuoteUserPrompt(context);
  const generationRef = params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection(AI_GENERATIONS_COLLECTION)
    .doc();
  const generationId = generationRef.id;

  try {
    const aiRes = await generateInquiryQuoteWithOpenAi(userPrompt, { model });
    const aiOutputRaw = parseAiQuoteModelOutput(aiRes.outputText);

    const validated = validateAiQuoteResponse(aiOutputRaw, context, {
      generationId,
      model: aiRes.model,
      usage: aiRes.usage,
      requestDurationMs: aiRes.requestDurationMs,
      vatRate: params.vatRate,
    });

    await saveAiGenerationCompleted(params.db, {
      generationId,
      companyId: params.companyId,
      leadKey: params.leadKey,
      importLeadId: context.importLeadId,
      customerId: context.customer?.customerId ?? null,
      createdByUid: params.callerUid,
      model: aiRes.model,
      context,
      aiOutputRaw,
      validated,
      usage: aiRes.usage,
      requestDurationMs: aiRes.requestDurationMs,
    });

    const applyInitial: AiQuoteApplyInitial = {
      to: context.inquiry.email || undefined,
      bodyText: validated.customerReply,
      priceNet: validated.pricing.priceNet,
      vatRate: validated.vatRate,
      internalNote: buildInternalNoteFromAiQuote(validated) || null,
    };

    return {
      ok: true,
      result: validated,
      applyInitial,
      contextSummary: {
        leadKey: context.leadKey,
        customerMatched: !!context.customer,
        productCount: context.products.length,
      },
    };
  } catch (err) {
    const requestDurationMs = Date.now() - started;
    const errorMessage = errorMessageFromUnknown(err);
    let status = 502;
    let userError = "Generování AI návrhu se nezdařilo.";

    if (err instanceof OpenAiClientError) {
      status = err.statusCode;
      userError = err.userMessage;
    }

    try {
      await saveAiGenerationFailed(params.db, {
        generationId,
        companyId: params.companyId,
        leadKey: params.leadKey,
        createdByUid: params.callerUid,
        model,
        errorMessage: userError,
        requestDurationMs,
      });
    } catch (logErr) {
      console.error("[generateInquiryAiQuote] save failed generation", logErr);
    }

    console.error("[generateInquiryAiQuote]", errorMessage);

    return {
      ok: false,
      status,
      error: userError,
      generationId,
    };
  }
}
