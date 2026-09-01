/**
 * Validace strukturovaného výstupu AI pro návrh nabídky.
 */

import { z } from "zod";
import type { AiQuoteModelOutput } from "@/lib/ai/types";

export const AiQuoteItemSchema = z.object({
  catalog_id: z.string().min(1),
  product_id: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().finite().positive(),
  unit: z.string().optional(),
  discount: z.number().finite().min(0).max(100).optional(),
  reason: z.string().min(1),
});

export const AiQuoteResponseSchema = z.object({
  summary: z.string(),
  customer_requirements: z.array(z.string()),
  missing_information: z.array(z.string()),
  recommended_items: z.array(AiQuoteItemSchema),
  internal_notes: z.string(),
  customer_reply: z.string(),
  confidence: z.number().finite().min(0).max(1),
});

export function parseAiQuoteModelOutput(raw: unknown): AiQuoteModelOutput {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    const jsonStart = t.indexOf("{");
    const jsonEnd = t.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(t.slice(jsonStart, jsonEnd + 1));
    } else {
      parsed = JSON.parse(t);
    }
  }
  return AiQuoteResponseSchema.parse(parsed) as AiQuoteModelOutput;
}

/**
 * JSON schema pro OpenAI Structured Outputs (strict: true).
 * Každý klíč v `properties` MUSÍ být uveden v `required` — jinak OpenAI vrátí HTTP 400.
 * @see https://platform.openai.com/docs/guides/structured-outputs
 */
export const AI_QUOTE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    customer_requirements: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    recommended_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          catalog_id: { type: "string" },
          product_id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          discount: { type: "number" },
          reason: { type: "string" },
        },
        required: [
          "catalog_id",
          "product_id",
          "name",
          "quantity",
          "unit",
          "discount",
          "reason",
        ],
      },
    },
    internal_notes: { type: "string" },
    customer_reply: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "summary",
    "customer_requirements",
    "missing_information",
    "recommended_items",
    "internal_notes",
    "customer_reply",
    "confidence",
  ],
} as const;

/** Ověří, že schema splňuje pravidla OpenAI strict mode (volá se z test scriptu). */
export function assertOpenAiStrictSchemaValid(schema: {
  properties?: Record<string, unknown>;
  required?: readonly string[];
}): void {
  const props = Object.keys(schema.properties ?? {});
  const req = new Set(schema.required ?? []);
  for (const key of props) {
    if (!req.has(key)) {
      throw new Error(
        `OpenAI strict schema: property "${key}" chybí v required`
      );
    }
  }
}
