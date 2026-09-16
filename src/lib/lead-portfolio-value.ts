/**
 * Odhad hodnoty aktivních poptávek pro dashboard (priorita zdrojů ceny).
 */

import type { LeadImportRow } from "@/lib/lead-import-parse";
import { parseLeadPriceKc } from "@/lib/lead-estimated-price";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";

export type LeadValueSource =
  | "explicit_price"
  | "offer"
  | "ai_generation"
  | "cached_ai_estimate"
  | "type_statistic"
  | "none";

export type LeadPortfolioBreakdown = {
  explicit_price: number;
  offer: number;
  ai_generation: number;
  cached_ai_estimate: number;
  type_statistic: number;
  none: number;
};

export type LeadPortfolioStats = {
  activeCount: number;
  totalGrossKc: number;
  totalNetKc: number;
  valuedCount: number;
  unvaluedCount: number;
  bySource: LeadPortfolioBreakdown;
  hasEstimatePortion: boolean;
  /** Žádná aktivní poptávka nemá cenu a nelze odhadnout */
  showNotQuantifiedMessage: boolean;
};

export type LeadOverlayValueFields = {
  workflowStatus?: string | null;
  stav?: string | null;
  typ?: string | null;
  typ_poptavky?: string | null;
  orientacniCenaKc?: number | null;
  estimatedValueNet?: number | null;
  estimatedValueGross?: number | null;
  estimatedValueSource?: string | null;
  estimatedValueConfidence?: number | null;
};

export type OfferPriceRow = {
  importLeadId?: string | null;
  priceGross?: number | null;
  priceNet?: number | null;
  createdAt?: unknown;
  sentAt?: unknown;
};

export type AiGenPriceRow = {
  leadKey?: string | null;
  importLeadId?: string | null;
  pricing?: { priceGross?: number | null; priceNet?: number | null } | null;
  confidence?: number | null;
};

