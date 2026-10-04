/** Převod wall-clock data/času v timezone organizace na UTC Date (Firestore scheduledAt). */

export function wallClockToUtcDate(
  dateYmd: string,
  timeHm: string,
  timeZone: string
): Date | null {
  const dm = dateYmd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = timeHm.trim().match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;

  const desiredLocal = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;

  let utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 6; i++) {
    const formatted = formatPartsInTz(new Date(utcGuess), timeZone);
    const key = `${formatted.y}-${formatted.mo}-${formatted.d} ${formatted.h}:${formatted.mi}`;
    if (key === desiredLocal) return new Date(utcGuess);
    const diffMin =
      (h - Number(formatted.h)) * 60 +
      (mi - Number(formatted.mi)) +
      (d - Number(formatted.d)) * 24 * 60;
    utcGuess += diffMin * 60_000;
  }
  return new Date(utcGuess);
}

function formatPartsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour"),
    mi: get("minute"),
  };
}

export function isoToWallClock(iso: string, timeZone: string): { date: string; startTime: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = formatPartsInTz(d, timeZone);
  return {
    date: `${p.y}-${p.mo}-${p.d}`,
    startTime: `${p.h}:${p.mi}`,
  };
}
