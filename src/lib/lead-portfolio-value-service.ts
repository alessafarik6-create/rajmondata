/**
 * Server: načtení dat a výpočet hodnoty poptávek + cache odhadů na overlay.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { AI_GENERATIONS_COLLECTION } from "@/lib/ai/config";
import { isAiFeatureEnabled } from "@/lib/ai/config";
import {
  buildTypeMedianGrossByInquiryType,
  computeLeadPortfolioStats,
  isActiveInquiryLead,
  pickLatestOfferForLead,
  resolveLeadValue,
  type AiGenPriceRow,
  type LeadOverlayValueFields,
  type LeadPortfolioStats,
  type OfferPriceRow,
} from "@/lib/lead-portfolio-value";
import { estimateLeadValueWithAi } from "@/lib/ai/estimate-lead-value-ai";
import { fetchCompanyImportLeadRowsAdmin } from "@/lib/import-leads-fetch-admin";

const MAX_AI_BACKFILL_PER_REQUEST = 3;
const OVERLAY_BACKFILL_MAX = 12;

function overlayFromDoc(data: Record<string, unknown>): LeadOverlayValueFields {
  return {
    workflowStatus: String(data.workflowStatus ?? "").trim() || null,
    stav: String(data.stav ?? "").trim() || null,
    typ: String(data.typ ?? "").trim() || null,
    typ_poptavky: String(data.typ_poptavky ?? "").trim() || null,
    orientacniCenaKc:
      data.orientacniCenaKc != null && Number.isFinite(Number(data.orientacniCenaKc))
        ? Number(data.orientacniCenaKc)
        : null,
    estimatedValueNet:
      data.estimatedValueNet != null && Number.isFinite(Number(data.estimatedValueNet))
        ? Number(data.estimatedValueNet)
        : null,
    estimatedValueGross:
      data.estimatedValueGross != null && Number.isFinite(Number(data.estimatedValueGross))
        ? Number(data.estimatedValueGross)
        : null,
    estimatedValueSource:
      typeof data.estimatedValueSource === "string" ? data.estimatedValueSource : null,
    estimatedValueConfidence:
      data.estimatedValueConfidence != null &&
      Number.isFinite(Number(data.estimatedValueConfidence))
        ? Number(data.estimatedValueConfidence)
        : null,
  };
}

async function loadOverlays(
  db: Firestore,
  companyId: string
): Promise<Map<string, LeadOverlayValueFields>> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .limit(5000)
    .get();
  const m = new Map<string, LeadOverlayValueFields>();
  for (const doc of snap.docs) {
    m.set(doc.id, overlayFromDoc(doc.data() as Record<string, unknown>));
  }
  return m;
}

async function loadOffers(db: Firestore, companyId: string): Promise<OfferPriceRow[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("inquiry_offers")
    .orderBy("createdAt", "desc")
    .limit(2500)
    .get()
    .catch(async () => {
      const fallback = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("inquiry_offers")
        .limit(2500)
        .get();
      return fallback;
    });

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      importLeadId: String(data.importLeadId ?? "").trim() || null,
      priceGross: data.priceGross as number | null | undefined,
      priceNet: data.priceNet as number | null | undefined,
      createdAt: data.createdAt,
      sentAt: data.sentAt,
    };
  });
}

async function loadLatestAiGenerationsByLead(
  db: Firestore,
  companyId: string
): Promise<Map<string, AiGenPriceRow>> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_GENERATIONS_COLLECTION)
    .where("status", "==", "completed")
    .orderBy("createdAt", "desc")
    .limit(400)
    .get()
    .catch(async () => {
      return db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection(AI_GENERATIONS_COLLECTION)
        .where("status", "==", "completed")
        .limit(400)
        .get();
    });

  const m = new Map<string, AiGenPriceRow>();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const leadKey = String(data.leadKey ?? data.importLeadId ?? "").trim();
    if (!leadKey || m.has(leadKey)) continue;
    const validated = data.validatedOutput as Record<string, unknown> | undefined;
    const pricing = validated?.pricing as Record<string, unknown> | undefined;
    m.set(leadKey, {
      leadKey,
      importLeadId: String(data.importLeadId ?? leadKey),
      pricing: pricing
        ? {
            priceGross: pricing.priceGross as number | null,
            priceNet: pricing.priceNet as number | null,
          }
        : null,
      confidence:
        typeof validated?.confidence === "number" ? validated.confidence : null,
    });
  }
  return m;
}

async function persistCachedEstimate(
  db: Firestore,
  companyId: string,
  leadKey: string,
  patch: {
    estimatedValueNet: number;
    estimatedValueGross: number;
    estimatedValueSource: string;
    estimatedValueConfidence: number;
  }
): Promise<void> {
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .doc(leadKey)
    .set(
      {
        ...patch,
        estimatedValueUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export type LeadPortfolioLoadResult = {
  rows: LeadImportRow[];
  stats: LeadPortfolioStats;
  importWarning?: string;
};

export async function loadLeadPortfolioValueForCompany(
  db: Firestore,
  companyId: string,
  opts?: { runBackfill?: boolean }
): Promise<LeadPortfolioLoadResult> {
  const { rows, warning: importWarning } = await fetchCompanyImportLeadRowsAdmin(
    db,
    companyId
  );

  const [overlayByKey, offers, aiGenByLeadKey] = await Promise.all([
    loadOverlays(db, companyId),
    loadOffers(db, companyId),
    loadLatestAiGenerationsByLead(db, companyId),
  ]);

  const leadKeyToType = new Map<string, string>();
  for (const lead of rows) {
    const key = stableImportLeadDocumentId(lead);
    const ov = overlayByKey.get(key);
    leadKeyToType.set(
      key,
      lead.typ || String(ov?.typ ?? ov?.typ_poptavky ?? "").trim()
    );
  }

  const typeMedians = buildTypeMedianGrossByInquiryType(offers, leadKeyToType);

  if (opts?.runBackfill !== false) {
    await backfillMissingLeadEstimates(db, companyId, rows, {
      overlayByKey,
      offers,
      aiGenByLeadKey,
      typeMedians,
    });
    const overlayRefreshed = await loadOverlays(db, companyId);
    overlayRefreshed.forEach((v, k) => overlayByKey.set(k, v));
  }

  const stats = computeLeadPortfolioStats(rows, {
    overlayByKey,
    offers,
    aiGenByLeadKey,
    typeMedians,
  });

  return { rows, stats, importWarning };
}

async function backfillMissingLeadEstimates(
  db: Firestore,
  companyId: string,
  rows: LeadImportRow[],
  ctx: {
    overlayByKey: Map<string, LeadOverlayValueFields>;
    offers: OfferPriceRow[];
    aiGenByLeadKey: Map<string, AiGenPriceRow>;
    typeMedians: Record<string, number>;
  }
): Promise<void> {
  let aiUsed = 0;
  let written = 0;

  for (const lead of rows) {
    if (written >= OVERLAY_BACKFILL_MAX) break;
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

    const full = resolveLeadValue({
      lead,
      overlay,
      offer: pickLatestOfferForLead(ctx.offers, leadKey),
      aiGen: ctx.aiGenByLeadKey.get(leadKey) ?? null,
      typeMedians: ctx.typeMedians,
    });

    if (full.source === "explicit_price" || full.source === "offer") continue;
    if (full.source === "cached_ai_estimate") continue;

    if (
      full.source === "ai_generation" &&
      full.grossKc != null &&
      full.grossKc > 0
    ) {
      await persistCachedEstimate(db, companyId, leadKey, {
        estimatedValueNet: full.netKc ?? full.grossKc,
        estimatedValueGross: full.grossKc,
        estimatedValueSource: "AI_GENERATION",
        estimatedValueConfidence: full.confidence ?? 0.7,
      });
      written++;
      continue;
    }

    if (full.source === "type_statistic" && full.grossKc != null) {
      await persistCachedEstimate(db, companyId, leadKey, {
        estimatedValueNet: full.grossKc,
        estimatedValueGross: full.grossKc,
        estimatedValueSource: "TYPE_STATISTIC",
        estimatedValueConfidence: 0.35,
      });
      written++;
      continue;
    }

    if (
      isAiFeatureEnabled() &&
      aiUsed < MAX_AI_BACKFILL_PER_REQUEST &&
      full.source === "none"
    ) {
      try {
        const est = await estimateLeadValueWithAi(db, companyId, leadKey, lead);
        if (est && est.estimatedPriceGross > 0) {
          await persistCachedEstimate(db, companyId, leadKey, {
            estimatedValueNet: est.estimatedPriceNet,
            estimatedValueGross: est.estimatedPriceGross,
            estimatedValueSource: "AI_ESTIMATE",
            estimatedValueConfidence: est.confidence,
          });
          aiUsed++;
          written++;
        }
      } catch (e) {
        console.warn("[lead-portfolio] AI estimate skipped", leadKey, e);
      }
    }
  }
}
