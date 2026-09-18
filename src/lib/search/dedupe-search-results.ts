/**
 * Sloučení duplicitních výsledků (stejný soubor z více index záznamů).
 */

import type { SearchResultItem } from "@/lib/search/types";

function normalizeFileUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return url.split("?")[0]?.toLowerCase() ?? "";
  }
}

function dedupeKey(item: SearchResultItem): string {
  const fileUrl = normalizeFileUrl(item.fileUrl);
  if (fileUrl) return `url:${fileUrl}`;

  const entityKey = `${item.entityType}:${item.entityId}`;
  const jobId = item.metadata.jobId ?? "";
  const fileName = (item.metadata.fileName ?? item.title).toLowerCase().trim();
  if (jobId && fileName) return `jobfile:${jobId}:${fileName}`;

  return entityKey;
}

/** Ponechá vyšší score při duplicitě. */
export function dedupeSearchResults(results: SearchResultItem[]): SearchResultItem[] {
  const byKey = new Map<string, SearchResultItem>();
  for (const item of results) {
    const key = dedupeKey(item);
    const prev = byKey.get(key);
    if (!prev || item.score > prev.score) {
      byKey.set(key, item);
    }
  }
  const out = [...byKey.values()];
  out.sort((a, b) => b.score - a.score);
  return out;
}
