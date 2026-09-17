import type { MetadataRoute } from "next";
import { PUBLIC_SITEMAP_SLUGS } from "@/lib/marketing/public-pages-registry";
import { SITE_URL } from "@/lib/site-url";

/**
 * Pouze veřejné marketingové stránky (bez portálu, API, přihlášení).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;
  const now = new Date();

  const landingPages = PUBLIC_SITEMAP_SLUGS.map((slug) => ({
    url: `${base}/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: slug.startsWith("pro-") || slug.includes("obchodni") ? 0.7 : 0.85,
  }));

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...landingPages,
  ];
}
