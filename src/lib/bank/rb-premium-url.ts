/** Cesta RB Premium API (relativně k originu, např. https://api.rb.cz). */
export const RB_PREMIUM_API_PREFIX = "/rbcz/premium/api";

/**
 * Origin bez koncové lomítky a bez omylem vloženého API prefixu.
 * RAIFFEISENBANK_API_BASE_URL=https://api.rb.cz
 */
export function resolveRaiffeisenApiOrigin(): string {
  let origin = String(process.env.RAIFFEISENBANK_API_BASE_URL ?? "").trim() || "https://api.rb.cz";
  origin = origin.replace(/\/+$/, "");
  origin = origin.replace(/\/rbcz\/premium\/api$/i, "");
  origin = origin.replace(/\/premium$/i, "");
  return origin;
}

/**
 * Sestaví cestu pod /rbcz/premium/api bez duplicitního prefixu.
 * @param subpath např. "/accounts" nebo "accounts"
 */
export function rbPremiumApiPath(subpath: string): string {
  let p = String(subpath ?? "").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.toLowerCase().startsWith(RB_PREMIUM_API_PREFIX)) {
    return p;
  }
  return `${RB_PREMIUM_API_PREFIX}${p}`;
}

export function buildRbPremiumRequestUrl(origin: string, subpath: string): string {
  const path = rbPremiumApiPath(subpath);
  const base = origin.replace(/\/+$/, "");
  const url = `${base}${path}`;
  if (url.includes(`${RB_PREMIUM_API_PREFIX}${RB_PREMIUM_API_PREFIX}`)) {
    console.error("[RB URL] duplicate premium API prefix detected", { url: url.slice(0, 200) });
  }
  return url;
}

/** Pro diagnostiku — finální URL pro GET accounts (bez certifikátu). */
export function logRbResolvedAccountsUrl(): void {
  const origin = resolveRaiffeisenApiOrigin();
  const url = buildRbPremiumRequestUrl(origin, "/accounts");
  console.info("[RB URL]", { origin, accountsGetUrl: url });
}
