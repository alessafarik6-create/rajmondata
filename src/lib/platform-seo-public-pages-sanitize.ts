import { getAllMarketingSlugs } from "@/lib/marketing/public-pages-registry";

export type SanitizedPublicPageSeo = Record<
  string,
  {
    title?: string;
    description?: string;
    canonical?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
  }
>;

const ALLOWED = new Set(getAllMarketingSlugs());

function s(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export function sanitizePublicPageSeo(raw: unknown): SanitizedPublicPageSeo {
  if (!raw || typeof raw !== "object") return {};
  const out: SanitizedPublicPageSeo = {};
  for (const [slug, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED.has(slug) || !row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    out[slug] = {
      title: s(o.title, 200),
      description: s(o.description, 500),
      canonical: s(o.canonical, 500),
      ogTitle: s(o.ogTitle, 200),
      ogDescription: s(o.ogDescription, 500),
      ogImage: s(o.ogImage, 500),
    };
  }
  return out;
}
