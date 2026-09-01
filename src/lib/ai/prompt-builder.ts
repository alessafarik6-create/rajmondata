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

function formatProductList(
  products: AiInquiryCrmContext["relevantProducts"],
  label: string
): Record<string, unknown>[] {
  return products.map((p) => ({
    catalog_id: p.catalogId,
    catalog_name: p.catalogName,
    product_id: p.productId,
    name: p.name,
    category: p.category ?? null,
    short_description: p.shortDescription ?? null,
    price_kc: p.price,
    note: p.note ?? null,
    _section: label,
  }));
}

export function buildInquiryQuoteUserPrompt(ctx: AiInquiryCrmContext): string {
  const catalogForAi =
    ctx.relevantProducts.length > 0
      ? formatProductList(ctx.relevantProducts, "relevant")
      : formatProductList(ctx.products, "all");

  const sections: string[] = [];

  sections.push("=== CURRENT INQUIRY ===");
  sections.push(
    JSON.stringify(
      {
        customer_name: ctx.inquiry.name,
        customer_email: ctx.inquiry.email,
        customer_phone: ctx.inquiry.phone,
        customer_address: ctx.inquiry.address,
        inquiry_type: ctx.inquiry.type || ctx.typeRule.name,
        estimated_price_kc: ctx.inquiry.estimatedPriceKc,
        received_at: ctx.inquiry.receivedAtIso,
        workflow_status: ctx.inquiry.workflowStatus,
        internal_note: ctx.inquiry.internalNote,
        CUSTOMER_INQUIRY: sanitizeUntrustedText(ctx.inquiry.message),
      },
      null,
      2
    )
  );

  sections.push("");
  sections.push(`=== INQUIRY TYPE: ${ctx.typeRule.name} ===`);

  sections.push("");
  sections.push("=== PRODUCT RULES ===");
  sections.push(
    JSON.stringify(
      {
        system_instructions: ctx.typeRule.systemInstructions,
        required_information: ctx.typeRule.requiredInformation,
        optional_information: ctx.typeRule.optionalInformation,
        ignored_information: ctx.typeRule.ignoredInformation,
        quote_rules: ctx.typeRule.quoteRules,
        note:
          "Do missing_information NIKDY neuváděj položky z ignored_information. U tohoto typu poptávky je nevyžaduj.",
      },
      null,
      2
    )
  );

  if (ctx.aiSettings.baseInstructions.trim()) {
    sections.push("");
    sections.push("=== COMPANY AI INSTRUCTIONS ===");
    sections.push(ctx.aiSettings.baseInstructions.trim());
  }

  sections.push("");
  sections.push("=== RELEVANT PRODUCTS (authoritative prices — do not output to customer) ===");
  sections.push(JSON.stringify(catalogForAi, null, 2));

  sections.push("");
  sections.push("=== CURRENT CRM PRICES ===");
  sections.push(
    JSON.stringify(
      {
        estimated_inquiry_price_kc: ctx.inquiry.estimatedPriceKc,
        note: "Konečnou cenu vypočítá backend z katalogu. Historické ceny nejsou autoritativní.",
        catalog_products_with_price: catalogForAi.filter(
          (p) => p.price_kc != null && Number.isFinite(Number(p.price_kc))
        ).length,
      },
      null,
      2
    )
  );

  if (ctx.similarQuotes.length > 0) {
    sections.push("");
    sections.push("=== SIMILAR APPROVED QUOTES (examples only — never copy prices) ===");
    sections.push(
      JSON.stringify(
        ctx.similarQuotes.map((q, i) => ({
          example_index: i + 1,
          source: q.source,
          inquiry_type: q.inquiryType,
          status: q.status,
          subject: q.subject,
          body_excerpt: q.bodyExcerpt,
          historical_price_net_kc: q.priceNetKc,
          historical_price_gross_kc: q.priceGrossKc,
          items_summary: q.itemsSummary,
          sent_at: q.sentAtIso,
          relevance_score: q.relevanceScore,
        })),
        null,
        2
      )
    );
  }

  if (ctx.customer) {
    sections.push("");
    sections.push("=== CUSTOMER HISTORY ===");
    sections.push(
      JSON.stringify(
        {
          customer_id: ctx.customer.customerId,
          display_name: ctx.customer.displayName,
          notes: ctx.customer.notes,
          recent_jobs: ctx.customer.recentJobs,
        },
        null,
        2
      )
    );
  }

  if (ctx.offerHistory.length > 0) {
    sections.push("");
    sections.push("=== PREVIOUS OFFERS FOR THIS LEAD ===");
    sections.push(
      JSON.stringify(
        ctx.offerHistory.map((o) => ({
          id: o.id,
          status: o.status,
          subject: o.subject,
          price_net_kc: o.priceNet,
          price_gross_kc: o.priceGross,
          sent_at: o.sentAtIso,
        })),
        null,
        2
      )
    );
  }

  sections.push("");
  sections.push("=== TASK ===");
  sections.push(
    [
      "Analyzuj kontext a připrav návrh nabídky.",
      "Používej pouze catalog_id a product_id z RELEVANT PRODUCTS.",
      "Historické nabídky jsou pouze inspirace struktury a textu — nikdy nekopíruj jejich ceny.",
      "Autoritativní je vždy aktuální ceník CRM (backend spočítá cenu).",
      "Nežádej pole uvedená v ignored_information.",
    ].join("\n")
  );

  return sections.join("\n");
}
