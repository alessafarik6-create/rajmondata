/**
 * Validace AI výstupu a doplnění autoritativních cen z CRM.
 */

import {
  calculateInquiryOfferPricing,
  normalizeInquiryVatRate,
  type InquiryVatRate,
} from "@/lib/inquiry-offer-pricing";
import { getAiMaxDiscountPercent } from "@/lib/ai/config";
import type { AiInquiryCrmContext } from "@/lib/ai/crm-context-builder";
import { parseAiQuoteModelOutput } from "@/lib/ai/inquiry-quote-schema";
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

  const productMap = new Map<string, (typeof ctx.products)[number]>();
  for (const p of ctx.products) {
    productMap.set(productKey(p.catalogId, p.productId), p);
  }

  const warnings: string[] = [];
  const recommendedItems: AiValidatedQuoteItem[] = [];

  for (const item of parsed.recommended_items) {
    const key = productKey(item.catalog_id, item.product_id);
    const product = productMap.get(key);
    if (!product) {
      warnings.push(
        `Položka „${item.name}“ (${item.product_id}) nebyla nalezena v katalogu a byla vynechána.`
      );
      continue;
    }
    if (product.price == null || !Number.isFinite(product.price)) {
      warnings.push(
        `Produkt „${product.name}“ nemá cenu v CRM — položka byla vynechána.`
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

    const quantity = Math.max(0.001, Number(item.quantity));
    const unitPrice = roundMoney(product.price);
    const lineNet = roundMoney(
      unitPrice * quantity * (1 - discountPercent / 100)
    );

    recommendedItems.push({
      catalogId: product.catalogId,
      productId: product.productId,
      name: product.name,
      quantity: roundMoney(quantity),
      unit: String(item.unit ?? "ks").trim() || "ks",
      unitPrice,
      discountPercent: roundMoney(discountPercent),
      lineNet,
      reason: String(item.reason ?? "").trim(),
    });
  }

  const totalNet =
    recommendedItems.length > 0
      ? roundMoney(recommendedItems.reduce((s, i) => s + i.lineNet, 0))
      : null;

  const pricing = calculateInquiryOfferPricing(totalNet, vatRate);

  if (recommendedItems.length === 0 && parsed.missing_information.length === 0) {
    warnings.push(
      "AI nenavrhla žádné platné položky z katalogu. Zkontrolujte chybějící informace nebo doplňte katalog produktů."
    );
  }

  return {
    generationId: meta.generationId,
    summary: parsed.summary.trim(),
    customerRequirements: parsed.customer_requirements.map((s) => s.trim()).filter(Boolean),
    missingInformation: parsed.missing_information.map((s) => s.trim()).filter(Boolean),
    recommendedItems,
    internalNotes: parsed.internal_notes.trim(),
    customerReply: parsed.customer_reply.trim(),
    confidence: Math.min(1, Math.max(0, parsed.confidence)),
    vatRate,
    pricing,
    warnings,
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
