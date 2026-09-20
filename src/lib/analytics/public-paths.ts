const PUBLIC_PREFIXES = [
  "/",
  "/funkce",
  "/rizeni-zakazek",
  "/dochazka-zamestnancu",
  "/email-pro-firmy",
  "/vozovy-park",
  "/rizeni-vyroby",
  "/skladove-hospodarstvi",
  "/firemni-portal",
  "/prace-a-mzdy",
  "/poptavky-a-nabidky",
  "/ai-pro-firmy",
  "/ai-smlouvy-a-dodatky",
  "/fakturace-a-doklady",
  "/komunikace-se-zakazniky",
  "/sklad-a-vyroba",
  "/pro-remeslniky",
  "/pro-montazni-firmy",
  "/pro-stavebni-firmy",
  "/obchodni-podminky",
  "/ochrana-osobnich-udaju",
  "/gdpr",
  "/cookies",
  "/zpracovatelska-smlouva",
];

export function normalizePublicPath(path: string): string | null {
  const p = path.split("?")[0].split("#")[0].trim() || "/";
  if (p.startsWith("/portal") || p.startsWith("/admin") || p.startsWith("/api")) return null;
  if (p === "/login" || p === "/register" || p.startsWith("/attendance-login")) return null;
  if (PUBLIC_PREFIXES.includes(p)) return p;
  // marketing slugs — single segment alphanumeric
  const seg = p.replace(/^\//, "");
  if (/^[a-z0-9-]+$/.test(seg) && !seg.includes("..")) return p;
  return null;
}

export function isBotUserAgent(ua: string): boolean {
  const u = ua.toLowerCase();
  return /googlebot|bingbot|slurp|duckduckbot|yandexbot|facebookexternalhit|linkedinbot/.test(u);
}
