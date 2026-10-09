import type { LeadImportRow } from "@/lib/lead-import-parse";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { parseLeadPriceKc } from "@/lib/lead-estimated-price";
import {
  leadMatchesContactFilter,
  type LeadContactFilter,
  type LeadOverlayContactFields,
} from "@/lib/lead-contact-status";
import { leadMatchesDateRange, type LeadsFilterState } from "@/lib/leads/lead-filters";
import type { LeadOverlayReceivedFields } from "@/lib/leads/lead-received-date";
import {
  pickLatestOfferForLead,
  priceFromOffer,
  type OfferPriceRow,
} from "@/lib/lead-portfolio-value";
import {
  INQUIRY_WORKFLOW_STATUS_LABELS,
  isInquiryWorkflowStatus,
  type InquiryWorkflowStatus,
} from "@/lib/inquiry-offer-email";
import { resolveEffectiveInquiryType, type LeadInquiryTypeOverlay } from "@/lib/leads/lead-inquiry-type";

export type LeadSummaryOverlayFields = LeadInquiryTypeOverlay &
  LeadOverlayContactFields &
  LeadOverlayReceivedFields & {
    tagId?: string | null;
    estimatedValue?: number | null;
    orientacniCenaKc?: number | null;
    inquiryTimeline?: LeadInquiryTimelineEntry[] | null;
  };

export type LeadInquiryTimelineEntry = {
  at?: string;
  text?: string;
  byUid?: string;
  byName?: string;
};

export type LeadSummaryValueSource = "offer" | "manual" | null;

export type ResolvedLeadSummaryValue = {
  displayKc: number | null;
  source: LeadSummaryValueSource;
  manualKc: number | null;
  offerKc: number | null;
};

export function parseManualEstimatedValueKc(
  lead: LeadImportRow,
  overlay?: LeadSummaryOverlayFields | null
): number | null {
  const fromOverlay = parseLeadPriceKc(overlay?.estimatedValue ?? overlay?.orientacniCenaKc);
  if (fromOverlay != null && fromOverlay > 0) return fromOverlay;
  const fromRow = parseLeadPriceKc(lead.orientacniCenaKc);
  if (fromRow != null && fromRow > 0) return fromRow;
  return null;
}

export function resolveLeadSummaryValue(
  lead: LeadImportRow,
  overlay: LeadSummaryOverlayFields | undefined | null,
  offer: OfferPriceRow | null
): ResolvedLeadSummaryValue {
  const manualKc = parseManualEstimatedValueKc(lead, overlay);
  let offerKc: number | null = null;
  if (offer) {
    const { gross } = priceFromOffer(offer);
    if (gross != null && gross > 0) offerKc = gross;
  }
  if (offerKc != null) {
    return { displayKc: offerKc, source: "offer", manualKc, offerKc };
  }
  if (manualKc != null) {
    return { displayKc: manualKc, source: "manual", manualKc, offerKc: null };
  }
  return { displayKc: null, source: null, manualKc: null, offerKc: null };
}

