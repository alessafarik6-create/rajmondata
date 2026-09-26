import type { MetadataRoute } from "next";
import {
  lastModifiedForHome,
  lastModifiedForMarketingSlug,
} from "@/lib/marketing/public-page-lastmod";
import { getIndexableMarketingPages } from "@/lib/marketing/public-pages-registry";
import { SITE_URL } from "@/lib/site-url";

/** Kanonická produkční doména bez www a bez koncového lomítka. */
export function publicSitemapBaseUrl(): string {
  return SITE_URL.replace(/\/$/, "");
}

/**
 * Veřejné indexovatelné URL pro sitemap.xml — stejný zdroj jako marketing registry.
 * Bez portálu, API, přihlášení a DPA přílohy.
 */
export function buildPublicSitemapEntries(): MetadataRoute.Sitemap {
  const base = publicSitemapBaseUrl();

  const landingPages: MetadataRoute.Sitemap = getIndexableMarketingPages().map((page) => ({
    url: `${base}/${page.slug}`,
    lastModified: lastModifiedForMarketingSlug(page.slug),
  }));

  return [
    {
      url: `${base}/`,
      lastModified: lastModifiedForHome(),
    },
    ...landingPages,
  ];
}

export function publicSitemapUrlCount(entries: MetadataRoute.Sitemap = buildPublicSitemapEntries()): number {
  return entries.length;
}
