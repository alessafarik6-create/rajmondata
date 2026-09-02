/**
 * Sestavení user promptu pro AI z CRM kontextu.
 */

import type { AiInquiryCrmContext } from "@/lib/ai/crm-context-builder";
import { parseInquiryFields, fieldKeyLabel } from "@/lib/ai/inquiry-field-parser";

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

  const inquiryText = [ctx.inquiry.message, ctx.inquiry.type, ctx.inquiry.internalNote ?? ""]
    .filter(Boolean)
    .join("\n");
  const parsedFields = parseInquiryFields(inquiryText, ctx.typeRule);

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
  sections.push("=== PARSED INQUIRY FIELDS (deterministic — authoritative) ===");
  sections.push(
    JSON.stringify(
      {
        width_mm: parsedFields.dimensions.widthMm,
        depth_mm: parsedFields.dimensions.depthMm,
        area_m2: parsedFields.dimensions.areaM2,
        roof_material: parsedFields.roofMaterial,
        quantity: parsedFields.quantity,
        satisfied_required: parsedFields.satisfiedRequired.map(fieldKeyLabel),
        missing_required: parsedFields.missingRequired.map(fieldKeyLabel),
        note:
          "Pokud jsou všechna povinná pole splněna, missing_information musí být prázdné pole [].",
      },
      null,
      2
    )
  );

  sections.push("");
  sections.push("=== PRODUCT RULES ===");
  sections.push(
    JSON.stringify(
      {
        system_instructions: ctx.typeRule.systemInstructions,
        required_fields: parsedFields.requiredFields.map(fieldKeyLabel),
        optional_fields: parsedFields.optionalFields.map(fieldKeyLabel),
        ignored_fields: parsedFields.ignoredFields.map(fieldKeyLabel),
        default_quantity: parsedFields.quantity,
        required_information: ctx.typeRule.requiredInformation,
        optional_information: ctx.typeRule.optionalInformation,
        ignored_information: ctx.typeRule.ignoredInformation,
        quote_rules: ctx.typeRule.quoteRules,
        strict_rules: [
          "Only fields listed in required_fields may appear in missing_information.",
          "Optional fields must never be treated as required.",
          "Ignored fields must never be requested.",
          "If all required fields are present, generate the quote draft instead of asking for more information.",
          "Do missing_information NIKDY neuváděj položky z ignored_information.",
        ],
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

  const cats = ctx.aiSettings.instructionCategories;
  if (cats && (cats.quotes || cats.documents || cats.communication)) {
    sections.push("");
    sections.push("=== INSTRUCTION CATEGORIES ===");
    sections.push(
      JSON.stringify(
        {
          quotes: cats.quotes ?? "",
          documents: cats.documents ?? "",
          communication: cats.communication ?? "",
        },
        null,
        2
      )
    );
  }

  if (ctx.priceRules.length > 0) {
    sections.push("");
    sections.push("=== ACTIVE PRICE RULES (backend calculates — do not invent prices) ===");
    sections.push(
      JSON.stringify(
        ctx.priceRules.slice(0, 40).map((r) => ({
          name: r.name,
          inquiry_type: r.inquiryType ?? null,
          calculation_type: r.calculationType,
          product_name_pattern: r.productNamePattern ?? null,
          catalog_id: r.catalogId ?? null,
          product_id: r.productId ?? null,
          note: "Cenu vypočítá backend podle těchto pravidel.",
        })),
        null,
        2
      )
    );
  }

  if (ctx.knowledgeHits.length > 0) {
    sections.push("");
    sections.push("=== COMPANY KNOWLEDGE (retrieved excerpts) ===");
    sections.push(
      JSON.stringify(
        ctx.knowledgeHits.map((k) => ({
          document: k.documentTitle,
          excerpt: k.text.slice(0, 700),
          relevance: k.score,
        })),
        null,
        2
      )
    );
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
          label: q.displayLabel,
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
      "Do missing_information patří POUZE položky z required_fields, které nejsou splněny v PARSED INQUIRY FIELDS.",
      "Volitelná pole (optional_fields) nikdy nepatří do missing_information.",
      "Ignorovaná pole (ignored_fields) nikdy nežádej.",
      "Pokud missing_required v PARSED INQUIRY FIELDS je prázdné, customer_reply musí nabídnout návrh nabídky — ne žádat o doplnění.",
      "Počet kusů = 1 je platný default, ne chybějící informace.",
    ].join("\n")
  );

  return sections.join("\n");
}
