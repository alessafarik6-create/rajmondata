export function bucketReferrer(referrerHost: string): string {
  const h = referrerHost.trim().toLowerCase();
  if (!h) return "direct";
  if (h.includes("google.")) return "google";
  if (h.includes("seznam.")) return "seznam";
  if (h.includes("facebook.") || h.includes("instagram.") || h.includes("linkedin.")) return "social";
  if (h.includes("bing.") || h.includes("duckduckgo.")) return "search_other";
  return "referral";
}

export function deviceClassFromUa(ua: string): string {
  const u = ua.toLowerCase();
  if (/ipad|tablet/.test(u)) return "tablet";
  if (/mobile|android|iphone/.test(u)) return "mobile";
  return "desktop";
}
