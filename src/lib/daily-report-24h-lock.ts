import { addHours, endOfDay, isAfter } from "date-fns";

/** Lokální kalendářní den z klíče YYYY-MM-DD (bez posunu UTC). */
export function parseDateKeyLocal(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date(NaN);
  }
  return new Date(y, m - 1, d);
}

/**
 * Po uplynutí konce pracovního dne + 24 h již nelze zápis upravovat (pokud je pravidlo zapnuté).
 */
export function isDailyReportPastEditDeadline(
  dayOrDateKey: Date | string,
  now: Date = new Date()
): boolean {
  const d =
    typeof dayOrDateKey === "string"
      ? parseDateKeyLocal(dayOrDateKey)
      : dayOrDateKey;
  if (Number.isNaN(d.getTime())) return false;
  const deadline = addHours(endOfDay(d), 24);
  return isAfter(now, deadline);
}

export function isDailyReportLockedBy24hRule(
  dayOrDateKey: Date | string,
  opts: {
    lockEnabled: boolean;
    reportStatus?: string | null;
  },
  now: Date = new Date()
): boolean {
  if (!opts.lockEnabled) return false;
  const st = String(opts.reportStatus || "").trim();
  if (st === "returned") return false;
  if (st === "pending" || st === "approved") return false;
  return isDailyReportPastEditDeadline(dayOrDateKey, now);
}
