import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/**
 * Pouze veřejné marketingové stránky (bez portálu, API, přihlášení).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;
  const now = new Date();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