function normalizeCs(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

export function normalizeInquiryTypeKey(typ: string): string {
  const n = normalizeCs(typ);
  if (!n) return "obecna";
  if (n.includes("pergol")) return "pergola";
  if (n.includes("zimni") && n.includes("zahrad")) return "zimni_zahrada";
  if (n.includes("montovan") || n.includes("dum") || n.includes("domy")) return "montovany_dum";
  if (n.includes("zasklen")) return "zaskleni";
  if (n.includes("garaz")) return "garaz";
  return n.replace(/\s+/g, "_").slice(0, 48);
}

export function isActiveInquiryLead(params: {
  workflowStatus?: string | null;
  stav?: string | null;
}): boolean {
  const ws = normalizeCs(String(params.workflowStatus ?? ""));
  if (ws === "uzavreno") return false;
  const st = normalizeCs(String(params.stav ?? ""));
  if (st.includes("uzav") || st.includes("zavr") || st.includes("archiv")) return false;
  return true;
}

function tsMs(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "object" && raw !== null && "toMillis" in raw) {
    const fn = (raw as { toMillis: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(raw) || 0;
  }
  if (typeof raw === "string") {
    const p = Date.parse(raw);
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
}

export function pickLatestOfferForLead(
  offers: OfferPriceRow[],
  leadKey: string
): OfferPriceRow | null {
  const matches = offers.filter(
    (o) => String(o.importLeadId ?? "").trim() === leadKey
  );
  if (!matches.length) return null;
  matches.sort(
    (a, b) =>
      Math.max(tsMs(b.sentAt), tsMs(b.createdAt)) -
      Math.max(tsMs(a.sentAt), tsMs(a.createdAt))
  );
  return matches[0] ?? null;
}

export function priceFromOffer(offer: OfferPriceRow): {
  gross: number | null;
  net: number | null;
} {
  const gross = parseLeadPriceKc(offer.priceGross);
  const net = parseLeadPriceKc(offer.priceNet);
  if (gross != null && gross > 0) return { gross, net: net ?? gross };
  if (net != null && net > 0) return { gross: net, net };
  return { gross: null, net: null };
}

export function priceFromAiGeneration(row: AiGenPriceRow): {
  gross: number | null;
  net: number | null;
  confidence: number | null;
} {
  const p = row.pricing;
  const gross = parseLeadPriceKc(p?.priceGross);
  const net = parseLeadPriceKc(p?.priceNet);
  const conf =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? row.confidence
      : null;
  if (gross != null && gross > 0) return { gross, net: net ?? gross, confidence: conf };
  if (net != null && net > 0) return { gross: net, net, confidence: conf };
  return { gross: null, net: null, confidence: conf };
}

export type TypeMedianMap = Record<string, number>;

export function buildTypeMedianGrossFromOffers(offers: OfferPriceRow[]): TypeMedianMap {
  const buckets = new Map<string, number[]>();
  for (const o of offers) {
    const { gross } = priceFromOffer(o);
    if (gross == null || gross <= 0) continue;
    const key = "obecna";
    const arr = buckets.get(key) ?? [];
    arr.push(gross);
    buckets.set(key, arr);
  }
  const out: TypeMedianMap = {};
  for (const [k, arr] of buckets) {
    if (!arr.length) continue;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    out[k] =
      arr.length % 2 === 1 ? arr[mid]! : Math.round((arr[mid - 1]! + arr[mid]!) / 2);
  }
  return out;
}

/** Medián podle typu poptávky z historických nabídek (importLeadId → typ mapuje volající). */
export function buildTypeMedianGrossByInquiryType(
  offers: OfferPriceRow[],
  leadKeyToType: Map<string, string>
): TypeMedianMap {
  const buckets = new Map<string, number[]>();
  for (const o of offers) {
    const leadKey = String(o.importLeadId ?? "").trim();
    if (!leadKey) continue;
    const { gross } = priceFromOffer(o);
    if (gross == null || gross <= 0) continue;
    const typeKey = normalizeInquiryTypeKey(leadKeyToType.get(leadKey) ?? "");
    const arr = buckets.get(typeKey) ?? [];
    arr.push(gross);
    buckets.set(typeKey, arr);
  }
  const out: TypeMedianMap = {};
  for (const [k, arr] of buckets) {
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    out[k] =
      arr.length % 2 === 1 ? arr[mid]! : Math.round((arr[mid - 1]! + arr[mid]!) / 2);
  }
  if (!out.obecna) {
    const all: number[] = [];
    for (const arr of buckets.values()) all.push(...arr);
    if (all.length >= 3) {
      all.sort((a, b) => a - b);
      const mid = Math.floor(all.length / 2);
      out.obecna =
        all.length % 2 === 1
          ? all[mid]!
          : Math.round((all[mid - 1]! + all[mid]!) / 2);
    }
  }
  return out;
}

export type ResolveLeadValueInput = {
  lead: LeadImportRow;
  overlay?: LeadOverlayValueFields | null;
  offer: OfferPriceRow | null;
  aiGen: AiGenPriceRow | null;
  typeMedians: TypeMedianMap;
};

export type ResolvedLeadValue = {
  leadKey: string;
  grossKc: number | null;
  netKc: number | null;
  source: LeadValueSource;
  confidence: number | null;
};

export function resolveLeadValue(input: ResolveLeadValueInput): ResolvedLeadValue {
  const leadKey = stableImportLeadDocumentId(input.lead);
  const overlay = input.overlay ?? null;

  const explicitFromRow = parseLeadPriceKc(input.lead.orientacniCenaKc);
  const explicitFromOverlay = parseLeadPriceKc(overlay?.orientacniCenaKc);
  const explicit = explicitFromRow ?? explicitFromOverlay;
  if (explicit != null && explicit > 0) {
    return {
      leadKey,
      grossKc: explicit,
      netKc: explicit,
      source: "explicit_price",
      confidence: 1,
    };
  }

  if (input.offer) {
    const { gross, net } = priceFromOffer(input.offer);
    if (gross != null && gross > 0) {
      return {
        leadKey,
        grossKc: gross,
        netKc: net ?? gross,
        source: "offer",
        confidence: 0.95,
      };
    }
  }

  if (input.aiGen) {
    const fromGen = priceFromAiGeneration(input.aiGen);
    if (fromGen.gross != null && fromGen.gross > 0) {
      return {
        leadKey,
        grossKc: fromGen.gross,
        netKc: fromGen.net ?? fromGen.gross,
        source: "ai_generation",
        confidence: fromGen.confidence,
      };
    }
  }

  const cachedGross = parseLeadPriceKc(overlay?.estimatedValueGross);
  const cachedNet = parseLeadPriceKc(overlay?.estimatedValueNet);
  if (cachedGross != null && cachedGross > 0) {
    return {
      leadKey,
      grossKc: cachedGross,
      netKc: cachedNet ?? cachedGross,
      source: "cached_ai_estimate",
      confidence:
        typeof overlay?.estimatedValueConfidence === "number"
          ? overlay.estimatedValueConfidence
          : 0.5,
    };
  }

  const typeKey = normalizeInquiryTypeKey(
    input.lead.typ ||
      String(overlay?.typ ?? overlay?.typ_poptavky ?? "").trim()
  );
  const med = input.typeMedians;
  const median = med[typeKey] ?? med.obecna ?? med[normalizeInquiryTypeKey("")];
  if (median != null && median > 0) {
    return {
      leadKey,
      grossKc: median,
      netKc: median,
      source: "type_statistic",
      confidence: 0.35,
    };
  }

  return {
    leadKey,
    grossKc: null,
    netKc: null,
    source: "none",
    confidence: null,
  };
}

export function computeLeadPortfolioStats(
  rows: LeadImportRow[],
  ctx: {
    overlayByKey: Map<string, LeadOverlayValueFields>;
    offers: OfferPriceRow[];
    aiGenByLeadKey: Map<string, AiGenPriceRow>;
    typeMedians: TypeMedianMap;
  }
): LeadPortfolioStats {
  const bySource: LeadPortfolioBreakdown = {
    explicit_price: 0,
    offer: 0,
    ai_generation: 0,
    cached_ai_estimate: 0,
    type_statistic: 0,
    none: 0,
  };

  let activeCount = 0;
  let totalGrossKc = 0;
  let totalNetKc = 0;
  let valuedCount = 0;
  let unvaluedCount = 0;
  let hasEstimatePortion = false;

  for (const lead of rows) {
    const leadKey = stableImportLeadDocumentId(lead);
    const overlay = ctx.overlayByKey.get(leadKey);
    if (
      !isActiveInquiryLead({
        workflowStatus: overlay?.workflowStatus,
        stav: lead.stav ?? overlay?.stav,
      })
    ) {
      continue;
    }
    activeCount++;

    const resolved = resolveLeadValue({
      lead,
      overlay,
      offer: pickLatestOfferForLead(ctx.offers, leadKey),
      aiGen: ctx.aiGenByLeadKey.get(leadKey) ?? null,
      typeMedians: ctx.typeMedians,
    });

    bySource[resolved.source]++;

    if (resolved.grossKc != null && resolved.grossKc > 0) {
      valuedCount++;
      totalGrossKc += resolved.grossKc;
      totalNetKc += resolved.netKc ?? resolved.grossKc;
      if (
        resolved.source === "ai_generation" ||
        resolved.source === "cached_ai_estimate" ||
        resolved.source === "type_statistic"
      ) {
        hasEstimatePortion = true;
      }
    } else {
      unvaluedCount++;
    }
  }

  const showNotQuantifiedMessage = activeCount > 0 && valuedCount === 0;

  return {
    activeCount,
    totalGrossKc: Math.round(totalGrossKc * 100) / 100,
    totalNetKc: Math.round(totalNetKc * 100) / 100,
    valuedCount,
    unvaluedCount,
    bySource,
    hasEstimatePortion,
    showNotQuantifiedMessage,
  };
}

export function formatPortfolioMillionsKc(grossKc: number): string {
  if (!Number.isFinite(grossKc) || grossKc <= 0) return "";
  if (grossKc >= 1_000_000) {
    const mil = grossKc / 1_000_000;
    return `${mil.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} mil. Kč`;
  }
  return "";
}
