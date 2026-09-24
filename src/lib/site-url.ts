/** Veřejná produkční URL platformy (SEO, sitemap, canonical). Vždy non-www. */
function normalizeProductionSiteUrl(raw: string): string {
  let url = String(raw ?? "").trim().replace(/\/$/, "");
  if (!url) return "https://rajmondata.cz";
  url = url.replace(/^http:\/\//i, "https://");
  url = url.replace(/^https:\/\/www\./i, "https://");
  return url;
}

export const SITE_URL = normalizeProductionSiteUrl(
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://rajmondata.cz"
);
