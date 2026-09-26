import { getIndexableMarketingPages } from "@/lib/marketing/public-pages-registry";
import { SITE_URL } from "@/lib/site-url";

export const PUBLIC_NOINDEX_PATH_PREFIXES = [
  "/portal",
  "/admin",
  "/api",
  "/login",
  "/register",
  "/attendance-login",
  "/reset-password",
] as const;

export type PublicIndexableUrl = {
  path: string;
  absoluteUrl: string;
  slug: string | null;
};

/** Všechny veřejné URL, které mají být v sitemap a indexované Googlem. */
export function getPublicIndexableUrls(): PublicIndexableUrl[] {
  const base = SITE_URL.replace(/\/$/, "");
  const pages = getIndexableMarketingPages();
  return [
    { path: "/", absoluteUrl: `${base}/`, slug: null },
    ...pages.map((p) => ({
      path: `/${p.slug}`,
      absoluteUrl: `${base}/${p.slug}`,
      slug: p.slug,
    })),
  ];
}

export function isPublicPathNoIndex(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  return PUBLIC_NOINDEX_PATH_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`)
  );
}
