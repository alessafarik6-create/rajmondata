const FORBIDDEN_KEYS =
  /password|token|secret|authorization|cookie|apikey|api_key|prompt|body|header|session/i;

export function sanitizeSecurityMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.test(k)) continue;
    if (typeof v === "string") {
      out[k] = v.slice(0, 200);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

export function truncateUserAgent(ua: string): string {
  return ua.slice(0, 120);
}
