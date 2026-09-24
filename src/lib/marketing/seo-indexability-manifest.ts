import { getIndexableMarketingPages } from "@/lib/marketing/public-pages-registry";
import { publicSitemapBaseUrl } from "@/lib/marketing/public-sitemap";
import { mergePageSeo } from "@/lib/marketing/public-page-seo-server";

/** Statický přehled veřejných URL pro SEO audit (build / dokumentace). */
export type SeoIndexabilityRow = {
  url: string;
  slug: string;
  index: "index";
  canonical: string;
  title: string;
  description: string;
  inSitemap: boolean;
  expectedHttp: 200;
};

export function buildPublicSeoIndexabilityManifest(): SeoIndexabilityRow[] {
  const base = publicSitemapBaseUrl();
  const home: SeoIndexabilityRow = {
    url: `${base}/`,
    slug: "(home)",
    index: "index",
    canonical: `${base}/`,
    title: "(homepage metadata)",
    description: "(homepage metadata)",
    inSitemap: true,
    expectedHttp: 200,
  };

  const pages = getIndexableMarketingPages().map((page) => {
    const seo = mergePageSeo(page);
    return {
      url: `${base}/${page.slug}`,
      slug: page.slug,
      index: "index" as const,
      canonical: seo.canonical,
      title: seo.title,
      description: seo.description.slice(0, 120) + (seo.description.length > 120 ? "…" : ""),
      inSitemap: true,
      expectedHttp: 200 as const,
    };
  });

  return [home, ...pages];
}
