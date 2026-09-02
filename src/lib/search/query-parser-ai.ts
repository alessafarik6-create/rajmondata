/**
 * AI parser vyhledávacího dotazu → strukturovaný intent (bez SQL).
 */

import { getOpenAiApiKey } from "@/lib/ai/config";
import { getOpenAiSearchModel } from "@/lib/search/config";
import type { SearchEntityType, SearchIntent } from "@/lib/search/types";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

const SEARCH_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entityTypes: {
      type: ["array", "null"],
      items: {
        type: "string",
        enum: ["document", "invoice", "offer", "inquiry", "job", "customer", "product", "file"],
      },
    },
    supplier: { type: ["string", "null"] },
    customer: { type: ["string", "null"] },
    jobQuery: { type: ["string", "null"] },
    documentNumber: { type: ["string", "null"] },
    amountMin: { type: ["number", "null"] },
    amountMax: { type: ["number", "null"] },
    currency: { type: ["string", "null"], enum: ["CZK", "EUR", null] },
    dateFrom: { type: ["string", "null"] },
    dateTo: { type: ["string", "null"] },
    semanticQuery: { type: ["string", "null"] },
  },
  required: [
    "entityTypes",
    "supplier",
    "customer",
    "jobQuery",
    "documentNumber",
    "amountMin",
    "amountMax",
    "currency",
    "dateFrom",
    "dateTo",
    "semanticQuery",
  ],
} as const;

const SYSTEM_PROMPT = `Jsi parser vyhledávacích dotazů v českém CRM RajmonData.
Převeď dotaz uživatele do JSON intentu pro backend vyhledávání.
Nepiš SQL. Nevymýšlej entity, které nejsou v dotazu.
Datumy vrať jako YYYY-MM-DD. Částky v CZK, pokud není uvedeno EUR.
Pro volné textové dotazy vyplň semanticQuery (zkráceně, bez stop-slov jako "najdi").
Pokud dotaz obsahuje číslo dokladu (např. FV2026-0145), vyplň documentNumber.
entityTypes: null = vše relevantní.`;

export type AiIntentPatch = Partial<
  Pick<
    SearchIntent,
    | "entityTypes"
    | "supplier"
    | "customer"
    | "jobQuery"
    | "documentNumber"
    | "amountMin"
    | "amountMax"
    | "currency"
    | "dateFrom"
    | "dateTo"
    | "semanticQuery"
  >
>;

export async function parseSearchQueryWithAi(
  rawQuery: string,
  baseIntent: SearchIntent
): Promise<{ patch: AiIntentPatch | null; used: boolean }> {
  if (!baseIntent.useAiParser) {
    return { patch: null, used: false };
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { patch: null, used: false };

  const model = getOpenAiSearchModel();
  const started = Date.now();

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Dotaz: ${rawQuery}\nDnešní datum: ${new Date().toISOString().slice(0, 10)}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "search_intent",
            strict: true,
            schema: SEARCH_INTENT_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      console.error("[search/ai-parser] HTTP", res.status, JSON.stringify(data).slice(0, 300));
      return { patch: null, used: false };
    }

    const output = data.output;
    let text = "";
    if (Array.isArray(output)) {
      for (const item of output) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (row.type === "message" && Array.isArray(row.content)) {
          for (const part of row.content) {
            if (!part || typeof part !== "object") continue;
            const p = part as Record<string, unknown>;
            if (typeof p.text === "string") text += p.text;
          }
        }
      }
    }

    if (!text.trim()) return { patch: null, used: false };

    const parsed = JSON.parse(text) as AiIntentPatch;
    console.info("[search/ai-parser] ok", {
      ms: Date.now() - started,
      model,
      queryLen: rawQuery.length,
    });

    return {
      patch: {
        ...parsed,
        entityTypes: Array.isArray(parsed.entityTypes)
          ? (parsed.entityTypes as SearchEntityType[])
          : baseIntent.entityTypes,
      },
      used: true,
    };
  } catch (err) {
    console.error("[search/ai-parser]", errorMessageFromUnknown(err));
    return { patch: null, used: false };
  }
}

export function mergeSearchIntents(base: SearchIntent, patch: AiIntentPatch | null): SearchIntent {
  if (!patch) return base;
  return {
    ...base,
    entityTypes: patch.entityTypes ?? base.entityTypes,
    supplier: patch.supplier ?? base.supplier,
    customer: patch.customer ?? base.customer,
    jobQuery: patch.jobQuery ?? base.jobQuery,
    documentNumber: patch.documentNumber ?? base.documentNumber,
    amountMin: patch.amountMin ?? base.amountMin,
    amountMax: patch.amountMax ?? base.amountMax,
    currency: patch.currency ?? base.currency,
    dateFrom: patch.dateFrom ?? base.dateFrom,
    dateTo: patch.dateTo ?? base.dateTo,
    semanticQuery: patch.semanticQuery ?? base.semanticQuery,
  };
}
