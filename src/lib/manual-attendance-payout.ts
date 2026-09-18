/**
 * Ruční docházka pro výplatu (uložená na employee_day_payouts, nemění attendance).
 */

export type ManualAttendanceWorkedResult =
  | { ok: true; presenceMinutes: number; workedMinutes: number }
  | { ok: false; error: string };

/** Parsuje HH:mm nebo H:mm na minuty od půlnoci. */
export function parseTimeHmToMinutes(hm: string): number | null {
  const t = hm.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59 || h < 0 || h > 23) {
    return null;
  }
  return h * 60 + min;
}

export function formatMinutesAsHm(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function computeManualAttendanceWorkedMinutes(
  checkInHm: string,
  checkOutHm: string,
  breakMinutesRaw: number
): ManualAttendanceWorkedResult {
  const inM = parseTimeHmToMinutes(checkInHm);
  const outM = parseTimeHmToMinutes(checkOutHm);
  if (inM === null || outM === null) {
    return { ok: false, error: "Zadejte příchod a odchod ve formátu HH:mm (např. 07:00)." };
  }
  if (outM <= inM) {
    return { ok: false, error: "Odchod musí být po příchodu ve stejný den." };
  }
  const presenceMinutes = outM - inM;
  const breakMinutes = Math.max(0, Math.round(breakMinutesRaw));
  if (breakMinutes > presenceMinutes) {
    return { ok: false, error: "Přestávka nesmí být delší než celková přítomnost." };
  }
  const workedMinutes = presenceMinutes - breakMinutes;
  if (workedMinutes < 0) {
    return { ok: false, error: "Výsledný čas nesmí být záporný." };
  }
  return { ok: true, presenceMinutes, workedMinutes };
}

export type DayPayrollWorkedInput = {
  terminalWorkedH: number | null;
  terminalIncomplete: boolean;
  manualWorkedMinutes: number | null;
  adjustmentMinutes: number;
};

/** base = manual override nebo terminál; final = base + korekce (min. 0). */
export function resolveDayPayrollWorkedMinutes(input: DayPayrollWorkedInput): {
  baseMinutes: number;
  finalMinutes: number;
  finalWorkedH: number;
  blockPayForIncompleteTerminal: boolean;
} {
  const adj = Math.round(input.adjustmentMinutes) || 0;
  const manual =
    input.manualWorkedMinutes != null && input.manualWorkedMinutes > 0
      ? Math.round(input.manualWorkedMinutes)
      : null;

  let baseMinutes = 0;
  if (manual != null) {
    baseMinutes = manual;
  } else if (!input.terminalIncomplete && input.terminalWorkedH != null) {
    baseMinutes = Math.max(0, Math.round(input.terminalWorkedH * 60));
  }

  const finalMinutes = Math.max(0, baseMinutes + adj);
  const finalWorkedH = Math.round((finalMinutes / 60) * 100) / 100;
  const blockPayForIncompleteTerminal =
    input.terminalIncomplete && manual == null && finalMinutes === 0;

  return {
    baseMinutes,
    finalMinutes,
    finalWorkedH,
    blockPayForIncompleteTerminal,
  };
}
