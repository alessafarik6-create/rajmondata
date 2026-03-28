/**
 * Strop hodin pro denní výkaz práce: zdrojem je kompletní docházka (příchod/odchod − pauza),
 * nikoli Math.min(docházka, součet úseků terminálu) — ten zkracoval vykazovatelný čas,
 * když terminál měl méně hodin než skutečná směna.
 */

import type { DayAttendanceSummary } from "@/lib/employee-attendance";

const DEFAULT_EPS = 0.02;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Kompletní docházka = příchod i odchod a dopočtené hodiny. */
export function isCompleteAttendanceSummary(
  s: DayAttendanceSummary | null | undefined
): boolean {
  if (!s) return false;
  return (
    Boolean(s.checkIn) &&
    Boolean(s.checkOut) &&
    s.hoursWorked != null &&
    Number.isFinite(s.hoursWorked) &&
    s.hoursWorked > 0
  );
}

/**
 * Celkový strop hodin, které musí sedět s výkazem (uzamčené úseky + řádky).
 * - Má-li zaměstnanec kompletní docházku → použijeme čisté hodiny z příchodu/odchodu (bez pauzy).
 * - Jinak jen součet uzavřených úseků terminálu (bez docházky).
 * - Pokud úseky přesahují docházku, strop zůstává docházka (uložení stejně selže na validaci).
 */
export function computeDayWorkedCap(params: {
  daySummary: DayAttendanceSummary | null | undefined;
  segmentTotalHours: number;
}): number {
  const seg = Math.max(0, round2(params.segmentTotalHours));
  const s = params.daySummary;
  if (isCompleteAttendanceSummary(s)) {
    return round2(s!.hoursWorked as number);
  }
  return seg;
}

/**
 * Strop hodin pro ruční řádky výkazu (mimo tarif a uzamčenou zakázku z terminálu).
 * Když terminál nemá žádné „volné“ úseky, ale směna má část mimo tarif/zakázku (např. jen tarif
 * uprostřed dne), zbývající čas se vykazuje ručně (`segmentType: manual` v API).
 */
export function computeManualFormHoursCap(params: {
  dayWorkedCapHours: number;
  lockedSumHours: number;
  unlockedSumHours: number;
  hasTerminalSegments: boolean;
}): number {
  const cap = Math.max(0, round2(params.dayWorkedCapHours));
  const locked = Math.max(0, round2(params.lockedSumHours));
  const pool = Math.max(0, round2(cap - locked));
  if (!params.hasTerminalSegments) return cap;
  const unlockedSum = Math.max(0, round2(params.unlockedSumHours));
  if (unlockedSum <= 0) return pool;
  return Math.min(unlockedSum, pool);
}

/** Lze za den vůbec vyplňovat výkaz (kompletní docházka nebo aspoň úseky terminálu). */
export function isDayReportableForWorklog(params: {
  daySummary: DayAttendanceSummary | null | undefined;
  segmentTotalHours: number;
  eps?: number;
}): boolean {
  const eps = params.eps ?? DEFAULT_EPS;
  if (isCompleteAttendanceSummary(params.daySummary)) return true;
  return params.segmentTotalHours > eps;
}
