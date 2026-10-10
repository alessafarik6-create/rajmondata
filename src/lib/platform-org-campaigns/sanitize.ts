/** Jednoduchá server-side sanitizace HTML (bez externí knihovny). */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "ul",
  "ol",
  "li",
  "a",
  "h2",
  "h3",
  "span",
]);

export function sanitizeCampaignHtml(raw: string): string {
  let s = String(raw ?? "");
  s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  return s
    .replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(t)) return "";
      if (t === "a") {
        const hrefMatch = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? "").trim();
        if (!href || /^https?:\/\//i.test(href) || href.startsWith("/")) {
          return `<a href="${href.replace(/"/g, "&quot;")}" rel="noopener noreferrer">`;
        }
        return "<a>";
      }
      return full;
    })
    .slice(0, 80_000);
}
