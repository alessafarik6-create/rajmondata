/**
 * Orientační cena u importovaných poptávek (Kč) — parsování z textu/čísla v JSON.
 */

/** Bezpečně převede hodnotu z importu na částku v Kč, nebo null. */
export function parseLeadPriceKc(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw < 0) return null;
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === "boolean") return null;
  let s = String(raw)
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s*Kč\s*$/i, "")
    .replace(/\s*CZK\s*$/i, "")
    .replace(/\s*,-\s*$/i, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

const ESTIMATED_PRICE_KEYS: readonly string[] = [
  "orientacniCena",
  "orientačníCena",
  "orientacni_cena",
  "orientacniCenaKc",
  "estimatedPrice",
  "estimatePrice",
  "priceEstimate",
  "predpokladanaCena",
  "predpokládanáCena",
  "predpokladana_cena",
  "hodnotaPoptavky",
  "hodnota_poptavky",
  "budget",
];

/** Vybere první nenulové číslo z běžných názvů polí v řádku importu. */
export function extractEstimatedPriceKcFromImportObject(
  o: Record<string, unknown>
): number | null {
  for (const k of ESTIMATED_PRICE_KEYS) {
    if (!(k in o)) continue;
    const n = parseLeadPriceKc(o[k]);
    if (n != null && n > 0) return n;
  }
  return null;
}

export function sumOrientacniCenyFromLeadRows(
  rows: { orientacniCenaKc?: number }[] | null | undefined
): {
  totalKc: number;
  withPriceCount: number;
  totalCount: number;
} {
  const list = Array.isArray(rows) ? rows : [];
  let totalKc = 0;
  let withPriceCount = 0;
  for (const r of list) {
    const n = r.orientacniCenaKc;
    if (n != null && Number.isFinite(n) && n > 0) {
      totalKc += n;
      withPriceCount++;
    }
  }
  return { totalKc, withPriceCount, totalCount: list.length };
}
