import { addHours, endOfDay, isAfter } from "date-fns";

/** Čas ve formátu „HH:mm“ → minuty od půlnoci. */
export function minutesFromHm(s: string): number {
  const t = s.trim();
  const [h, m = "0"] = t.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

/** Rozdíl hodin mezi časy od–do (stejný den). */
export function hoursBetween(startHm: string, endHm: string): number {
  const a = minutesFromHm(startHm);
  const b = minutesFromHm(endHm);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}

/** Parsování „HH:mm“ (hodiny 0–23, minuty 00–59). */
export function parseHmStrict(s: string): { h: number; m: number } | null {
  const t = s.trim();
  const m = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

export function formatHm(h: number, min: number): string {
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Zda je kalendářní den uzamčen: zápis povolen do 24 hodin po konci toho dne (lokální čas).
 */
export function isWorklogDateLocked(day: Date, now = new Date()): boolean {
  const deadline = addHours(endOfDay(day), 24);
  return isAfter(now, deadline);
}

/** Překryv intervalů [start, end) v minutách od půlnoci (sousedící okraje se nepřekrývají). */
export function intervalsOverlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  if (
    !Number.isFinite(aStart) ||
    !Number.isFinite(aEnd) ||
    !Number.isFinite(bStart) ||
    !Number.isFinite(bEnd)
  ) {
    return false;
  }
  return aStart < bEnd && bStart < aEnd;
}

/** Nový interval [newStart, newEnd) koliduje s existujícím blokem stejného dne? */
export function blockOverlapsExisting(
  newStartHm: string,
  newEndHm: string,
  existing: { startTime?: string; endTime?: string }[]
): boolean {
  const ns = minutesFromHm(newStartHm);
  const ne = minutesFromHm(newEndHm);
  if (!Number.isFinite(ns) || !Number.isFinite(ne) || ne <= ns) return false;
  for (const row of existing) {
    const es = minutesFromHm(String(row.startTime ?? ""));
    const ee = minutesFromHm(String(row.endTime ?? ""));
    if (!Number.isFinite(es) || !Number.isFinite(ee) || ee <= es) continue;
    if (intervalsOverlapMinutes(ns, ne, es, ee)) return true;
  }
  return false;
}

/** Max. délka pole `description` na dokumentu work_time_blocks (shodně s validací ve formuláři). */
export const WORKLOG_DESCRIPTION_MAX_LENGTH = 2000;

export function normalizeWorklogDescription(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

export function isWorklogDescriptionTooLong(text: string): boolean {
  return normalizeWorklogDescription(text).length > WORKLOG_DESCRIPTION_MAX_LENGTH;
}
