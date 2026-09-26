/**
 * Technický SEO audit veřejných URL — spusť po `npm run build && npm run start`.
 * Volitelně: BASE_URL=https://rajmondata.cz npx tsx scripts/test-public-seo-audit.ts
 */
import { buildPublicSitemapEntries } from "../src/lib/marketing/public-sitemap";
import { getPublicIndexableUrls, isPublicPathNoIndex } from "../src/lib/marketing/public-seo-urls";
import {
  getIndexableMarketingPages,
  getMarketingPageBySlug,
} from "../src/lib/marketing/public-pages-registry";
import { mergePageSeo } from "../src/lib/marketing/public-page-seo-server";
import { SITE_URL } from "../src/lib/site-url";
import {
  HOME_H1,
  HOME_SEO_DESCRIPTION,
  HOME_SEO_TITLE,
} from "../src/lib/marketing/homepage-seo";

const BASE = (process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  .replace(/\/$/, "");

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractCanonical(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m) return m[1];
  const m2 = html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m2 ? m2[1] : null;
}

function extractH1(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").trim();
}

function robotsFromMeta(html: string): "index" | "noindex" | "unknown" {
  const robots = extractMeta(html, "robots")?.toLowerCase() ?? "";
  if (robots.includes("noindex")) return "noindex";
  if (robots.includes("index")) return "index";
  return "unknown";
}

async function fetchRobotsTxt(): Promise<string> {
  const res = await fetch(`${BASE}/robots.txt`);
  return res.ok ? await res.text() : "";
}

async function fetchSitemapXml(): Promise<{ ok: boolean; xml: string }> {
  const res = await fetch(`${BASE}/sitemap.xml`);
  const xml = await res.text();
  return { ok: res.ok && xml.includes("<urlset"), xml };
}

function pathBlockedByRobots(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split("\n");
  let inAll = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^user-agent:\s*\*/i.test(t)) inAll = true;
    if (/^user-agent:/i.test(t) && !/\*/.test(t)) inAll = false;
    if (!inAll) continue;
    const dis = t.match(/^disallow:\s*(.*)$/i);
    if (dis) {
      const rule = dis[1].trim();
      if (rule && path.startsWith(rule.replace(/\/$/, ""))) return true;
    }
  }
  return false;
}

async function main() {
  const sitemapEntries = buildPublicSitemapEntries();
  const sitemapUrls = new Set(sitemapEntries.map((e) => e.url.replace(/\/$/, "") || e.url));

  const { ok: sitemapOk, xml: sitemapXml } = await fetchSitemapXml();
  const robotsTxt = await fetchRobotsTxt();

  console.log(`\n=== SEO audit (BASE=${BASE}, canonical SITE=${SITE_URL}) ===\n`);
  console.log(`robots.txt: ${robotsTxt ? "OK" : "MISSING"}`);
  console.log(`sitemap.xml valid: ${sitemapOk ? "ANO" : "NE"} (URLs in sitemap: ${sitemapEntries.length})\n`);

  const rows: string[] = [];
  const indexable = getPublicIndexableUrls();

  for (const { path, absoluteUrl, slug } of indexable) {
    const url = `${BASE}${path === "/" ? "/" : path}`;
    let status = 0;
    let html = "";
    try {
      const res = await fetch(url, { redirect: "follow" });
      status = res.status;
      html = await res.text();
    } catch (e) {
      rows.push(`${path}\tFETCH_ERR\t-\t-\t-\t-\t-\t${(e as Error).message}`);
      continue;
    }

    const canon = extractCanonical(html);
    const expectedCanon = absoluteUrl.replace(/\/$/, "") + (path === "/" ? "/" : "");
    const canonNorm = canon?.replace(/\/$/, "") ?? "";
    const expectedNorm = expectedCanon.replace(/\/$/, "") || `${SITE_URL}/`;

    const title = extractMeta(html, "title") ?? (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "");
    const desc = extractMeta(html, "description");
    const h1 = extractH1(html);
    const robots = robotsFromMeta(html);
    const blocked = pathBlockedByRobots(robotsTxt, path);
    const inSitemap = sitemapUrls.has(
      `${SITE_URL}${path}`.replace(/\/$/, "") || `${SITE_URL}/`
    );

    const expectedTitle = slug
      ? mergePageSeo(getMarketingPageBySlug(slug)!, undefined).title
      : HOME_SEO_TITLE;

    rows.push(
      [
        path,
        String(status),
        robots,
        blocked ? "blocked" : "allowed",
        canonNorm === expectedNorm.replace(/\/$/, "") || canonNorm === expectedNorm ? "OK" : canon ?? "—",
        title.slice(0, 60),
        (desc ?? "—").slice(0, 50),
        (h1 ?? "—").slice(0, 50),
        inSitemap ? "ANO" : "NE",
      ].join("\t")
    );

    void expectedTitle;
  }

  console.log(
    "URL\tHTTP\trobots\trobots.txt\tcanonical\ttitle\tdescription\tH1\tsitemap"
  );
  for (const r of rows) console.log(r);

  const noindexPaths = [
    "/login",
    "/register",
    "/portal/dashboard",
    "/admin/login",
  ];
  console.log("\n--- noindex kontrola (soukromé cesty) ---");
  for (const p of noindexPaths) {
    try {
      const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
      const html = res.status < 400 ? await res.text() : "";
      const xRobots = res.headers.get("x-robots-tag") ?? "";
      const meta = robotsFromMeta(html);
      const noindex =
        xRobots.toLowerCase().includes("noindex") ||
        meta === "noindex" ||
        isPublicPathNoIndex(p);
      console.log(`${p}: HTTP ${res.status}, noindex=${noindex ? "ANO" : "NE"}`);
    } catch {
      console.log(`${p}: fetch failed`);
    }
  }

  console.log("\n--- Sitemap URL (production canonical) ---");
  for (const e of sitemapEntries) console.log(e.url);

  if (!sitemapOk) {
    console.error("\nSitemap sample:", sitemapXml.slice(0, 400));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
