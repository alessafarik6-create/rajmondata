/** Veřejná produkční URL platformy (SEO, sitemap, canonical). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
  process.env.APP_URL?.replace(/\/$/, "") ||
  "https://rajmondata.cz"
);
