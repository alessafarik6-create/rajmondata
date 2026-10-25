/**
 * Záložní extrakce datumových rozsahů z OCR textu (české zápisy).
 */

export type ExtractedDateRange = {
  sourceText: string;
  startDate: string;
  endDate: string;
  yearNeedsConfirmation: boolean;
};

const RANGE_RE =
  /(\d{1,2})\.\s*(\d{1,2})\s*[–\-—]\s*(\d{1,2})\.\s*(\d{1,2})(?:\.(\d{2,4}))?/g;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function inferYears(
  startMonth: number,
  endMonth: number,
  refYear: number,
  explicitYear?: number
): { startYear: number; endYear: number; yearNeedsConfirmation: boolean } {
  if (explicitYear != null && explicitYear >= 2000 && explicitYear <= 2100) {
    let endYear = explicitYear;
    let startYear = explicitYear;
    if (endMonth < startMonth) endYear = explicitYear + 1;
    return { startYear, endYear, yearNeedsConfirmation: false };
  }
  let startYear = refYear;
  let endYear = refYear;
  if (endMonth < startMonth) endYear = refYear + 1;
  return { startYear, endYear, yearNeedsConfirmation: true };
}

export function extractDateRangesFromText(
  text: string,
  referenceDate: Date
): ExtractedDateRange[] {
  const src = String(text ?? "");
  if (!src.trim()) return [];
  const refYear = referenceDate.getFullYear();
  const out: ExtractedDateRange[] = [];
  const seen = new Set<string>();

  for (const m of src.matchAll(RANGE_RE)) {
    const full = m[0] ?? "";
    if (seen.has(full)) continue;
    seen.add(full);
    const d1 = Number(m[1]);
    const mo1 = Number(m[2]);
    const d2 = Number(m[3]);
    const mo2 = Number(m[4]);
    let explicitYear: number | undefined;
    if (m[5]) {
      const y = Number(m[5]);
      explicitYear = y < 100 ? 2000 + y : y;
    }
    const { startYear, endYear, yearNeedsConfirmation } = inferYears(
      mo1,
      mo2,
      refYear,
      explicitYear
    );
    const startDate = isoDate(startYear, mo1, d1);
    const endDate = isoDate(endYear, mo2, d2);
    if (!startDate || !endDate) continue;
    out.push({ sourceText: full.trim(), startDate, endDate, yearNeedsConfirmation });
  }
  return out;
}

export function findOverlappingRangeIds(
  ranges: Array<{ id: string; startDate: string; endDate: string }>
): string[] {
  const parsed = ranges
    .map((r) => ({
      id: r.id,
      start: Date.parse(`${r.startDate}T12:00:00Z`),
      end: Date.parse(`${r.endDate}T12:00:00Z`),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end));
  const conflictIds = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i]!;
      const b = parsed[j]!;
      if (a.start <= b.end && b.start <= a.end) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }
  return [...conflictIds];
}