export function leadSearchBlob(r: LeadImportRow): string {
  return [
    r.jmeno,
    r.telefon,
    r.email,
    r.adresa,
    r.zprava,
    r.typ,
    r.stav,
    r.id,
    r.receivedAtIso,
    r.orientacniCenaKc != null ? String(r.orientacniCenaKc) : "",
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
}

export type SentOfferStub = { status?: string; sentAt?: unknown; updatedAt?: unknown };

export function filterSentOffersForLead(
  offers: (OfferPriceRow & SentOfferStub)[],
  leadKey: string
): SentOfferStub[] {
  return offers.filter((o) => {
    const id = String(o.importLeadId ?? "").trim();
    const lk = String(o.leadKey ?? "").trim();
    const keyMatch = id === leadKey || lk === leadKey;
    return keyMatch && String(o.status ?? "sent") === "sent";
  });
}

export type LeadSummaryFilterInput = Pick<
  LeadsFilterState,
  "search" | "filterTyp" | "filterTag" | "filterContact" | "dateFrom" | "dateTo"
>;

export function leadMatchesSummaryFilters(
  lead: LeadImportRow,
  overlay: LeadSummaryOverlayFields | undefined,
  ctx: {
    filters: LeadSummaryFilterInput;
    sentOffers: SentOfferStub[];
  }
): boolean {
  const q = ctx.filters.search.trim().toLowerCase();
  if (q && !leadSearchBlob(lead).includes(q)) return false;

  const effectiveType = resolveEffectiveInquiryType(lead, overlay);
  if (ctx.filters.filterTyp && effectiveType !== ctx.filters.filterTyp) return false;

  const tag = ctx.filters.filterTag;
  if (tag === "__none__") {
    if (overlay?.tagId) return false;
  } else if (tag && overlay?.tagId !== tag) return false;

  const contact = ctx.filters.filterContact as LeadContactFilter;
  if (
    contact &&
    !leadMatchesContactFilter(contact, overlay, ctx.sentOffers as Parameters<
      typeof leadMatchesContactFilter
    >[2])
  ) {
    return false;
  }

  if (
    !leadMatchesDateRange(
      lead,
      overlay,
      ctx.filters.dateFrom,
      ctx.filters.dateTo
    )
  ) {
    return false;
  }

  return true;
}

export type LeadSummaryByTypeRow = {
  type: string;
  count: number;
  value: number;
};

export type LeadSummaryByStatusRow = {
  status: string;
  label: string;
  count: number;
};

export type LeadSummaryStats = {
  count: number;
  estimatedValue: number;
  averageValue: number | null;
  withoutValue: number;
  byType: LeadSummaryByTypeRow[];
  byStatus: LeadSummaryByStatusRow[];
};

function workflowStatusForLead(overlay?: LeadSummaryOverlayFields): InquiryWorkflowStatus {
  const ws = overlay?.workflowStatus;
  if (ws && isInquiryWorkflowStatus(ws)) return ws;
  return "nova";
}

export function computeLeadSummaryStats(
  rows: LeadImportRow[],
  ctx: {
    overlayByKey: Map<string, LeadSummaryOverlayFields>;
    offers: (OfferPriceRow & SentOfferStub)[];
    filters: LeadSummaryFilterInput;
  }
): LeadSummaryStats {
  const byTypeMap = new Map<string, { count: number; value: number }>();
  const byStatusMap = new Map<string, number>();

  let count = 0;
  let sumValue = 0;
  let valuedCount = 0;
  let withoutValue = 0;

  for (const lead of rows) {
    const leadKey = stableImportLeadDocumentId(lead);
    const overlay = ctx.overlayByKey.get(leadKey);
    const sent = filterSentOffersForLead(ctx.offers, leadKey);

    if (
      !leadMatchesSummaryFilters(lead, overlay, {
        filters: ctx.filters,
        sentOffers: sent,
      })
    ) {
      continue;
    }

    count++;
    const ws = workflowStatusForLead(overlay);
    byStatusMap.set(ws, (byStatusMap.get(ws) ?? 0) + 1);

    const effectiveType = resolveEffectiveInquiryType(lead, overlay);
    const offer = pickLatestOfferForLead(ctx.offers, leadKey);
    const resolved = resolveLeadSummaryValue(lead, overlay, offer);

    const typeBucket = byTypeMap.get(effectiveType) ?? { count: 0, value: 0 };
    typeBucket.count++;
    if (resolved.displayKc != null && resolved.displayKc > 0) {
      typeBucket.value += resolved.displayKc;
      sumValue += resolved.displayKc;
      valuedCount++;
    } else {
      withoutValue++;
    }
    byTypeMap.set(effectiveType, typeBucket);
  }

  const byType: LeadSummaryByTypeRow[] = [...byTypeMap.entries()]
    .map(([type, v]) => ({
      type,
      count: v.count,
      value: Math.round(v.value * 100) / 100,
    }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.type.localeCompare(b.type, "cs"));

  const byStatus: LeadSummaryByStatusRow[] = [...byStatusMap.entries()]
    .map(([status, c]) => ({
      status,
      label: isInquiryWorkflowStatus(status)
        ? INQUIRY_WORKFLOW_STATUS_LABELS[status]
        : status,
      count: c,
    }))
    .sort((a, b) => b.count - a.count);

  const averageValue =
    valuedCount > 0 ? Math.round((sumValue / valuedCount) * 100) / 100 : null;

  return {
    count,
    estimatedValue: Math.round(sumValue * 100) / 100,
    averageValue,
    withoutValue,
    byType,
    byStatus,
  };
}

export function parseEstimatedValueInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseLeadPriceKc(trimmed);
  if (n == null) return null;
  if (n === 0) return 0;
  return n;
}
