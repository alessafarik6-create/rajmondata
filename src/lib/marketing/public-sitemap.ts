import type { MetadataRoute } from "next";
import { LEGACY_GDPR_SLUG } from "@/lib/marketing/legal-versions";
import {
  getIndexableMarketingPages,
  getMarketingPageBySlug,
} from "@/lib/marketing/public-pages-registry";
import { SITE_URL } from "@/lib/site-url";

/** Kanonická produkční doména bez www a bez koncového lomítka. */
export function publicSitemapBaseUrl(): string {
  return SITE_URL.replace(/\/$/, "");
}

/**
 * Veřejné indexovatelné URL pro sitemap.xml — stejný zdroj jako marketing registry.
 * Bez portálu, API, přihlášení, legacy /gdpr a DPA přílohy.
 */
export function buildPublicSitemapEntries(
  lastModified: Date = new Date()
): MetadataRoute.Sitemap {
  const base = publicSitemapBaseUrl();

  const slugs = getIndexableMarketingPages()
    .map((p) => p.slug)
    .filter((slug) => slug !== LEGACY_GDPR_SLUG && Boolean(getMarketingPageBySlug(slug)));

  const landingPages: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${base}/${slug}`,
    lastModified,
    changeFrequency: "monthly" as const,
    priority:
      slug.startsWith("pro-") || slug.includes("obchodni") || slug === "cookies" ? 0.7 : 0.85,
  }));

  return [
    {
      url: `${base}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...landingPages,
  ];
}

export function publicSitemapUrlCount(entries: MetadataRoute.Sitemap = buildPublicSitemapEntries()): number {
  return entries.length;
}
