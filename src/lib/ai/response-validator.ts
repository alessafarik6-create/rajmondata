/**
 * Validace AI výstupu a doplnění autoritativních cen z CRM (katalog + cenový engine).
 */

import {
  calculateInquiryOfferPricing,
  normalizeInquiryVatRate,
  type InquiryVatRate,
} from "@/lib/inquiry-offer-pricing";
import { getAiMaxDiscountPercent } from "@/lib/ai/config";
import type { AiInquiryCrmContext } from "@/lib/ai/crm-context-builder";
import { parseAiQuoteModelOutput } from "@/lib/ai/inquiry-quote-schema";
import { filterIgnoredMissingInformation } from "@/lib/ai/inquiry-type-rules";
import { computeAdjustedConfidence } from "@/lib/ai/confidence-calculator";
import { runPriceEngine } from "@/lib/ai/price-engine";
import type {
  AiQuoteModelOutput,
  AiValidatedQuoteItem,
  AiValidatedQuoteResult,
} from "@/lib/ai/types";
import type { AiTokenUsage } from "@/lib/ai/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function productKey(catalogId: string, productId: string): string {
  return `${catalogId}::${productId}`;
}

export function validateAiQuoteResponse(
  rawOutput: unknown,
  ctx: AiInquiryCrmContext,
  meta: {
    generationId: string;
    model: string;
    usage: AiTokenUsage;
    requestDurationMs: number;
    vatRate?: InquiryVatRate;
  }
): AiValidatedQuoteResult {
  const parsed: AiQuoteModelOutput = parseAiQuoteModelOutput(rawOutput);
  const maxDiscount = getAiMaxDiscountPercent();
  const vatRate = normalizeInquiryVatRate(meta.vatRate ?? 21);

  const catalogProducts =
    ctx.relevantProducts.length > 0 ? ctx.relevantProducts : ctx.products;

  const productMap = new Map<string, (typeof catalogProducts)[number]>();
  for (const p of catalogProducts) {
    productMap.set(productKey(p.catalogId, p.productId), p);
  }

  const warnings: string[] = [];
  let invalidProductCount = 0;

  const engineInputs: Array<{
    catalogId: string;
    productId: string;
    name: string;
    quantity: number;
    unit: string;
    discountPercent: number;
    reason: string;
  }> = [];
  for (const item of parsed.recommended_items) {
    const key = productKey(item.catalog_id, item.product_id);
    const product = productMap.get(key);
    if (!product) {
      invalidProductCount += 1;
      warnings.push(
        `Položka „${item.name}“ (${item.product_id}) nebyla nalezena v katalogu a byla vynechána.`
      );
      continue;
    }

    let discountPercent = item.discount ?? 0;
    if (!Number.isFinite(discountPercent) || discountPercent < 0) discountPercent = 0;
    if (discountPercent > maxDiscount) {
      warnings.push(
        `Sleva ${discountPercent} % u „${product.name}“ překračuje limit ${maxDiscount} % — byla snížena.`
      );
      discountPercent = maxDiscount;
    }

    engineInputs.push({
      catalogId: product.catalogId,
      productId: product.productId,
      name: product.name,
      quantity: Math.max(0.001, Number(item.quantity)),
      unit: String(item.unit ?? "ks").trim() || "ks",
      discountPercent: roundMoney(discountPercent),
      reason: String(item.reason ?? "").trim(),
    });
  }

  const inquiryText = [ctx.inquiry.message, ctx.inquiry.type, ctx.inquiry.internalNote ?? ""]
    .filter(Boolean)
    .join("\n");

  const priceEngine = runPriceEngine({
    items: engineInputs,
    products: catalogProducts,
    priceRules: ctx.priceRules,
    inquiryType: ctx.inquiry.type || ctx.typeRule.name,
    typeRuleName: ctx.typeRule.name,
    inquiryText,
    knowledgeSources: ctx.knowledgeHits.map((k) => k.documentTitle),
    exampleSources: ctx.similarQuotes.map((q) => q.subject || q.id),
  });

  warnings.push(...priceEngine.warnings);

  const recommendedItems: AiValidatedQuoteItem[] = priceEngine.items.map((line) => ({
    catalogId: line.catalogId,
    productId: line.productId,
    name: line.name,
    quantity: roundMoney(line.quantity),
    unit: line.unit,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    lineNet: line.lineNet,
    reason: line.reason?.trim() || "Cena z CRM pravidel",
  }));

  const missingInformation = filterIgnoredMissingInformation(
    parsed.missing_information.map((s) => s.trim()).filter(Boolean),
    ctx.typeRule.ignoredInformation
  );

  if (
    missingInformation.length <
    parsed.missing_information.filter((s) => s.trim()).length
  ) {
    warnings.push(
      "Některé navržené chybějící údaje byly vynechány — nejsou relevantní pro tento typ poptávky."
    );
  }

  const totalNet =
    recommendedItems.length > 0
      ? roundMoney(recommendedItems.reduce((s, i) => s + i.lineNet, 0))
      : null;

  const pricing = calculateInquiryOfferPricing(totalNet, vatRate);

  if (recommendedItems.length === 0 && missingInformation.length === 0) {
    warnings.push(
      "AI nenavrhla žádné platné položky. Zkontrolujte chybějící informace, katalog nebo cenová pravidla v AI centru."
    );
  }

  const confidenceFactors = computeAdjustedConfidence({
    modelConfidence: parsed.confidence,
    typeRule: ctx.typeRule,
    similarQuotes: ctx.similarQuotes,
    products: ctx.products,
    relevantProducts: ctx.relevantProducts,
    missingInformation,
    invalidProductCount,
    hasEstimatedPrice: ctx.inquiry.estimatedPriceKc != null,
  });

  const internalNotesParts = [parsed.internal_notes.trim()];
  if (confidenceFactors.reasons.length > 0) {
    internalNotesParts.push("");
    internalNotesParts.push("Hodnocení jistoty:");
    for (const r of confidenceFactors.reasons) {
      internalNotesParts.push(`- ${r}`);
    }
  }

  if (priceEngine.explainability.appliedLines.length > 0) {
    internalNotesParts.push("");
    internalNotesParts.push("Cena z CRM pravidel (deterministický výpočet):");
    for (const line of priceEngine.explainability.appliedLines) {
      internalNotesParts.push(`- ${line.expression}`);
    }
  }

  if (
    ctx.inquiry.estimatedPriceKc != null &&
    pricing.priceNet != null &&
    ctx.inquiry.estimatedPriceKc > 0
  ) {
    const ratio =
      Math.abs(pricing.priceNet - ctx.inquiry.estimatedPriceKc) /
      ctx.inquiry.estimatedPriceKc;
    if (ratio <= 0.15) {
      internalNotesParts.push(
        "Vypočtená cena z CRM je v souladu s orientační cenou poptávky."
      );
    }
  }

  if (ctx.similarQuotes.length > 0 && pricing.priceNet != null) {
    const historical = ctx.similarQuotes
      .map((q) => q.priceNetKc ?? q.priceGrossKc)
      .filter((p): p is number => p != null && p > 0);
    if (historical.length > 0) {
      const avg = historical.reduce((a, b) => a + b, 0) / historical.length;
      const ratio = Math.abs(pricing.priceNet - avg) / avg;
      if (ratio <= 0.2) {
        internalNotesParts.push(
          "Vypočtená cena odpovídá podobným historickým nabídkám (historické ceny nejsou závazné)."
        );
      }
    }
  }

  return {
    generationId: meta.generationId,
    summary: parsed.summary.trim(),
    customerRequirements: parsed.customer_requirements.map((s) => s.trim()).filter(Boolean),
    missingInformation,
    recommendedItems,
    internalNotes: internalNotesParts.filter(Boolean).join("\n").trim(),
    customerReply: parsed.customer_reply.trim(),
    confidence: confidenceFactors.adjustedConfidence,
    confidenceFactors,
    vatRate,
    pricing,
    warnings,
    priceExplainability: priceEngine.explainability,
    model: meta.model,
    requestDurationMs: meta.requestDurationMs,
    usage: meta.usage,
  };
}

export function buildInternalNoteFromAiQuote(result: AiValidatedQuoteResult): string {
  const lines: string[] = [];
  if (result.internalNotes.trim()) {
    lines.push(result.internalNotes.trim());
  }
  if (result.recommendedItems.length > 0) {
    lines.push("");
    lines.push("AI navrhlo položky:");
    for (const item of result.recommendedItems) {
      lines.push(
        `- ${item.name} (${item.quantity} ${item.unit}) · ${item.lineNet} Kč bez DPH · ${item.reason}`
      );
    }
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Upozornění validace:");
    for (const w of result.warnings) {
      lines.push(`- ${w}`);
    }
  }
  return lines.join("\n").trim();
}

export function computeAiUserChangesDiff(
  aiSnapshot: Record<string, unknown>,
  finalSnapshot: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys = ["bodyText", "priceNet", "internalNote", "subject", "to"] as const;
  for (const key of keys) {
    const from = aiSnapshot[key];
    const to = finalSnapshot[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      diff[key] = { from, to };
    }
  }
  return diff;
}
