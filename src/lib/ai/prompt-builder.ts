/**
 * Sestavení user promptu pro AI z CRM kontextu.
 */

import type { AiInquiryCrmContext } from "@/lib/ai/crm-context-builder";

function sanitizeUntrustedText(raw: string, maxLen = 8000): string {
  return raw
    .replace(/\0/g, "")
    .slice(0, maxLen)
    .trim();
}

export function buildInquiryQuoteUserPrompt(ctx: AiInquiryCrmContext): string {
  const productsForAi = ctx.products.map((p) => ({
    catalog_id: p.catalogId,
    catalog_name: p.catalogName,
    product_id: p.productId,
    name: p.name,
    category: p.category ?? null,
    short_description: p.shortDescription ?? null,
    price_kc: p.price,
    note: p.note ?? null,
  }));

  const payload = {
    company_name: ctx.companyName,
    lead_key: ctx.leadKey,
    inquiry: {
      customer_name: ctx.inquiry.name,
      customer_email: ctx.inquiry.email,
      customer_phone: ctx.inquiry.phone,
      customer_address: ctx.inquiry.address,
      inquiry_type: ctx.inquiry.type,
      estimated_price_kc: ctx.inquiry.estimatedPriceKc,
      received_at: ctx.inquiry.receivedAtIso,
      workflow_status: ctx.inquiry.workflowStatus,
      internal_note: ctx.inquiry.internalNote,
    },
    customer_history: ctx.customer
      ? {
          customer_id: ctx.customer.customerId,
          display_name: ctx.customer.displayName,
          notes: ctx.customer.notes,
          recent_jobs: ctx.customer.recentJobs,
        }
      : null,
    previous_offers: ctx.offerHistory.map((o) => ({
      id: o.id,
      status: o.status,
      subject: o.subject,
      price_net_kc: o.priceNet,
      price_gross_kc: o.priceGross,
      sent_at: o.sentAtIso,
    })),
    product_catalog: productsForAi,
    CUSTOMER_INQUIRY: sanitizeUntrustedText(ctx.inquiry.message),
  };

  return [
    "Analyzuj následující CRM kontext a připrav návrh nabídky.",
    "Používej pouze product_id a catalog_id z product_catalog.",
    "Ceny v product_catalog jsou autoritativní reference — do výstupu je nepiš.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
