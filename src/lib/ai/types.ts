/**
 * Typy pro AI návrhy nabídek k poptávkám.
 */

import type { InquiryOfferPricing, InquiryVatRate } from "@/lib/inquiry-offer-pricing";
import type { ConfidenceFactors } from "@/lib/ai/confidence-calculator";

export type AiGenerationStatus = "completed" | "failed";

export type AiTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

/** Surový výstup modelu (bez cen — ceny doplní backend). */
export type AiQuoteModelOutput = {
  summary: string;
  customer_requirements: string[];
  missing_information: string[];
  recommended_items: Array<{
    catalog_id: string;
    product_id: string;
    name: string;
    quantity: number;
    unit?: string;
    discount?: number;
    reason: string;
  }>;
  internal_notes: string;
  customer_reply: string;
  confidence: number;
};

export type AiValidatedQuoteItem = {
  catalogId: string;
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPercent: number;
  lineNet: number;
  reason: string;
};

export type AiValidatedQuoteResult = {
  generationId: string;
  summary: string;
  customerRequirements: string[];
  missingInformation: string[];
  recommendedItems: AiValidatedQuoteItem[];
  internalNotes: string;
  customerReply: string;
  confidence: number;
  confidenceFactors?: ConfidenceFactors;
  vatRate: InquiryVatRate;
  pricing: InquiryOfferPricing;
  warnings: string[];
  model: string;
  requestDurationMs: number;
  usage: AiTokenUsage;
};

export type AiQuoteApplyInitial = {
  to?: string;
  bodyText: string;
  priceNet: number | null;
  vatRate: InquiryVatRate;
  internalNote: string | null;
};

export type AiGenerationRecord = {
  id?: string;
  companyId: string;
  leadKey: string;
  importLeadId?: string | null;
  customerId?: string | null;
  createdByUid: string;
  createdAt?: unknown;
  model: string;
  status: AiGenerationStatus;
  inputContextSummary?: Record<string, unknown>;
  aiOutputRaw?: AiQuoteModelOutput | null;
  validatedOutput?: Omit<AiValidatedQuoteResult, "generationId"> | null;
  usage?: AiTokenUsage;
  requestDurationMs?: number | null;
  errorMessage?: string | null;
  usedByUser?: boolean;
  usedAt?: unknown;
  usedByUid?: string | null;
  aiSnapshotAtUse?: Record<string, unknown> | null;
  finalOfferSnapshot?: Record<string, unknown> | null;
  userChanges?: Record<string, { from: unknown; to: unknown }> | null;
  offerSent?: boolean;
  offerSentAt?: unknown;
  offerId?: string | null;
  finalSentSnapshot?: Record<string, unknown> | null;
};
