/**
 * Stav směny a odpracovaný čas z řady záznamů docházky (check_in / check_out / pauza).
 */

export type AttendanceEventLite = {
  type: string;
  timestampMs: number;
};

/** Je otevřená směna (poslední akce není check_out)? */
export function isShiftOpenFromSorted(sorted: AttendanceEventLite[]): boolean {
  if (sorted.length === 0) return false;
  const last = sorted[sorted.length - 1];
  return last.type !== "check_out";
}

/**
 * Stav po zpracování řady událostí: uzavřený odpracovaný čas a případná rozjetá směna.
 * Jednotná logika pro terminál i denní souhrn (více příchodů/odchodů, pauza).
 */
export function reduceAttendanceWorkState(sorted: AttendanceEventLite[]): {
  closedWorkMs: number;
  accruingStartMs: number | null;
} {
  let workMs = 0;
  let accruing: number | null = null;
  for (const e of sorted) {
    const t = e.timestampMs;
    const ty = e.type;
    if (ty === "check_in" || ty === "break_end") {
      if (accruing == null) accruing = t;
    } else if (ty === "break_start" && accruing != null) {
      workMs += t - accruing;
      accruing = null;
    } else if (ty === "check_out" && accruing != null) {
      workMs += t - accruing;
      accruing = null;
    } else if (ty === "check_out" && accruing == null) {
      /* odchod bez příchodu — ignoruj */
    }
  }
  return { closedWorkMs: workMs, accruingStartMs: accruing };
}

/** Odpracovaný čas jen z uzavřených intervalů (bez rozjeté směně až do `now`). */
export function computeWorkedMillisecondsClosedIntervals(sorted: AttendanceEventLite[]): number {
  return reduceAttendanceWorkState(sorted).closedWorkMs;
}

/** Odpracované hodiny za den včetně rozjeté směně do `now`. */
export function computeWorkedHoursFromDayEvents(sorted: AttendanceEventLite[], nowMs: number): number {
  const { closedWorkMs, accruingStartMs } = reduceAttendanceWorkState(sorted);
  let workMs = closedWorkMs;
  if (accruingStartMs != null) {
    workMs += nowMs - accruingStartMs;
  }
  return Math.round((workMs / 36e5) * 100) / 100;
}

export function parseHourlyRate(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Délka posledního intervalu před odchodem (od posledního příchodu / konce pauzy k odchodu).
 */
export function durationHoursForClosingCheckOut(sorted: AttendanceEventLite[], checkoutMs: number): number {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i].type;
    if (t === "break_start") continue;
    if (t === "check_in" || t === "break_end") {
      return Math.max(0, Math.round(((checkoutMs - sorted[i].timestampMs) / 36e5) * 100) / 100);
    }
    if (t === "check_out") break;
  }
  return 0;
}
