import type { Firestore } from "firebase-admin/firestore";
import crypto from "node:crypto";
import { satelitniApiBaseUrl } from "@/lib/integrations/satelitni-sledovani/config";
import { getSatelitniSledovaniAccessToken } from "@/lib/integrations/satelitni-sledovani/token-service";
import { parseProblemJson, SatelitniApiError } from "@/lib/integrations/satelitni-sledovani/problem-json";

export type SatelitniListMeta = {
  count?: number;
  has_more?: boolean;
  next_cursor?: string | null;
};

export type SatelitniListResponse<T> = {
  data?: T[];
  items?: T[];
  meta?: SatelitniListMeta;
};

function joinUrl(path: string): string {
  const base = satelitniApiBaseUrl().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (p.startsWith("/api/v2")) return `${base.replace(/\/api\/v2$/, "")}${p}`;
  return `${base}${p}`;
}

export async function satelitniRequest<T>(
  db: Firestore,
  organizationId: string,
  path: string,
  options?: {
    method?: "GET" | "POST" | "PATCH";
    query?: Record<string, string | number | undefined | null>;
    body?: unknown;
    retried401?: boolean;
  }
): Promise<{ data: T; headers: Headers; httpStatus: number }> {
  const method = options?.method ?? "GET";
  const accessToken = await getSatelitniSledovaniAccessToken(db, organizationId);
  const url = new URL(joinUrl(path));
  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json, application/problem+json",
      Authorization: `Bearer ${accessToken}`,
      "X-Request-Id": crypto.randomUUID(),
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const rateLimit = {
    limit: res.headers.get("RateLimit-Limit") ?? undefined,
    remaining: res.headers.get("RateLimit-Remaining") ?? undefined,
    reset: res.headers.get("RateLimit-Reset") ?? undefined,
  };

  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  if (res.status === 401 && !options?.retried401) {
    const { loadSatelitniOAuthTokens, saveSatelitniOAuthTokens } = await import(
      "@/lib/integrations/satelitni-sledovani/store"
    );
    const { refreshSatelitniTokens } = await import("@/lib/integrations/satelitni-sledovani/oauth");
    const stored = await loadSatelitniOAuthTokens(db, organizationId);
    if (stored?.refreshToken) {
      const refreshed = await refreshSatelitniTokens(stored.refreshToken);
      await saveSatelitniOAuthTokens(db, organizationId, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresInSec: refreshed.expiresIn,
      });
    }
    return satelitniRequest<T>(db, organizationId, path, { ...options, retried401: true });
  }

  if (!res.ok) {
    const problem =
      contentType.includes("problem+json") || raw.startsWith("{")
        ? parseProblemJson(raw)
        : { detail: raw.slice(0, 300) };
    console.error("[Satelitni API]", res.status, url.pathname, problem.title ?? problem.detail);
    throw new SatelitniApiError(res.status, { ...problem, status: res.status }, rateLimit);
  }

  let data: T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    throw new SatelitniApiError(502, { detail: "Neplatná JSON odpověď GPS API." });
  }

  return { data, headers: res.headers, httpStatus: res.status };
}

export function extractListItems<T>(payload: SatelitniListResponse<T> | T[]): T[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

export function extractMeta(payload: SatelitniListResponse<unknown>): SatelitniListMeta {
  return payload.meta ?? {};
}

export async function fetchAllSatelitniPages<T>(
  db: Firestore,
  organizationId: string,
  path: string,
  opts?: { query?: Record<string, string | number | undefined | null>; pageLimit?: number }
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined = undefined;
  const limit = opts?.pageLimit ?? 1000;
  for (let page = 0; page < 200; page++) {
    const query = { ...opts?.query, limit, cursor: cursor ?? undefined };
    const { data } = await satelitniRequest<SatelitniListResponse<T>>(db, organizationId, path, {
      query,
    });
    out.push(...extractListItems(data));
    const meta = extractMeta(data);
    if (!meta.has_more) break;
    cursor = meta.next_cursor;
    if (!cursor) break;
  }
  return out;
}
