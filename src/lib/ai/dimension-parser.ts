/**
 * Extrakce rozměrů z textu poptávky (deterministicky, bez AI).
 */

export type ParsedInquiryDimensions = {
  widthMm: number | null;
  depthMm: number | null;
  areaM2: number | null;
  distanceKm: number | null;
};

function parseNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toMm(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "mm") return value;
  if (u === "cm") return value * 10;
  if (u === "m" || u === "") return value * 1000;
  return value * 1000;
}

function toM2FromMm(wMm: number, dMm: number): number {
  return Math.round((wMm / 1000) * (dMm / 1000) * 1000) / 1000;
}

function parsePairNumbers(a: number, b: number, unitA: string, unitB: string): ParsedInquiryDimensions {
  const wMm = toMm(a, unitA);
  const dMm = toMm(b, unitB);
  return {
    widthMm: wMm,
    depthMm: dMm,
    areaM2: toM2FromMm(wMm, dMm),
    distanceKm: null,
  };
}

function inferUnit(a: number, b: number, unitA: string, unitB: string): { unitA: string; unitB: string } {
  let ua = unitA || "m";
  let ub = unitB || unitA || "m";
  if (!unitA && !unitB) {
    if (a > 100 || b > 100) {
      ua = "mm";
      ub = "mm";
    } else {
      ua = "m";
      ub = "m";
    }
  }
  return { unitA: ua, unitB: ub };
}

export function parseInquiryDimensions(text: string): ParsedInquiryDimensions {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) {
    return { widthMm: null, depthMm: null, areaM2: null, distanceKm: null };
  }

  const patterns: RegExp[] = [
    /(\d[\d\s.,]*)\s*(mm|cm|m)?\s*[x×]\s*(\d[\d\s.,]*)\s*(mm|cm|m)?/i,
    /(\d[\d\s.,]*)\s*(mm|cm|m)\s*na\s*(\d[\d\s.,]*)\s*(mm|cm|m)/i,
    /rozm[eě]r[^0-9]*(\d[\d\s.,]*)\s*(mm|cm|m)?\s*[x×]\s*(\d[\d\s.,]*)\s*(mm|cm|m)?/i,
    /(?:sirka|šířka)\s*[:\s]?\s*(\d[\d\s.,]*)\s*(mm|cm|m)?[^,;]*?(?:hloubka|delka|d[eé]lka)\s*[:\s]?\s*(\d[\d\s.,]*)\s*(mm|cm|m)?/i,
    /(?:hloubka|delka|d[eé]lka)\s*[:\s]?\s*(\d[\d\s.,]*)\s*(mm|cm|m)?[^,;]*?(?:sirka|šířka)\s*[:\s]?\s*(\d[\d\s.,]*)\s*(mm|cm|m)?/i,
    /(\d[\d\s.,]*)\s*(mm|cm|m)?\s*[x×]\s*(\d[\d\s.,]*)\s*(mm|cm|m)?\s*m\b/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const a = parseNumber(m[1]);
    const b = parseNumber(m[3]);
    if (a == null || b == null) continue;
    const units = inferUnit(a, b, String(m[2] ?? "").trim(), String(m[4] ?? "").trim());
    return parsePairNumbers(a, b, units.unitA, units.unitB);
  }

  const areaMatch = t.match(/(\d[\d\s.,]*)\s*m\s*[²2]/i);
  if (areaMatch) {
    const area = parseNumber(areaMatch[1]);
    if (area != null) {
      return { widthMm: null, depthMm: null, areaM2: area, distanceKm: null };
    }
  }

  const kmMatch = t.match(/(\d[\d\s.,]*)\s*km/i);
  const distanceKm = kmMatch ? parseNumber(kmMatch[1]) : null;

  return { widthMm: null, depthMm: null, areaM2: null, distanceKm };
}
