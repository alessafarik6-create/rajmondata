/**
 * Orchestrace AI analýzy obchodního dokladu (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { OPENAI_DOCUMENT_MAX_BYTES } from "@/lib/ai/config";
import { extractPdfTextContent } from "@/lib/ai/document-pdf-text";
import {
  buildAiFilledFields,
  buildAiLowConfidenceFields,
  validateDocumentAiExtraction,
} from "@/lib/ai/document-extraction-validator";
import { analyzeDocumentWithOpenAi } from "@/lib/ai/openai-document-client";
import { OpenAiClientError } from "@/lib/ai/openai-client";
import { DOCUMENT_AI_ACCEPTED_MIME } from "@/lib/ai/document-extraction-types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import { buildDocumentSearchTextFromPatch } from "@/lib/search/document-search-text";

export type AnalyzeCompanyDocumentParams = {
  db: Firestore;
  companyId: string;
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
};

export type AnalyzeCompanyDocumentSuccess = {
  ok: true;
  readable: boolean;
  unreadableReason: string | null;
  formPatch: ReturnType<typeof validateDocumentAiExtraction> extends Promise<infer R>
    ? R extends { formPatch: infer F }
      ? F
      : never
    : never;
  direction: "received" | "issued";
  warnings: string[];
  confidence: number;
  filledFields: ReturnType<typeof buildAiFilledFields>;
  lowConfidenceFields: ReturnType<typeof buildAiLowConfidenceFields>;
  duplicateCandidates: Awaited<
    ReturnType<typeof validateDocumentAiExtraction>
  >["duplicateCandidates"];
  suggestedJobs: Awaited<
    ReturnType<typeof validateDocumentAiExtraction>
  >["suggestedJobs"];
  supplierMatch: Awaited<
    ReturnType<typeof validateDocumentAiExtraction>
  >["supplierMatch"];
  model: string;
  aiMeta: {
    analysedByAi: true;
    aiModel: string;
    aiConfidence: number;
    aiWarnings: string[];
  };
  searchableText: string;
};

export type AnalyzeCompanyDocumentFailure = {
  ok: false;
  status: number;
  error: string;
};

function isAcceptedMime(mime: string): boolean {
  const m = mime.toLowerCase().split(";")[0].trim();
  return (DOCUMENT_AI_ACCEPTED_MIME as readonly string[]).includes(m);
}

export async function analyzeCompanyDocument(
  params: AnalyzeCompanyDocumentParams
): Promise<AnalyzeCompanyDocumentSuccess | AnalyzeCompanyDocumentFailure> {
  const mime = params.mimeType.toLowerCase().split(";")[0].trim();
  const fileName = String(params.fileName ?? "document").trim() || "document";

  if (!isAcceptedMime(mime)) {
    return {
      ok: false,
      status: 400,
      error: "Nepodporovaný typ souboru. Použijte JPG, PNG, WEBP nebo PDF.",
    };
  }

  if (params.fileBuffer.length > OPENAI_DOCUMENT_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Soubor je příliš velký pro AI analýzu (max. 12 MB).",
    };
  }

  const companySnap = await params.db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .get();
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const companyName =
    String(company.companyName ?? company.name ?? "").trim() || "Organizace";

  try {
    const base64 = params.fileBuffer.toString("base64");
    let aiRes;
    let extractedRawText = "";

    if (mime === "application/pdf") {
      const text = await extractPdfTextContent(params.fileBuffer);
      extractedRawText = text;
      if (text.length >= 80) {
        aiRes = await analyzeDocumentWithOpenAi(
          { kind: "pdf_text", text, fileName },
          { companyName }
        );
      } else {
        aiRes = await analyzeDocumentWithOpenAi(
          { kind: "pdf", base64, fileName },
          { companyName }
        );
      }
    } else {
      aiRes = await analyzeDocumentWithOpenAi(
        { kind: "image", mimeType: mime, base64 },
        { companyName }
      );
    }

    const validated = await validateDocumentAiExtraction(
      params.db,
      params.companyId,
      JSON.parse(aiRes.outputText),
      { model: aiRes.model, requestDurationMs: aiRes.requestDurationMs }
    );

    const searchableText = buildDocumentSearchTextFromPatch(validated.formPatch, {
      rawText: extractedRawText.slice(0, 12000),
      fileName,
    });

    return {
      ok: true,
      readable: validated.readable,
      unreadableReason: validated.unreadableReason,
      formPatch: validated.formPatch,
      direction: validated.direction,
      warnings: validated.warnings,
      confidence: validated.confidence,
      filledFields: buildAiFilledFields(validated.formPatch),
      lowConfidenceFields: buildAiLowConfidenceFields(validated.fieldConfidences),
      duplicateCandidates: validated.duplicateCandidates,
      suggestedJobs: validated.suggestedJobs,
      supplierMatch: validated.supplierMatch,
      model: validated.model,
      aiMeta: {
        analysedByAi: true,
        aiModel: validated.model,
        aiConfidence: validated.confidence,
        aiWarnings: validated.warnings,
      },
      searchableText,
    };
  } catch (err) {
    if (err instanceof OpenAiClientError) {
      return { ok: false, status: err.statusCode, error: err.userMessage };
    }
    console.error("[analyzeCompanyDocument]", errorMessageFromUnknown(err));
    return {
      ok: false,
      status: 502,
      error: "Analýza dokladu se nezdařila. Zkuste to znovu.",
    };
  }
}
