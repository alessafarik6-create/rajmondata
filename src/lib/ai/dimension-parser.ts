/**
 * Extrakce rozměrů z textu poptávky (deterministicky, bez AI).
 */

export type ParsedInquiryDimensions = {
  widthMm: number | null;
  depthMm: number | null;
  areaM2: number | null;
  distanceKm: number | null;
};

function toMm(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "mm") return value;
  if (u === "cm") return value * 10;
  if (u === "m") return value * 1000;
  return value;
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

export function parseInquiryDimensions(text: string): ParsedInquiryDimensions {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) {
    return { widthMm: null, depthMm: null, areaM2: null, distanceKm: null };
  }

  const patterns: RegExp[] = [
    /(\d[\d\s.,]*)\s*(mm|cm|m)?\s*[x×]\s*(\d[\d\s.,]*)\s*(mm|cm|m)?/i,
    /(\d[\d\s.,]*)\s*(mm|cm|m)\s*na\s*(\d[\d\s.,]*)\s*(mm|cm|m)/i,
    /rozm[eě]r[^0-9]*(\d[\d\s.,]*)\s*(mm|cm|m)?\s*[x×]\s*(\d[\d\s.,]*)\s*(mm|cm|m)?/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const a = Number(String(m[1]).replace(/\s/g, "").replace(",", "."));
    const b = Number(String(m[3]).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    const unitA = String(m[2] ?? "m").trim() || "m";
    const unitB = String(m[4] ?? unitA).trim() || unitA;
    return parsePairNumbers(a, b, unitA, unitB);
  }

  const areaMatch = t.match(/(\d[\d\s.,]*)\s*m\s*[²2]/i);
  if (areaMatch) {
    const area = Number(String(areaMatch[1]).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(area) && area > 0) {
      return { widthMm: null, depthMm: null, areaM2: area, distanceKm: null };
    }
  }

  const kmMatch = t.match(/(\d[\d\s.,]*)\s*km/i);
  const distanceKm =
    kmMatch && Number.isFinite(Number(String(kmMatch[1]).replace(",", ".")))
      ? Number(String(kmMatch[1]).replace(",", "."))
      : null;

  return { widthMm: null, depthMm: null, areaM2: null, distanceKm };
}
