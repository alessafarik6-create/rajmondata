/**
 * Normalizace textu pro vyhledávání (CZ).
 */

export function normalizeSearchText(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeExactKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function tokenizeSearchText(raw: string, maxTokens = 80): string[] {
  const normalized = normalizeSearchText(raw);
  const tokens = normalized
    .split(/[^a-z0-9@.+_-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const unique = [...new Set(tokens)];
  return unique.slice(0, maxTokens);
}

export function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Tolerance pro „asi X tisíc“ — deterministicky ±10 %, min ±5000 u větších částek. */
export function amountRangeFromApprox(value: number): { min: number; max: number } {
  const v = Math.abs(value);
  const pct = 0.1;
  const delta = Math.max(v * pct, v >= 50_000 ? 5000 : v >= 10_000 ? 1000 : 500);
  return {
    min: Math.max(0, Math.round(v - delta)),
    max: Math.round(v + delta),
  };
}

export function parseCzechAmountToken(raw: string): number | null {
  const s = normalizeSearchText(raw).replace(/\s/g, "");
  const tisic = s.match(/^(\d+(?:[.,]\d+)?)\s*tis(?:ic)?$/);
  if (tisic) return Math.round(parseFloat(tisic[1].replace(",", ".")) * 1000);
  const num = s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (num) {
    const n = parseFloat(num[1].replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
