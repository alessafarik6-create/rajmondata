import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { fetchCompanyImportLeadRowsAdmin } from "@/lib/import-leads-fetch-admin";
import {
  computeLeadSummaryStats,
  type LeadSummaryFilterInput,
  type LeadSummaryOverlayFields,
  type LeadSummaryStats,
} from "@/lib/leads/lead-summary";
import type { OfferPriceRow } from "@/lib/lead-portfolio-value";
import { buildValuationContext } from "@/lib/leads/lead-valuation-service";
import { resolveLeadValuation, type LeadValuationOverlayFields } from "@/lib/leads/lead-valuation";
import { resolveInquiryTypeRule } from "@/lib/ai/inquiry-type-rules";
import { resolveEffectiveInquiryType } from "@/lib/leads/lead-inquiry-type";

type OfferRow = OfferPriceRow & { status?: string };

function overlayFromDoc(data: Record<string, unknown>): LeadSummaryOverlayFields {
  const num = (k: string) => {
    const v = data[k];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  return {
    workflowStatus: String(data.workflowStatus ?? "").trim() || null,
    typ: String(data.typ ?? "").trim() || undefined,
    typ_poptavky: String(data.typ_poptavky ?? "").trim() || undefined,
    type_override: String(data.type_override ?? "").trim() || undefined,
    source_type: String(data.source_type ?? "").trim() || undefined,
    inquiryTypeManual: data.inquiryTypeManual === true,
    manualValueConfirmed: data.manualValueConfirmed === true,
    valuationGrossKc: num("valuationGrossKc"),
    valuationNetKc: num("valuationNetKc"),
    valuationSource: typeof data.valuationSource === "string" ? data.valuationSource : null,
    tagId: typeof data.tagId === "string" ? data.tagId : null,
    orientacniCenaKc: num("orientacniCenaKc"),
    estimatedValue: num("estimatedValue"),
    lastCustomerContactAt: data.lastCustomerContactAt,
    lastCustomerContactType:
      typeof data.lastCustomerContactType === "string" ? data.lastCustomerContactType : null,
    customerContacted:
      typeof data.customerContacted === "boolean" ? data.customerContacted : null,
    receivedAt: data.receivedAt,
    inquiryTimeline: Array.isArray(data.inquiryTimeline)
      ? (data.inquiryTimeline as LeadSummaryOverlayFields["inquiryTimeline"])
      : null,
  };
}

async function loadOverlays(
  db: Firestore,
  companyId: string
): Promise<Map<string, LeadSummaryOverlayFields>> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .limit(5000)
    .get();
  const m = new Map<string, LeadSummaryOverlayFields>();
  for (const doc of snap.docs) {
    m.set(doc.id, overlayFromDoc(doc.data() as Record<string, unknown>));
  }
  return m;
}

async function loadOffers(db: Firestore, companyId: string): Promise<OfferRow[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("inquiry_offers")
    .orderBy("createdAt", "desc")
    .limit(2500)
    .get()
    .catch(async () => {
      return db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("inquiry_offers")
        .limit(2500)
        .get();
    });

  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const leadKey = String(data.leadKey ?? data.importLeadId ?? "").trim() || null;
    return {
      importLeadId: leadKey,
      leadKey,
      priceGross: data.priceGross as number | null | undefined,
      priceNet: data.priceNet as number | null | undefined,
      createdAt: data.createdAt,
      sentAt: data.sentAt,
      status: typeof data.status === "string" ? data.status : undefined,
    };
  });
}

export async function loadLeadSummaryForCompany(
  db: Firestore,
  companyId: string,
  filters: LeadSummaryFilterInput
): Promise<{ stats: LeadSummaryStats; importWarning?: string }> {
  const [{ rows, warning: importWarning }, overlayByKey, offers] = await Promise.all([
    fetchCompanyImportLeadRowsAdmin(db, companyId),
    loadOverlays(db, companyId),
    loadOffers(db, companyId),
  ]);

  const overlayValMap = overlayByKey as Map<string, LeadValuationOverlayFields>;
  const valCtx = await buildValuationContext(db, companyId, rows, overlayValMap);

  const stats = computeLeadSummaryStats(rows, {
    overlayByKey,
    offers,
    filters,
    resolveValuation: (lead, overlay, offer) => {
      const effectiveType = resolveEffectiveInquiryType(lead, overlay);
      const typeRule = resolveInquiryTypeRule(effectiveType, valCtx.typeRules);
      const defaultItem = valCtx.catalogItems.find(
        (i) => i.isDefaultForCategory && i.active
      );
      return resolveLeadValuation({
        lead,
        overlay,
        offer,
        priceRules: valCtx.priceRules,
        catalogItems: valCtx.catalogItems,
        typeRuleName: typeRule.name,
        historicalMedians: valCtx.historicalMedians,
        categoryDefaultGross: defaultItem?.priceGross ?? null,
        useCachedValuation: true,
      });
    },
  });

  return { stats, importWarning };
}

export function parseLeadSummaryFiltersFromSearchParams(
  params: URLSearchParams
): LeadSummaryFilterInput {
  return {
    search: (params.get("q") ?? params.get("search") ?? "").trim(),
    filterTyp: params.get("typ") ?? "",
    filterTag: params.get("tag") ?? "",
    filterContact: (params.get("contact") ?? "") as LeadSummaryFilterInput["filterContact"],
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
  };
}
