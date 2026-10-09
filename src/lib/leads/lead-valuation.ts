/**
 * Deterministické ocenění poptávky — priorita zdrojů, metadata ke každé částce.
 */

import type { LeadImportRow } from "@/lib/lead-import-parse";
import { parseLeadPriceKc } from "@/lib/lead-estimated-price";
import type { AiPriceRuleDoc, AiProductCatalogItemDoc } from "@/lib/ai/ai-center-types";
import { runPriceEngine } from "@/lib/ai/price-engine";
import { parseInquiryDimensions } from "@/lib/ai/dimension-parser";
import { resolveEffectiveInquiryType, type LeadInquiryTypeOverlay } from "@/lib/leads/lead-inquiry-type";
import {
  normalizeInquiryTypeKey,
  pickLatestOfferForLead,
  priceFromOffer,
  type OfferPriceRow,
} from "@/lib/lead-portfolio-value";

export type LeadValuationSource =
  | "offer"
  | "manual_confirmed"
  | "price_rules"
  | "historical_median"
  | "catalog"
  | "category_default"
  | "cached"
  | "none";

export type LeadValuationOverlayFields = LeadInquiryTypeOverlay & {
  estimatedValue?: number | null;
  orientacniCenaKc?: number | null;
  manualValueConfirmed?: boolean;
  valuationGrossKc?: number | null;
  valuationNetKc?: number | null;
  valuationSource?: string | null;
  valuationMethod?: string | null;
  valuationConfidence?: number | null;
  valuationComputedAt?: string | null;
  valuationNote?: string | null;
  aiSuggestedType?: string | null;
  aiTypeReviewRequired?: boolean;
};

export type LeadValuationResult = {
  grossKc: number | null;
  netKc: number | null;
  source: LeadValuationSource;
  method: string;
  confidence: number | null;
  note: string | null;
  /** Pro souhrn — každá poptávka právě jednou. */
  bucket: "offer" | "manual" | "ai_estimate" | "unvalued";
};

export type HistoricalMedianMap = Record<string, number>;

function roundKc(n: number): number {
  return Math.round(n * 100) / 100;
}

function inquiryText(lead: LeadImportRow, overlay?: LeadValuationOverlayFields | null): string {
  return [lead.zprava, lead.adresa, lead.typ].filter(Boolean).join("\n");
}

function catalogItemActive(item: AiProductCatalogItemDoc, now = new Date()): boolean {
  if (!item.active) return false;
  if (item.validFrom) {
    const t = Date.parse(item.validFrom);
    if (!Number.isNaN(t) && now.getTime() < t) return false;
  }
  if (item.validTo) {
    const t = Date.parse(item.validTo);
    if (!Number.isNaN(t) && now.getTime() > t) return false;
  }
  return item.priceGross > 0;
}

function normalizeCat(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

function catalogMatchesCategory(item: AiProductCatalogItemDoc, effectiveType: string): boolean {
  const cat = normalizeCat(item.category);
  const typ = normalizeCat(effectiveType);
  if (!cat || !typ) return false;
  return typ.includes(cat) || cat.includes(typ) || normalizeInquiryTypeKey(typ) === normalizeInquiryTypeKey(cat);
}

export function matchCatalogItem(
  items: AiProductCatalogItemDoc[],
  effectiveType: string,
  text: string
): AiProductCatalogItemDoc | null {
  const dims = parseInquiryDimensions(text);
  const candidates = items.filter(
    (i) => catalogItemActive(i) && catalogMatchesCategory(i, effectiveType)
  );
  if (!candidates.length) return null;

  if (dims.areaM2 != null && dims.areaM2 > 0) {
    let best: AiProductCatalogItemDoc | null = null;
    let bestDelta = Infinity;
    for (const item of candidates) {
      if (item.areaM2 != null && item.areaM2 > 0) {
        const d = Math.abs(item.areaM2 - dims.areaM2);
        if (d < bestDelta) {
          bestDelta = d;
          best = item;
        }
        continue;
      }
      const min = item.areaMinM2 ?? null;
      const max = item.areaMaxM2 ?? null;
      if (min != null && max != null && dims.areaM2 >= min && dims.areaM2 <= max) {
        return item;
      }
    }
    if (best && bestDelta <= 15) return best;
  }

  const def = candidates.find((i) => i.isDefaultForCategory);
  if (def) return def;
  return null;
}

export function buildHistoricalMedianByType(
  offers: OfferPriceRow[],
  leadKeyToEffectiveType: Map<string, string>,
  maxAgeDays: number
): HistoricalMedianMap {
  const buckets = new Map<string, number[]>();
  const cutoff = Date.now() - maxAgeDays * 86400000;

  for (const o of offers) {
    const leadKey = String(o.importLeadId ?? o.leadKey ?? "").trim();
    if (!leadKey) continue;
    const { gross } = priceFromOffer(o);
    if (gross == null || gross <= 0) continue;
    const sentMs =
      typeof o.sentAt === "object" && o.sentAt && "toMillis" in o.sentAt
        ? (o.sentAt as { toMillis: () => number }).toMillis()
        : 0;
    if (sentMs > 0 && sentMs < cutoff) continue;
    const typeKey = normalizeInquiryTypeKey(leadKeyToEffectiveType.get(leadKey) ?? "");
    const arr = buckets.get(typeKey) ?? [];
    arr.push(gross);
    buckets.set(typeKey, arr);
  }

  const out: HistoricalMedianMap = {};
  for (const [k, arr] of buckets) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    out[k] =
      arr.length % 2 === 1 ? arr[mid]! : roundKc((arr[mid - 1]! + arr[mid]!) / 2);
  }
  return out;
}

