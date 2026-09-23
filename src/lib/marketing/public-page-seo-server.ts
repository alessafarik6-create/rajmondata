import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SEO_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_SEO_DOC } from "@/lib/platform-config";
import { SITE_URL } from "@/lib/site-url";
import type { MarketingPageDef } from "@/lib/marketing/public-pages-registry";

export type PublicPageSeoOverride = {
  title?: string;
  description?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
};

function trimOrUndef(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export async function loadPublicPageSeoOverrides(): Promise<Record<string, PublicPageSeoOverride>> {
  const db = getAdminFirestore();
  if (!db) return {};
  try {
    const snap = await db.collection(PLATFORM_SEO_COLLECTION).doc(PLATFORM_SEO_DOC).get();
    const raw = snap.data()?.publicPageSeo;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, PublicPageSeoOverride> = {};
    for (const [slug, row] of Object.entries(raw as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      out[slug] = {
        title: trimOrUndef(o.title, 200),
        description: trimOrUndef(o.description, 500),
        canonical: trimOrUndef(o.canonical, 500),
        ogTitle: trimOrUndef(o.ogTitle, 200),
        ogDescription: trimOrUndef(o.ogDescription, 500),
        ogImage: trimOrUndef(o.ogImage, 500),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Canonical musí odpovídat slug stránky — jinak ignorujeme override (častá chyba v admin SEO). */
export function resolveMarketingPageCanonical(
  page: MarketingPageDef,
  overrideCanonical?: string
): string {
  const base = SITE_URL.replace(/\/$/, "");
  const expectedPath = `/${page.slug}`;
  const fallback = `${base}${expectedPath}`;
  const raw = overrideCanonical?.trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw, `${base}/`);
    const siteOrigin = new URL(base).origin;
    const path = u.pathname.replace(/\/$/, "") || "/";
    if (u.origin === siteOrigin && path === expectedPath) {
      return `${siteOrigin}${expectedPath}`;
    }
  } catch {
    /* ignore invalid override */
  }
  return fallback;
}

export function mergePageSeo(
  page: MarketingPageDef,
  override?: PublicPageSeoOverride
): {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
} {
  const canonical = resolveMarketingPageCanonical(page, override?.canonical);
  const title = override?.title || page.title;
  const description = override?.description || page.description;
  return {
    title,
    description,
    canonical,
    ogTitle: override?.ogTitle || title,
    ogDescription: override?.ogDescription || description,
    ogImage: override?.ogImage || `${SITE_URL}/pwa-512.png`,
  };
}
