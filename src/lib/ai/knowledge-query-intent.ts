/**
 * Detekce intentu dotazu do znalostní báze vs. CRM search.
 */

import { isLikelyExactSearch } from "@/lib/search/query-parser-deterministic";
import type { SearchIntent } from "@/lib/search/types";

export type KnowledgeQueryIntent = {
  intent: "knowledge_question" | "crm_search";
  query: string;
  preferredSources: ("knowledge" | "crm" | "pricing" | "quotes")[];
  needsVisualContext: boolean;
  preferredCategories: string[];
};

const KNOWLEDGE_QUESTION_RE =
  /\b(jak|proc|proč|kde|co\s+znamena|co\s+znamená|jak\s+je|jak\s+se|jak\s+vypad|jaky\s+je|jaký\s+je|postup|montaz|montáž|navod|návod|schema|schéma|nakres|nákres|vykres|výkres|ukaz|ukaž|spoj|detail|nastavit|funguje)\b/i;

const VISUAL_RE =
  /\b(jak\s+vypad|ukaz|ukaž|schema|schéma|nakres|nákres|vykres|výkres|obrazek|obrázek|fotka|detail\s+spoje)\b/i;

const PRICING_RE = /\b(kolik\s+stoji|kolik\s+stojí|cena|cenik|ceník|kč|kc\b)\b/i;

const QUOTES_RE = /\b(jak\s+jsme\s+to\s+nab|nabidk|nabídk|priklad\s+nab|příklad\s+nab)\b/i;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function parseKnowledgeQueryIntent(
  rawQuery: string,
  searchIntent?: Partial<SearchIntent>
): KnowledgeQueryIntent {
  const q = rawQuery.trim();

  if (!q) {
    return {
      intent: "crm_search",
      query: q,
      preferredSources: ["crm"],
      needsVisualContext: false,
      preferredCategories: [],
    };
  }

  if (searchIntent && isLikelyExactSearch(searchIntent as SearchIntent)) {
    return {
      intent: "crm_search",
      query: q,
      preferredSources: ["crm"],
      needsVisualContext: false,
      preferredCategories: [],
    };
  }

  if (searchIntent?.documentNumber || searchIntent?.entityListing) {
    return {
      intent: "crm_search",
      query: q,
      preferredSources: ["crm"],
      needsVisualContext: false,
      preferredCategories: [],
    };
  }

  const n = normalize(q);
  const isKnowledge = KNOWLEDGE_QUESTION_RE.test(n);
  const needsVisual = VISUAL_RE.test(n);
  const isPricing = PRICING_RE.test(n);
  const isQuotes = QUOTES_RE.test(n);

  if (isKnowledge && !isPricing) {
    const preferredCategories = ["technical", "installation", "products", "general"];
    if (needsVisual) {
      preferredCategories.unshift("installation", "technical");
    }
    return {
      intent: "knowledge_question",
      query: q,
      preferredSources: isQuotes ? ["quotes", "knowledge"] : ["knowledge"],
      needsVisualContext: needsVisual,
      preferredCategories,
    };
  }

  if (isPricing) {
    return {
      intent: "crm_search",
      query: q,
      preferredSources: ["pricing", "crm"],
      needsVisualContext: false,
      preferredCategories: ["pricing"],
    };
  }

  return {
    intent: "crm_search",
    query: q,
    preferredSources: ["crm"],
    needsVisualContext: false,
    preferredCategories: [],
  };
}

export function isKnowledgeQuestionQuery(
  rawQuery: string,
  searchIntent?: Partial<SearchIntent>
): boolean {
  return parseKnowledgeQueryIntent(rawQuery, searchIntent).intent === "knowledge_question";
}
