"use client";

import type { SearchIntent, SearchResponse, SearchResultItem } from "@/lib/search/types";

export type CompanySearchFilters = Partial<SearchIntent>;

export async function fetchCompanySearch(params: {
  token: string;
  companyId: string;
  query: string;
  filters?: CompanySearchFilters;
  limit?: number;
  knowledgeAnswer?: boolean;
}): Promise<SearchResponse> {
  const res = await fetch("/api/company/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId: params.companyId,
      query: params.query,
      filters: params.filters,
      limit: params.limit,
      knowledgeAnswer: params.knowledgeAnswer === true,
    }),
  });

  const data = (await res.json()) as SearchResponse & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Vyhledávání se nezdařilo.");
  }

  return data;
}

export async function triggerSearchReindex(params: {
  token: string;
  companyId: string;
  entityType: SearchResultItem["entityType"];
  entityId: string;
  extraSearchText?: string;
}): Promise<void> {
  await fetch("/api/company/search/reindex", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  }).catch(() => undefined);
}

const RECENT_KEY = "rajmondata.search.recent";

export function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): void {
  if (typeof window === "undefined" || !query.trim()) return;
  const q = query.trim();
  const prev = loadRecentSearches().filter((x) => x !== q);
  prev.unshift(q);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(prev.slice(0, 8)));
}
