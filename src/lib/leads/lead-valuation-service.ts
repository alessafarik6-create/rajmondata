/**
 * Server: výpočet a uložení ocenění poptávek (bez volného vymýšlení cen AI).
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { fetchCompanyImportLeadRowsAdmin } from "@/lib/import-leads-fetch-admin";
import { loadActiveAiPriceRules } from "@/lib/ai/price-rules-loader";
import {
  loadAiInquiryTypeRules,
  resolveInquiryTypeRule,
} from "@/lib/ai/inquiry-type-rules";
import {
  AI_PRODUCT_CATALOG_ITEMS_COLLECTION,
  defaultAiLeadValuationSettings,
  type AiLeadValuationSettings,
  type AiProductCatalogItemDoc,
} from "@/lib/ai/ai-center-types";
import { AI_SETTINGS_DOC_ID } from "@/lib/ai/ai-settings-types";
import { resolveEffectiveInquiryType } from "@/lib/leads/lead-inquiry-type";
import { readTypeOverride } from "@/lib/leads/lead-type-fields";
import {
  buildHistoricalMedianByType,
  pickOfferForValuation,
  resolveLeadValuation,
  type LeadValuationOverlayFields,
  type LeadValuationResult,
} from "@/lib/leads/lead-valuation";
import { priceFromOffer, type OfferPriceRow } from "@/lib/lead-portfolio-value";
import { generatePlainTextWithOpenAi } from "@/lib/ai/openai-client";
import { isAiFeatureEnabled } from "@/lib/ai/config";
import type { LeadSummaryFilterInput } from "@/lib/leads/lead-summary";
import { leadMatchesSummaryFilters, filterSentOffersForLead } from "@/lib/leads/lead-summary";

function overlayValuationFromDoc(data: Record<string, unknown>): LeadValuationOverlayFields {
  const num = (k: string) => {
    const v = data[k];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  return {
    estimatedValue: num("estimatedValue"),
    orientacniCenaKc: num("orientacniCenaKc"),
    manualValueConfirmed: data.manualValueConfirmed === true,
    valuationGrossKc: num("valuationGrossKc"),
    valuationNetKc: num("valuationNetKc"),
    valuationSource: typeof data.valuationSource === "string" ? data.valuationSource : null,
    valuationMethod: typeof data.valuationMethod === "string" ? data.valuationMethod : null,
    valuationConfidence:
      data.valuationConfidence != null && Number.isFinite(Number(data.valuationConfidence))
        ? Number(data.valuationConfidence)
        : null,
    valuationComputedAt:
      typeof data.valuationComputedAt === "string" ? data.valuationComputedAt : null,
    valuationNote: typeof data.valuationNote === "string" ? data.valuationNote : null,
    type_override: typeof data.type_override === "string" ? data.type_override : undefined,
    source_type: typeof data.source_type === "string" ? data.source_type : undefined,
    inquiryTypeManual: data.inquiryTypeManual === true,
    typ_poptavky: typeof data.typ_poptavky === "string" ? data.typ_poptavky : undefined,
    typ: typeof data.typ === "string" ? data.typ : undefined,
    aiSuggestedType: typeof data.aiSuggestedType === "string" ? data.aiSuggestedType : null,
    aiTypeReviewRequired: data.aiTypeReviewRequired === true,
  };
}

async function loadOverlays(
  db: Firestore,
  companyId: string
): Promise<Map<string, LeadValuationOverlayFields & Record<string, unknown>>> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .limit(5000)
    .get();
  const m = new Map<string, LeadValuationOverlayFields & Record<string, unknown>>();
  for (const doc of snap.docs) {
    m.set(doc.id, overlayValuationFromDoc(doc.data() as Record<string, unknown>));
  }
  return m;
}

async function loadOffers(db: Firestore, companyId: string): Promise<(OfferPriceRow & { status?: string })[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("inquiry_offers")
    .orderBy("createdAt", "desc")
    .limit(2500)
    .get()
    .catch(async () =>
      db.collection(COMPANIES_COLLECTION).doc(companyId).collection("inquiry_offers").limit(2500).get()
    );

  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const leadKey = String(data.leadKey ?? data.importLeadId ?? "").trim() || null;
      if (String(data.status ?? "") === "draft") return null;
      return {
        importLeadId: leadKey,
        leadKey,
        priceGross: data.priceGross as number | null,
        priceNet: data.priceNet as number | null,
        createdAt: data.createdAt,
        sentAt: data.sentAt,
        status: typeof data.status === "string" ? data.status : "sent",
      };
    })
    .filter(Boolean) as (OfferPriceRow & { status?: string })[];
}

async function loadCatalogItems(
  db: Firestore,
  companyId: string
): Promise<AiProductCatalogItemDoc[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_PRODUCT_CATALOG_ITEMS_COLLECTION)
    .where("active", "==", true)
    .limit(200)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AiProductCatalogItemDoc, "id">) }));
}

export async function loadLeadValuationSettings(
  db: Firestore,
  companyId: string
): Promise<AiLeadValuationSettings> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("ai_settings")
    .doc(AI_SETTINGS_DOC_ID)
    .get();
  const raw = (snap.data()?.leadValuation ?? {}) as Partial<AiLeadValuationSettings>;
  return { ...defaultAiLeadValuationSettings(), ...raw };
}

export type ValuateLeadContext = {
  offers: (OfferPriceRow & { status?: string })[];
  priceRules: Awaited<ReturnType<typeof loadActiveAiPriceRules>>;
  catalogItems: AiProductCatalogItemDoc[];
  typeRules: Awaited<ReturnType<typeof loadAiInquiryTypeRules>>;
  settings: AiLeadValuationSettings;
  historicalMedians: ReturnType<typeof buildHistoricalMedianByType>;
};

export async function buildValuationContext(
  db: Firestore,
  companyId: string,
  rows: LeadImportRow[],
  overlayByKey: Map<string, LeadValuationOverlayFields>
): Promise<ValuateLeadContext> {
  const [offers, priceRules, catalogItems, typeRules, settings] = await Promise.all([
    loadOffers(db, companyId),
    loadActiveAiPriceRules(db, companyId),
    loadCatalogItems(db, companyId),
    loadAiInquiryTypeRules(db, companyId),
    loadLeadValuationSettings(db, companyId),
  ]);

  const leadKeyToType = new Map<string, string>();
  for (const lead of rows) {
    const key = stableImportLeadDocumentId(lead);
    const ov = overlayByKey.get(key);
    leadKeyToType.set(key, resolveEffectiveInquiryType(lead, ov));
  }

  const historicalMedians = settings.useHistoricalOffers
    ? buildHistoricalMedianByType(offers, leadKeyToType, settings.maxHistoricalAgeDays)
    : {};

  return {
    offers,
    priceRules: settings.usePriceRules ? priceRules : [],
    catalogItems: settings.useCatalog ? catalogItems : [],
    typeRules,
    settings,
    historicalMedians,
  };
}

export function computeValuationForLead(
  lead: LeadImportRow,
  overlay: LeadValuationOverlayFields | undefined,
  ctx: ValuateLeadContext
): LeadValuationResult {
  const leadKey = stableImportLeadDocumentId(lead);
  const effectiveType = resolveEffectiveInquiryType(lead, overlay);
  const typeRule = resolveInquiryTypeRule(effectiveType, ctx.typeRules);
  const offer = pickOfferForValuation(ctx.offers, leadKey);

  const defaultItem = ctx.catalogItems.find(
    (i) => i.isDefaultForCategory && i.active && catalogMatchesLoose(i.category, effectiveType)
  );

  return resolveLeadValuation({
    lead,
    overlay,
    offer,
    priceRules: ctx.priceRules,
    catalogItems: ctx.catalogItems,
    typeRuleName: typeRule.name,
    historicalMedians: ctx.historicalMedians,
    categoryDefaultGross: defaultItem?.priceGross ?? null,
    useCachedValuation: true,
  });
}

function catalogMatchesLoose(category: string, effectiveType: string): boolean {
  const a = category.toLowerCase();
  const b = effectiveType.toLowerCase();
  return a.includes(b) || b.includes(a);
}

export async function persistLeadValuation(
  db: Firestore,
  companyId: string,
  leadKey: string,
  result: LeadValuationResult
): Promise<void> {
  if (result.source === "offer" || result.source === "manual_confirmed") {
    return;
  }
  if (result.grossKc == null || result.grossKc <= 0) return;

  await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .doc(leadKey)
    .set(
      {
        valuationGrossKc: result.grossKc,
        valuationNetKc: result.netKc ?? result.grossKc,
        valuationSource: result.source,
        valuationMethod: result.method,
        valuationConfidence: result.confidence,
        valuationNote: result.note,
        valuationComputedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export type BatchValuationMode = "filtered" | "missing_value" | "recompute_ai";

export type BatchValuationResult = {
  processed: number;
  valued: number;
  skipped: number;
  errors: { leadKey: string; error: string }[];
};

const BATCH_MAX = 40;

export async function runLeadValuationBatch(
  db: Firestore,
  companyId: string,
  opts: {
    mode: BatchValuationMode;
    filters?: LeadSummaryFilterInput;
    leadKeys?: string[];
  }
): Promise<BatchValuationResult> {
  const { rows } = await fetchCompanyImportLeadRowsAdmin(db, companyId);
  const overlayByKey = await loadOverlays(db, companyId);
  const ctx = await buildValuationContext(db, companyId, rows, overlayByKey);

  let candidates = rows;
  const filters = opts.filters ?? {
    search: "",
    filterTyp: "",
    filterTag: "",
    filterContact: "",
    dateFrom: "",
    dateTo: "",
  };

  if (opts.leadKeys?.length) {
    const set = new Set(opts.leadKeys);
    candidates = rows.filter((r) => set.has(stableImportLeadDocumentId(r)));
  } else if (opts.mode === "filtered") {
    candidates = rows.filter((lead) => {
      const key = stableImportLeadDocumentId(lead);
      const ov = overlayByKey.get(key);
      const sent = filterSentOffersForLead(ctx.offers, key);
      return leadMatchesSummaryFilters(lead, ov as import("@/lib/leads/lead-summary").LeadSummaryOverlayFields, {
        filters,
        sentOffers: sent,
      });
    });
  }

  const out: BatchValuationResult = { processed: 0, valued: 0, skipped: 0, errors: [] };

  for (const lead of candidates.slice(0, BATCH_MAX)) {
    const leadKey = stableImportLeadDocumentId(lead);
    const overlay = overlayByKey.get(leadKey);
    out.processed++;

    if (overlay?.manualValueConfirmed) {
      out.skipped++;
      continue;
    }
    const offer = pickOfferForValuation(ctx.offers, leadKey);
    if (offer && priceFromOffer(offer).gross) {
      out.skipped++;
      continue;
    }
    if (opts.mode === "missing_value") {
      const has =
        (overlay?.valuationGrossKc != null && overlay.valuationGrossKc > 0) ||
        (overlay?.estimatedValue != null && overlay.estimatedValue > 0);
      if (has) {
        out.skipped++;
        continue;
      }
    }
    if (opts.mode === "recompute_ai" && !ctx.settings.allowRecomputeAiEstimates) {
      out.skipped++;
      continue;
    }

    try {
      const result = computeValuationForLead(lead, overlay, {
        ...ctx,
        priceRules: ctx.priceRules,
      });
      if (result.grossKc != null && result.grossKc > 0 && result.bucket === "ai_estimate") {
        await persistLeadValuation(db, companyId, leadKey, result);
        out.valued++;
      } else {
        out.skipped++;
      }
    } catch (e) {
      out.errors.push({
        leadKey,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return out;
}

/** Lehká AI analýza typu — nepřepisuje ruční type_override. */
export async function analyzeLeadTypeWithAi(
  db: Firestore,
  companyId: string,
  leadKey: string,
  lead: LeadImportRow,
  overlay: LeadValuationOverlayFields | undefined
): Promise<void> {
  if (readTypeOverride(overlay)) return;
  if (!isAiFeatureEnabled()) return;

  const typeRules = await loadAiInquiryTypeRules(db, companyId);
  const names = typeRules.map((r) => r.name).join(", ");
  const prompt = `Urči nejvhodnější typ poptávky z: ${names}.
Text: ${(lead.zprava || "").slice(0, 1500)}
Vrať JSON: {"suggestedType":"...","confidence":0-1,"reviewRequired":true/false}`;

  const res = await generatePlainTextWithOpenAi(prompt, {
    instructions: "Vrať jen JSON. Pokud si nejsi jistý, reviewRequired=true.",
  });
  const m = res.outputText.match(/\{[\s\S]*\}/);
  if (!m) return;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const suggested = String(o.suggestedType ?? "").trim();
    if (!suggested) return;
    await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("import_lead_overlays")
      .doc(leadKey)
      .set(
        {
          aiSuggestedType: suggested,
          aiTypeReviewRequired: o.reviewRequired !== false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch {
    /* ignore */
  }
}

export async function valuateNewLeadsAfterImport(
  db: Firestore,
  companyId: string,
  createdLeadKeys: string[]
): Promise<void> {
  const settings = await loadLeadValuationSettings(db, companyId);
  if (!settings.autoValuateOnImport || !createdLeadKeys.length) return;

  const keys = createdLeadKeys.slice(0, 8);
  await runLeadValuationBatch(db, companyId, {
    mode: "missing_value",
    leadKeys: keys,
  });

  const { rows } = await fetchCompanyImportLeadRowsAdmin(db, companyId);
  const overlayByKey = await loadOverlays(db, companyId);
  for (const lead of rows) {
    const key = stableImportLeadDocumentId(lead);
    if (!keys.includes(key)) continue;
    const ov = overlayByKey.get(key);
    if (readTypeOverride(ov)) continue;
    try {
      await analyzeLeadTypeWithAi(db, companyId, key, lead, ov);
    } catch {
      /* best effort */
    }
  }
}
