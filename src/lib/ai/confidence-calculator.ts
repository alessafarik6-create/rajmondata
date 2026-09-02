/**
 * Výpočet důvěryhodnosti AI návrhu na backendu (deterministický skóre model).
 */

import type { AiInquiryTypeRuleDoc } from "@/lib/ai/ai-settings-types";
import type { SimilarQuoteExample } from "@/lib/ai/similar-quotes-retriever";
import type { AiCrmProductRef } from "@/lib/ai/crm-context-builder";
import type { ParsedInquiryFields } from "@/lib/ai/inquiry-field-parser";

export type ConfidenceFactors = {
  modelConfidence: number;
  similarQuotesCount: number;
  hasCatalogProducts: boolean;
  allProductsPriced: boolean;
  missingRequiredCount: number;
  invalidProductCount: number;
  hasEstimatedPrice: boolean;
  pricingRuleMatched: boolean;
  hasPrice: boolean;
  knowledgeHitsCount: number;
  scoreBreakdown: {
    requiredComplete: number;
    pricingRule: number;
    examples: number;
    knowledge: number;
    productMatch: number;
    penalties: number;
  };
  adjustedConfidence: number;
  reasons: string[];
};

export function computeAdjustedConfidence(params: {
  modelConfidence: number;
  typeRule: AiInquiryTypeRuleDoc;
  similarQuotes: SimilarQuoteExample[];
  products: AiCrmProductRef[];
  relevantProducts: AiCrmProductRef[];
  missingInformation: string[];
  parsedFields?: ParsedInquiryFields;
  invalidProductCount: number;
  hasEstimatedPrice: boolean;
  pricingRuleMatched: boolean;
  hasPrice: boolean;
  knowledgeHitsCount: number;
}): ConfidenceFactors {
  const reasons: string[] = [];
  const breakdown = {
    requiredComplete: 0,
    pricingRule: 0,
    examples: 0,
    knowledge: 0,
    productMatch: 0,
    penalties: 0,
  };

  const requiredComplete =
    params.parsedFields != null
      ? params.parsedFields.missingRequired.length === 0 &&
        params.parsedFields.requiredFields.length > 0
      : params.missingInformation.length === 0 &&
        params.typeRule.requiredInformation.length > 0;

  if (requiredComplete) {
    breakdown.requiredComplete = 0.4;
    reasons.push("Všechna povinná pole typu poptávky jsou splněna.");
  } else {
    const missingCount =
      params.parsedFields?.missingRequired.length ??
      estimateMissingRequired(params.typeRule.requiredInformation, params.missingInformation);
    breakdown.penalties -= Math.min(0.25, missingCount * 0.1);
    reasons.push(`Chybí ${missingCount} povinných údajů dle pravidel typu.`);
  }

  if (params.pricingRuleMatched) {
    breakdown.pricingRule = 0.25;
    reasons.push("Bylo použito aktivní cenové pravidlo CRM.");
  } else {
    breakdown.penalties -= 0.15;
    reasons.push("Nebylo nalezeno aktivní cenové pravidlo pro výpočet.");
  }

  const similarCount = params.similarQuotes.length;
  if (similarCount >= 3) {
    breakdown.examples = 0.2;
    reasons.push(`Použito ${similarCount} relevantních vzorů nabídek.`);
  } else if (similarCount >= 1) {
    breakdown.examples = 0.1;
    reasons.push(`Použit ${similarCount} relevantní vzor nabídky.`);
  } else {
    breakdown.penalties -= 0.05;
    reasons.push("Chybí podobné schválené historické nabídky.");
  }

  if (params.knowledgeHitsCount > 0) {
    breakdown.knowledge = 0.1;
    reasons.push(`Použita znalostní báze (${params.knowledgeHitsCount} úryvků).`);
  }

  const catalog =
    params.relevantProducts.length > 0 ? params.relevantProducts : params.products;
  const hasCatalog = catalog.length > 0;
  if (hasCatalog) {
    breakdown.productMatch = 0.05;
  }

  if (params.invalidProductCount > 0) {
    breakdown.penalties -= Math.min(0.15, params.invalidProductCount * 0.05);
    reasons.push(`${params.invalidProductCount} navržených položek nebylo v katalogu.`);
  }

  if (params.hasEstimatedPrice) {
    breakdown.penalties += 0.02;
  }

  let score =
    breakdown.requiredComplete +
    breakdown.pricingRule +
    breakdown.examples +
    breakdown.knowledge +
    breakdown.productMatch +
    breakdown.penalties;

  if (!params.hasPrice) {
    score = Math.min(score, 0.75);
    if (params.pricingRuleMatched) {
      reasons.push("Cena nebyla spočítána — confidence je omezena.");
    }
  }

  const modelHint = clamp01(params.modelConfidence);
  score = score * 0.92 + modelHint * 0.08;

  return {
    modelConfidence: modelHint,
    similarQuotesCount: similarCount,
    hasCatalogProducts: hasCatalog,
    allProductsPriced:
      hasCatalog &&
      catalog.every((p) => p.price != null && Number.isFinite(p.price)),
    missingRequiredCount:
      params.parsedFields?.missingRequired.length ??
      estimateMissingRequired(params.typeRule.requiredInformation, params.missingInformation),
    invalidProductCount: params.invalidProductCount,
    hasEstimatedPrice: params.hasEstimatedPrice,
    pricingRuleMatched: params.pricingRuleMatched,
    hasPrice: params.hasPrice,
    knowledgeHitsCount: params.knowledgeHitsCount,
    scoreBreakdown: breakdown,
    adjustedConfidence: clamp01(score),
    reasons,
  };
}

function estimateMissingRequired(
  requiredInformation: string[],
  missingInformation: string[]
): number {
  if (requiredInformation.length === 0 || missingInformation.length === 0) return 0;
  let count = 0;
  for (const req of requiredInformation) {
    const r = req.toLowerCase();
    const found = missingInformation.some((m) => {
      const ml = m.toLowerCase();
      return ml.includes(r.slice(0, Math.min(12, r.length))) || r.includes(ml.slice(0, 8));
    });
    if (found) count += 1;
  }
  return count;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
