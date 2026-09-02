/**
 * Skórování a filtrování výsledků vyhledávání.
 */

import type { SearchIntent, SearchMatchReason, SearchResultItem } from "@/lib/search/types";
import type { SearchIndexDoc } from "@/lib/search/types";
import { searchEntityLabel } from "@/lib/search/types";
import { normalizeExactKey, normalizeSearchText } from "@/lib/search/normalize";
import { cosineSimilarity } from "@/lib/search/embeddings";
import { SEARCH_MIN_SEMANTIC_SCORE } from "@/lib/search/config";
import { isEntityListingIntent, meaningfulQueryTokens } from "@/lib/search/entity-listing";

function parseIsoDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function passesFilters(entry: SearchIndexDoc, intent: SearchIntent): boolean {
  if (intent.entityTypes?.length && !intent.entityTypes.includes(entry.entityType)) {
    return false;
  }

  const md = entry.metadata;
  if (intent.supplier) {
    const sup = normalizeSearchText(intent.supplier);
    const hay = normalizeSearchText(`${md.supplier ?? ""} ${entry.searchText}`);
    if (!hay.includes(sup)) return false;
  }
  if (intent.customer) {
    const c = normalizeSearchText(intent.customer);
    const hay = normalizeSearchText(`${md.customer ?? ""} ${entry.title} ${entry.searchText}`);
    if (!hay.includes(c)) return false;
  }
  if (intent.jobQuery) {
    const jq = normalizeSearchText(intent.jobQuery);
    const hay = normalizeSearchText(`${md.jobName ?? ""} ${md.jobId ?? ""} ${entry.searchText}`);
    if (!hay.includes(jq)) return false;
  }

  const amount = md.amountGross ?? md.amountNet ?? null;
  if (amount != null) {
    if (intent.amountMin != null && amount < intent.amountMin) return false;
    if (intent.amountMax != null && amount > intent.amountMax) return false;
  }

  const issueMs = parseIsoDate(md.issueDate);
  const fromMs = parseIsoDate(intent.dateFrom);
  const toMs = parseIsoDate(intent.dateTo);
  if (fromMs != null && issueMs != null && issueMs < fromMs) return false;
  if (toMs != null && issueMs != null && issueMs > toMs + 86_400_000) return false;

  return true;
}

function tokenOverlapScore(query: string, entry: SearchIndexDoc): number {
  const qTokens = meaningfulQueryTokens(query);
  if (qTokens.length === 0) return 0;
  const hay = normalizeSearchText(`${entry.searchText} ${entry.title} ${entry.subtitle ?? ""} ${entry.keywords.join(" ")}`);
  let hits = 0;
  for (const t of qTokens) {
    if (hay.includes(t)) hits++;
    else if (t.length >= 4) {
      const prefix = t.slice(0, 4);
      if (hay.includes(prefix)) hits += 0.5;
    }
  }
  return hits / qTokens.length;
}

function exactScore(query: string, entry: SearchIndexDoc): { score: number; reason: SearchMatchReason; detail: string } | null {
  const keys = new Set(entry.exactKeys);
  const qKey = normalizeExactKey(query);
  if (qKey && keys.has(qKey)) {
    return { score: 100, reason: "exact_number", detail: "Nalezeno podle přesné shody" };
  }

  const docNum = entry.metadata.documentNumber ?? entry.metadata.invoiceNumber;
  if (docNum && normalizeExactKey(docNum) === qKey) {
    return { score: 100, reason: "exact_number", detail: "Nalezeno podle čísla dokladu" };
  }

  if (entry.metadata.supplierIco && normalizeExactKey(entry.metadata.supplierIco) === qKey) {
    return { score: 95, reason: "exact_ico", detail: "Nalezeno podle IČO" };
  }
  if (entry.metadata.email && normalizeSearchText(entry.metadata.email) === normalizeSearchText(query)) {
    return { score: 95, reason: "exact_email", detail: "Nalezeno podle e-mailu" };
  }
  if (entry.metadata.phone && entry.metadata.phone.replace(/\D/g, "") === query.replace(/\D/g, "")) {
    return { score: 95, reason: "exact_phone", detail: "Nalezeno podle telefonu" };
  }

  return null;
}

function formatDetail(entry: SearchIndexDoc): string | null {
  const parts: string[] = [];
  const md = entry.metadata;
  if (md.issueDate) parts.push(md.issueDate);
  if (md.amountGross != null) {
    parts.push(`${md.amountGross.toLocaleString("cs-CZ")} ${md.currency ?? "Kč"}`);
  }
  if (md.jobName) parts.push(`Zakázka: ${md.jobName}`);
  return parts.length ? parts.join(" · ") : null;
}

export function scoreSearchEntry(
  entry: SearchIndexDoc,
  intent: SearchIntent,
  queryEmbedding: number[] | null
): SearchResultItem | null {
  if (!passesFilters(entry, intent)) return null;

  const q = intent.rawQuery;
  const listing = intent.entityListing || isEntityListingIntent(intent);

  if (listing && intent.entityTypes?.includes(entry.entityType)) {
    return {
      entityType: entry.entityType,
      entityId: entry.entityId,
      title: entry.title,
      subtitle: entry.subtitle,
      detail: formatDetail(entry),
      openUrl: entry.openUrl,
      matchReason: "filter",
      matchDetail: "Seznam entit dle typu",
      score: 55,
      metadata: entry.metadata,
      mimeType: entry.mimeType,
      fileUrl: entry.fileUrl,
    };
  }

  const exact = exactScore(q, entry);
  let score = 0;
  let reason: SearchMatchReason = "full_text";
  let detail = "";

  if (exact) {
    score = exact.score;
    reason = exact.reason;
    detail = exact.detail;
  } else {
    const overlap = tokenOverlapScore(q, entry);
    const qTokens = meaningfulQueryTokens(q);

    if (overlap >= 0.35 || (qTokens.length === 1 && overlap > 0)) {
      score = 40 + overlap * 40;
      reason = "full_text";
      detail = overlap >= 0.8 ? "Shoda v textu nebo metadatech" : "Částečná shoda v textu";
    } else if (queryEmbedding && Array.isArray(entry.embedding) && entry.embedding.length > 0) {
      const sim = cosineSimilarity(queryEmbedding, entry.embedding);
      if (sim >= SEARCH_MIN_SEMANTIC_SCORE) {
        score = 30 + sim * 60;
        reason = "semantic";
        detail = "Významově podobné dotazu";
      } else {
        return null;
      }
    } else if (intent.documentNumber) {
      const dn = normalizeExactKey(intent.documentNumber);
      if (entry.exactKeys.includes(dn)) {
        score = 90;
        reason = "exact_number";
        detail = "Nalezeno podle čísla dokladu";
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  return {
    entityType: entry.entityType,
    entityId: entry.entityId,
    title: entry.title,
    subtitle: entry.subtitle,
    detail: formatDetail(entry),
    openUrl: entry.openUrl,
    matchReason: reason,
    matchDetail: detail,
    score,
    metadata: entry.metadata,
    mimeType: entry.mimeType,
    fileUrl: entry.fileUrl,
  };
}

export function groupSearchResults(results: SearchResultItem[]): Record<string, SearchResultItem[]> {
  const grouped: Record<string, SearchResultItem[]> = {};
  for (const r of results) {
    const label = searchEntityLabel(r.entityType);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(r);
  }
  return grouped;
}

export function entityTypeLabel(entityType: string): string {
  return searchEntityLabel(entityType);
}
