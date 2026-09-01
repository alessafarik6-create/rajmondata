/**
 * Výpočet důvěryhodnosti AI návrhu na backendu (ne náhodné číslo z modelu).
 */

import type { AiInquiryTypeRuleDoc } from "@/lib/ai/ai-settings-types";
import type { SimilarQuoteExample } from "@/lib/ai/similar-quotes-retriever";
import type { AiCrmProductRef } from "@/lib/ai/crm-context-builder";

export type ConfidenceFactors = {
  modelConfidence: number;
  similarQuotesCount: number;
  hasCatalogProducts: boolean;
  allProductsPriced: boolean;
  missingRequiredCount: number;
  invalidProductCount: number;
  hasEstimatedPrice: boolean;
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
  invalidProductCount: number;
  hasEstimatedPrice: boolean;
}): ConfidenceFactors {
  const reasons: string[] = [];
  let score = clamp01(params.modelConfidence);

  const similarCount = params.similarQuotes.length;
  if (similarCount >= 3) {
    score += 0.12;
    reasons.push(`Nalezeno ${similarCount} podobných historických nabídek.`);
  } else if (similarCount >= 1) {
    score += 0.06;
    reasons.push(`Nalezena ${similarCount} podobná historická nabídka.`);
  } else {
    score -= 0.1;
    reasons.push("Chybí podobné schválené historické nabídky.");
  }

  const catalog = params.relevantProducts.length > 0 ? params.relevantProducts : params.products;
  const hasCatalog = catalog.length > 0;
  if (!hasCatalog) {
    score -= 0.2;
    reasons.push("Katalog produktů je prázdný nebo neodpovídá typu poptávky.");
  } else {
    score += 0.05;
  }

  const priced = catalog.filter((p) => p.price != null && Number.isFinite(p.price));
  const allPriced = hasCatalog && priced.length === catalog.length;
  if (!allPriced && hasCatalog) {
    score -= 0.08;
    reasons.push("Některé relevantní produkty nemají cenu v CRM.");
  } else if (allPriced) {
    score += 0.05;
  }

  const missingRequired = estimateMissingRequired(
    params.typeRule.requiredInformation,
    params.missingInformation
  );
  if (missingRequired > 0) {
    score -= Math.min(0.25, missingRequired * 0.08);
    reasons.push(`Chybí ${missingRequired} povinných údajů dle pravidel typu.`);
  } else if (params.typeRule.requiredInformation.length > 0) {
    score += 0.05;
    reasons.push("Povinné údaje typu poptávky jsou k dispozici.");
  }

  if (params.invalidProductCount > 0) {
    score -= Math.min(0.2, params.invalidProductCount * 0.07);
    reasons.push(`${params.invalidProductCount} navržených položek nebylo v katalogu.`);
  }

  if (params.hasEstimatedPrice) {
    score += 0.03;
  }

  return {
    modelConfidence: clamp01(params.modelConfidence),
    similarQuotesCount: similarCount,
    hasCatalogProducts: hasCatalog,
    allProductsPriced: allPriced,
    missingRequiredCount: missingRequired,
    invalidProductCount: params.invalidProductCount,
    hasEstimatedPrice: params.hasEstimatedPrice,
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
