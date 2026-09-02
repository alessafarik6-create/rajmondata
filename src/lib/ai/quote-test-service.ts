/**
 * Testovací generování AI návrhu bez reálné poptávky (AI centrum — Test AI).
 */

import type { Firestore } from "firebase-admin/firestore";
import { isAiFeatureEnabled, getOpenAiModel } from "@/lib/ai/config";
import { buildInquiryQuoteUserPrompt } from "@/lib/ai/prompt-builder";
import {
  generateInquiryQuoteWithOpenAi,
  OpenAiClientError,
} from "@/lib/ai/openai-client";
import { parseAiQuoteModelOutput } from "@/lib/ai/inquiry-quote-schema";
import { validateAiQuoteResponse } from "@/lib/ai/response-validator";
import type { AiInquiryCrmContext } from "@/lib/ai/crm-context-builder";
import {
  loadAiAssistantSettings,
  loadAiInquiryTypeRules,
  resolveInquiryTypeRule,
  filterProductsByTypeRule,
} from "@/lib/ai/inquiry-type-rules";
import { loadActiveAiPriceRules } from "@/lib/ai/price-rules-loader";
import { retrieveKnowledgeForQuery } from "@/lib/ai/knowledge-service";
import { findSimilarHistoricalQuotes } from "@/lib/ai/similar-quotes-retriever";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { ProductCatalogProduct } from "@/lib/product-catalogs";
import type { AiValidatedQuoteResult } from "@/lib/ai/types";
import { normalizeInquiryVatRate } from "@/lib/inquiry-offer-pricing";

export type TestAiQuoteParams = {
  db: Firestore;
  companyId: string;
  inquiryType: string;
  inquiryText: string;
  vatRate?: number;
};

export type TestAiQuoteSuccess = {
  ok: true;
  result: AiValidatedQuoteResult;
  contextSummary: Record<string, unknown>;
  explainability: AiValidatedQuoteResult["priceExplainability"];
};

export type TestAiQuoteFailure = {
  ok: false;
  status: number;
  error: string;
};

async function buildTestContext(
  db: Firestore,
  companyId: string,
  inquiryType: string,
  inquiryText: string
): Promise<AiInquiryCrmContext> {
  const [companySnap, aiSettings, typeRules, priceRules] = await Promise.all([
    db.collection(COMPANIES_COLLECTION).doc(companyId).get(),
    loadAiAssistantSettings(db, companyId),
    loadAiInquiryTypeRules(db, companyId),
    loadActiveAiPriceRules(db, companyId),
  ]);

  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const companyName =
    String(company.companyName ?? company.name ?? "").trim() || "Organizace";
  const typeRule = resolveInquiryTypeRule(inquiryType || "Obecná poptávka", typeRules);

  const catalogsSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("product_catalogs")
    .limit(40)
    .get();

  const products: AiInquiryCrmContext["products"] = [];
  for (const catDoc of catalogsSnap.docs) {
    const cat = catDoc.data() as Record<string, unknown>;
    const catalogName = String(cat.name ?? catDoc.id).trim();
    const list = Array.isArray(cat.products) ? cat.products : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as ProductCatalogProduct;
      if (p.archived === true || p.active === false) continue;
      const productId = String(p.id ?? "").trim();
      const name = String(p.name ?? "").trim();
      if (!productId || !name) continue;
      products.push({
        catalogId: catDoc.id,
        catalogName,
        productId,
        name,
        shortDescription: String(p.shortDescription ?? "").trim() || undefined,
        category: String(p.category ?? "").trim() || undefined,
        price:
          p.price != null && Number.isFinite(Number(p.price)) ? Number(p.price) : null,
        note: String(p.note ?? "").trim() || undefined,
      });
    }
  }

  const relevantProducts = filterProductsByTypeRule(products, typeRule);
  const knowledgeQuery = [inquiryType, inquiryText, typeRule.name].filter(Boolean).join(" ");

  const [similarQuotes, knowledgeHits] = await Promise.all([
    findSimilarHistoricalQuotes(db, {
      companyId,
      leadKey: "__test__",
      inquiryType: inquiryType || typeRule.name,
      inquiryMessage: inquiryText,
      estimatedPriceKc: null,
      typeRule,
      knowledge: aiSettings.knowledge,
    }),
    retrieveKnowledgeForQuery(db, companyId, knowledgeQuery, 6),
  ]);

  return {
    companyId,
    companyName,
    leadKey: "__test__",
    importLeadId: null,
    inquiry: {
      name: "Test zákazník",
      email: "test@example.com",
      phone: "",
      address: "",
      message: inquiryText,
      type: inquiryType || typeRule.name,
      estimatedPriceKc: null,
      receivedAtIso: new Date().toISOString(),
      workflowStatus: "test",
      internalNote: null,
    },
    customer: null,
    offerHistory: [],
    products,
    aiSettings,
    typeRule,
    relevantProducts,
    similarQuotes,
    priceRules,
    knowledgeHits,
  };
}

export async function runTestAiQuote(
  params: TestAiQuoteParams
): Promise<TestAiQuoteSuccess | TestAiQuoteFailure> {
  if (!isAiFeatureEnabled()) {
    return { ok: false, status: 503, error: "AI asistent je dočasně vypnutý." };
  }

  const inquiryText = String(params.inquiryText ?? "").trim();
  if (!inquiryText) {
    return { ok: false, status: 400, error: "Zadejte text testovací poptávky." };
  }

  const model = getOpenAiModel();
  let context: AiInquiryCrmContext;
  try {
    context = await buildTestContext(
      params.db,
      params.companyId,
      String(params.inquiryType ?? "").trim(),
      inquiryText
    );
    if (!context.aiSettings.enabled) {
      return { ok: false, status: 503, error: "AI asistent je vypnutý v nastavení." };
    }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Kontext se nepodařilo sestavit.",
    };
  }

  const userPrompt = buildInquiryQuoteUserPrompt(context);
  const generationId = `test_${Date.now()}`;

  try {
    const aiRes = await generateInquiryQuoteWithOpenAi(userPrompt, { model });
    const aiOutputRaw = parseAiQuoteModelOutput(aiRes.outputText);
    const validated = validateAiQuoteResponse(aiOutputRaw, context, {
      generationId,
      model: aiRes.model,
      usage: aiRes.usage,
      requestDurationMs: aiRes.requestDurationMs,
      vatRate: normalizeInquiryVatRate(params.vatRate ?? 21),
    });

    return {
      ok: true,
      result: validated,
      contextSummary: {
        inquiryType: context.inquiry.type || context.typeRule.name,
        typeRuleName: context.typeRule.name,
        priceRulesCount: context.priceRules.length,
        knowledgeHitsCount: context.knowledgeHits.length,
        similarQuotesCount: context.similarQuotes.length,
        relevantProductCount: context.relevantProducts.length,
        knowledgeDocuments: context.knowledgeHits.map((k) => k.documentTitle),
        similarQuoteSubjects: context.similarQuotes.map((q) => q.subject || q.id),
        appliedPriceRules: validated.priceExplainability?.appliedLines ?? [],
      },
      explainability: validated.priceExplainability,
    };
  } catch (err) {
    if (err instanceof OpenAiClientError) {
      return { ok: false, status: err.statusCode ?? 502, error: err.userMessage };
    }
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Test AI selhal.",
    };
  }
}
