/**
 * Hlavní search pipeline — exact → full-text → semantic.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import type { SearchIntent, SearchResponse } from "@/lib/search/types";
import {
  loadCompanySearchIndex,
  loadExactKeyMatches,
} from "@/lib/search/index-store";
import {
  buildSearchAccessContext,
  canViewSearchIndexEntry,
  callerCanUseSearch,
} from "@/lib/search/permissions";
import {
  exactKeysFromQuery,
  isLikelyExactSearch,
  parseSearchQueryDeterministic,
} from "@/lib/search/query-parser-deterministic";
import {
  mergeSearchIntents,
  parseSearchQueryWithAi,
} from "@/lib/search/query-parser-ai";
import { computeEmbeddingForText } from "@/lib/search/embeddings";
import { groupSearchResults, scoreSearchEntry } from "@/lib/search/scorer";
import { SEARCH_MAX_RESULTS } from "@/lib/search/config";

export type RunCompanySearchParams = {
  db: Firestore;
  caller: VerifiedCompanyCaller;
  companyId: string;
  query: string;
  filters?: Partial<SearchIntent>;
  limit?: number;
};

export async function runCompanySearch(
  params: RunCompanySearchParams
): Promise<SearchResponse> {
  const started = Date.now();
  const q = params.query.trim();

  if (!callerCanUseSearch(params.caller)) {
    return emptyResponse(q, started);
  }

  if (!q) {
    return emptyResponse(q, started);
  }

  let intent = parseSearchQueryDeterministic(q);
  if (params.filters) {
    intent = { ...intent, ...params.filters, rawQuery: q };
  }

  let usedAiParser = false;
  if (intent.useAiParser && !isLikelyExactSearch(intent)) {
    const ai = await parseSearchQueryWithAi(q, intent);
    if (ai.used && ai.patch) {
      intent = mergeSearchIntents(intent, ai.patch);
      usedAiParser = true;
    }
  }

  const access = await buildSearchAccessContext(params.db, params.caller);
  const limit = params.limit ?? SEARCH_MAX_RESULTS;

  const candidates = new Map<string, Awaited<ReturnType<typeof loadCompanySearchIndex>>[number]>();

  if (isLikelyExactSearch(intent) || intent.documentNumber) {
    const keys = exactKeysFromQuery(intent.documentNumber ?? q);
    for (const key of keys) {
      const exactHits = await loadExactKeyMatches(params.db, params.companyId, key, 30);
      for (const hit of exactHits) {
        candidates.set(`${hit.entityType}_${hit.entityId}`, hit);
      }
    }
  }

  const bulk = await loadCompanySearchIndex(params.db, params.companyId);
  for (const row of bulk) {
    candidates.set(`${row.entityType}_${row.entityId}`, row);
  }

  let queryEmbedding: number[] | null = null;
  let usedSemantic = false;
  const needsSemantic =
    !!intent.semanticQuery &&
    !isLikelyExactSearch(intent) &&
    (intent.rawQuery.split(/\s+/).length >= 3 || candidates.size < 5);

  if (needsSemantic && intent.semanticQuery) {
    const emb = await computeEmbeddingForText(intent.semanticQuery);
    if (emb.ok) {
      queryEmbedding = emb.embedding;
      usedSemantic = true;
    }
  }

  const scored = [];
  for (const entry of candidates.values()) {
    if (entry.companyId !== params.companyId) continue;
    if (!canViewSearchIndexEntry(entry, access)) continue;
    const item = scoreSearchEntry(entry, intent, queryEmbedding);
    if (item) scored.push(item);
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit);

  return {
    query: q,
    intent: {
      entityTypes: intent.entityTypes,
      supplier: intent.supplier,
      customer: intent.customer,
      jobQuery: intent.jobQuery,
      documentNumber: intent.documentNumber,
      amountMin: intent.amountMin,
      amountMax: intent.amountMax,
      currency: intent.currency,
      dateFrom: intent.dateFrom,
      dateTo: intent.dateTo,
      semanticQuery: intent.semanticQuery,
    },
    results,
    grouped: groupSearchResults(results),
    tookMs: Date.now() - started,
    usedSemantic,
    usedAiParser,
  };
}

function emptyResponse(query: string, started: number): SearchResponse {
  return {
    query,
    intent: {},
    results: [],
    grouped: {},
    tookMs: Date.now() - started,
    usedSemantic: false,
    usedAiParser: false,
  };
}