export function resolveLeadValuation(params: {
  lead: LeadImportRow;
  overlay?: LeadValuationOverlayFields | null;
  offer: OfferPriceRow | null;
  priceRules?: AiPriceRuleDoc[];
  catalogItems?: AiProductCatalogItemDoc[];
  typeRuleName?: string;
  historicalMedians?: HistoricalMedianMap;
  categoryDefaultGross?: number | null;
  useCachedValuation?: boolean;
}): LeadValuationResult {
  const overlay = params.overlay ?? null;
  const empty: LeadValuationResult = {
    grossKc: null,
    netKc: null,
    source: "none",
    method: "none",
    confidence: null,
    note: null,
    bucket: "unvalued",
  };

  if (params.offer) {
    const { gross, net } = priceFromOffer(params.offer);
    if (gross != null && gross > 0) {
      return {
        grossKc: gross,
        netKc: net ?? gross,
        source: "offer",
        method: "latest_offer",
        confidence: 0.98,
        note: "Platná cenová nabídka",
        bucket: "offer",
      };
    }
  }

  const manual = parseLeadPriceKc(overlay?.estimatedValue ?? overlay?.orientacniCenaKc);
  if (overlay?.manualValueConfirmed === true && manual != null && manual > 0) {
    return {
      grossKc: manual,
      netKc: manual,
      source: "manual_confirmed",
      method: "manual",
      confidence: 1,
      note: "Ručně potvrzená hodnota",
      bucket: "manual",
    };
  }

  const effectiveType = resolveEffectiveInquiryType(params.lead, overlay);
  const text = inquiryText(params.lead, overlay);

  if (params.useCachedValuation !== false) {
    const cached = parseLeadPriceKc(overlay?.valuationGrossKc);
    const src = String(overlay?.valuationSource ?? "").trim() as LeadValuationSource;
    if (cached != null && cached > 0 && src && src !== "none" && src !== "offer" && src !== "manual_confirmed") {
      return {
        grossKc: cached,
        netKc: parseLeadPriceKc(overlay?.valuationNetKc) ?? cached,
        source: src === "cached" ? "cached" : src,
        method: String(overlay?.valuationMethod ?? "cached"),
        confidence:
          typeof overlay?.valuationConfidence === "number"
            ? overlay.valuationConfidence
            : 0.5,
        note: overlay?.valuationNote ?? null,
        bucket: "ai_estimate",
      };
    }
  }

  const rules = params.priceRules ?? [];
  if (rules.length > 0) {
    const engine = runPriceEngine({
      items: [],
      products: [],
      priceRules: rules,
      inquiryType: effectiveType,
      typeRuleName: params.typeRuleName ?? effectiveType,
      inquiryText: text,
    });
    const net = engine.items.reduce((s, i) => s + i.lineNet, 0);
    if (net > 0) {
      return {
        grossKc: roundKc(net * 1.21),
        netKc: roundKc(net),
        source: "price_rules",
        method: "price_engine",
        confidence: 0.75,
        note: engine.explainability.appliedLines.map((l) => l.expression).join("; ") || null,
        bucket: "ai_estimate",
      };
    }
  }

  const med = params.historicalMedians?.[normalizeInquiryTypeKey(effectiveType)];
  if (med != null && med > 0) {
    return {
      grossKc: med,
      netKc: med,
      source: "historical_median",
      method: "median_by_type",
      confidence: 0.45,
      note: "Medián historických nabídek stejné kategorie",
      bucket: "ai_estimate",
    };
  }

  const catalog = params.catalogItems ?? [];
  const matched = matchCatalogItem(catalog, effectiveType, text);
  if (matched) {
    return {
      grossKc: roundKc(matched.priceGross),
      netKc: roundKc(matched.priceNet ?? matched.priceGross),
      source: "catalog",
      method: `catalog:${matched.modelName}`,
      confidence: matched.isDefaultForCategory ? 0.55 : 0.7,
      note: matched.notes ?? `Ceník: ${matched.modelName}`,
      bucket: "ai_estimate",
    };
  }

  if (params.categoryDefaultGross != null && params.categoryDefaultGross > 0) {
    return {
      grossKc: params.categoryDefaultGross,
      netKc: params.categoryDefaultGross,
      source: "category_default",
      method: "category_default",
      confidence: 0.4,
      note: "Schválená výchozí hodnota kategorie",
      bucket: "ai_estimate",
    };
  }

  if (manual != null && manual > 0) {
    return {
      grossKc: manual,
      netKc: manual,
      source: "manual_confirmed",
      method: "manual_unconfirmed",
      confidence: 0.85,
      note: "Ruční odhad (nepotvrzeno)",
      bucket: "manual",
    };
  }

  return empty;
}

export function pickOfferForValuation(
  offers: OfferPriceRow[],
  leadKey: string
): OfferPriceRow | null {
  return pickLatestOfferForLead(offers, leadKey);
}
