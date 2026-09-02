/**
 * Hlavní search pipeline — exact → full-text → semantic + live Firestore fallback.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import type { SearchDebugMeta, SearchIntent, SearchResponse } from "@/lib/search/types";
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
import {
  countCompanySearchIndexRecords,
  countCompanySourceEntities,
  loadLiveSearchCandidates,
} from "@/lib/search/live-search-candidates";
import {
  isEntityListingIntent,
  resolveListingEntityTypes,
  shouldSkipSemanticSearch,
} from "@/lib/search/entity-listing";

export type RunCompanySearchParams = {
  db: Firestore;
  caller: VerifiedCompanyCaller;
  companyId: string;
  query: string;
  filters?: Partial<SearchIntent>;
  limit?: number;
  debug?: boolean;
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

  if (!intent.entityTypes?.length) {
    const listingTypes = resolveListingEntityTypes(intent);
    if (listingTypes?.length) {
      intent.entityTypes = listingTypes;
      intent.entityListing = isEntityListingIntent(intent);
    }
  } else {
    intent.entityListing = isEntityListingIntent(intent);
  }

  let usedAiParser = false;
  if (intent.useAiParser && !isLikelyExactSearch(intent) && !intent.entityListing) {
    const ai = await parseSearchQueryWithAi(q, intent);
    if (ai.used && ai.patch) {
      intent = mergeSearchIntents(intent, ai.patch);
      intent.entityListing = isEntityListingIntent(intent);
      if (intent.entityListing) {
        intent.semanticQuery = null;
      }
      usedAiParser = true;
    }
  }

  const access = await buildSearchAccessContext(params.db, params.caller);
  const limit = params.limit ?? SEARCH_MAX_RESULTS;

  const indexStats = await countCompanySearchIndexRecords(params.db, params.companyId);
  const sourceCounts = params.debug
    ? await countCompanySourceEntities(params.db, params.companyId)
    : {};

  const candidates = new Map<string, Awaited<ReturnType<typeof loadCompanySearchIndex>>[number]>();
  let usedLiveFallback = false;

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

  if (indexStats.total < 5 || intent.entityListing || candidates.size < 5) {
    usedLiveFallback = true;
    const live = await loadLiveSearchCandidates(params.db, params.companyId, {
      entityTypes: intent.entityTypes,
      limitPerType: intent.entityListing ? 120 : 80,
    });
    for (const row of live) {
      candidates.set(`${row.entityType}_${row.entityId}`, row);
    }
  }

  let queryEmbedding: number[] | null = null;
  let usedSemantic = false;
  const needsSemantic =
    !!intent.semanticQuery &&
    !shouldSkipSemanticSearch(intent) &&
    !isLikelyExactSearch(intent);

  if (needsSemantic && intent.semanticQuery) {
    const emb = await computeEmbeddingForText(intent.semanticQuery);
    if (emb.ok) {
      queryEmbedding = emb.embedding;
      usedSemantic = true;
    }
  }

  let exactCount = 0;
  let fulltextCount = 0;
  let semanticCount = 0;
  let listingCount = 0;
  let filteredOutCount = 0;
  let permissionDeniedCount = 0;

  const scored = [];
  for (const entry of candidates.values()) {
    const entryCompanyId = String(entry.companyId ?? "").trim();
    if (entryCompanyId && entryCompanyId !== params.companyId) {
      filteredOutCount++;
      continue;
    }
    if (!canViewSearchIndexEntry(entry, access)) {
      permissionDeniedCount++;
      continue;
    }
    const item = scoreSearchEntry(entry, intent, queryEmbedding);
    if (!item) {
      filteredOutCount++;
      continue;
    }
    if (item.matchReason === "exact_number" || item.matchReason === "exact_ico" || item.matchReason === "exact_email" || item.matchReason === "exact_phone" || item.matchReason === "exact_id") {
      exactCount++;
    } else if (item.matchReason === "filter") {
      listingCount++;
    } else if (item.matchReason === "semantic") {
      semanticCount++;
    } else {
      fulltextCount++;
    }
    scored.push(item);
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit);

  const meta: SearchDebugMeta = {
    companyId: params.companyId,
    indexTotal: indexStats.total,
    indexByType: indexStats.byType,
    sourceCounts,
    candidatesTotal: candidates.size,
    usedLiveFallback,
    exactCount,
    fulltextCount,
    semanticCount,
    listingCount,
    filteredOutCount,
    permissionDeniedCount,
    finalCount: results.length,
  };

  logSearchDebug(q, intent, meta);

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
      entityListing: intent.entityListing,
    },
    results,
    grouped: groupSearchResults(results),
    tookMs: Date.now() - started,
    usedSemantic,
    usedAiParser,
    total: results.length,
    meta: params.debug ? meta : undefined,
  };
}

function logSearchDebug(query: string, intent: SearchIntent, meta: SearchDebugMeta): void {
  console.info("[company/search]", {
    query: query.slice(0, 120),
    companyId: meta.companyId,
    entityTypes: intent.entityTypes,
    entityListing: intent.entityListing,
    semanticQuery: intent.semanticQuery ? "(set)" : null,
    indexTotal: meta.indexTotal,
    indexByType: meta.indexByType,
    sourceCounts: meta.sourceCounts,
    candidatesTotal: meta.candidatesTotal,
    usedLiveFallback: meta.usedLiveFallback,
    exactCount: meta.exactCount,
    fulltextCount: meta.fulltextCount,
    semanticCount: meta.semanticCount,
    listingCount: meta.listingCount,
    filteredOutCount: meta.filteredOutCount,
    permissionDeniedCount: meta.permissionDeniedCount,
    finalCount: meta.finalCount,
  });
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
    total: 0,
  };
}
