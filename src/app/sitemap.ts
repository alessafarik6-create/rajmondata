import type { MetadataRoute } from "next";
import { buildPublicSitemapEntries } from "@/lib/marketing/public-sitemap";

/** https://rajmondata.cz/sitemap.xml — validní XML sitemap (Next.js MetadataRoute). */
export default function sitemap(): MetadataRoute.Sitemap {
  return buildPublicSitemapEntries();
}
