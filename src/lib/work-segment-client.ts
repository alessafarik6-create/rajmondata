/**
 * Klientské pomůcky pro dokumenty work_segments (docházkový terminál).
 */

import { formatHm } from "./work-time-block";

export type WorkSegmentClient = {
  id: string;
  employeeId?: string;
  date?: string;
  closed?: boolean;
  sourceType?: string;
  jobId?: string | null;
  jobName?: string;
  displayName?: string;
  tariffName?: string;
  durationHours?: number | null;
  totalAmountCzk?: number | null;
  startAt?: { toDate?: () => Date } | null;
  endAt?: { toDate?: () => Date } | null;
};

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

const DUR_EPS = 0.001;

/**
 * Délka úseku v hodinách: nejdřív `durationHours`, jinak rozdíl začátek/konec.
 * Bez toho často zmizí „odemčené“ úseky z výkazu (duration 0 → prázdný formulář).
 */
export function effectiveSegmentDurationHours(seg: WorkSegmentClient): number {
  const d =
    typeof seg.durationHours === "number" && Number.isFinite(seg.durationHours)
      ? seg.durationHours
      : 0;
  if (d > DUR_EPS) {
    return Math.round(d * 100) / 100;
  }
  const a = tsToDate(seg.startAt);
  const b = tsToDate(seg.endAt);
  if (a && b && b > a) {
    const h = (b.getTime() - a.getTime()) / 36e5;
    return Math.round(h * 100) / 100;
  }
  return 0;
}

export function formatTimeHm(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

/** Uzavřené segmenty z terminálu pro daný den. */
export function closedTerminalSegmentsForDay(
  segments: WorkSegmentClient[] | null | undefined,
  dayIso: string
): WorkSegmentClient[] {
  const list = Array.isArray(segments) ? segments : [];
  return list.filter(
    (s) =>
      s.closed === true &&
      String(s.date || "") === dayIso &&
      (s.sourceType === "job" || s.sourceType === "tariff")
  );
}

export function segmentTimeRangeLabel(seg: WorkSegmentClient): string {
  const a = tsToDate(seg.startAt);
  const b = tsToDate(seg.endAt);
  if (a && b) {
    return `${formatTimeHm(a)} – ${formatTimeHm(b)}`;
  }
  if (typeof seg.durationHours === "number") {
    return `${seg.durationHours} h`;
  }
  return "—";
}

/** Lokální HH:mm pro začátek a konec segmentu (pro výkaz práce). */
export function segmentClockHmRange(
  seg: WorkSegmentClient
): { startHm: string; endHm: string } | null {
  const a = tsToDate(seg.startAt);
  const b = tsToDate(seg.endAt);
  if (!a || !b) return null;
  return {
    startHm: formatHm(a.getHours(), a.getMinutes()),
    endHm: formatHm(b.getHours(), b.getMinutes()),
  };
}

export function sortSegmentsByStart(
  segments: WorkSegmentClient[]
): WorkSegmentClient[] {
  return [...segments].sort((x, y) => {
    const ax = tsToDate(x.startAt)?.getTime() ?? 0;
    const ay = tsToDate(y.startAt)?.getTime() ?? 0;
    if (ax !== ay) return ax - ay;
    return String(x.id).localeCompare(String(y.id));
  });
}

/** Typ uzamčení úseku z terminálu pro denní výkaz. */
export type TerminalSegmentLockKind = "none" | "job_terminal" | "tariff_terminal";

/**
 * Úsek z terminálu je uzamčený pro rozdělení času, pokud byl zvolen tarif,
 * nebo zakázka (job + jobId). Rozdělení je povoleno jen u úseků „job“ bez vybrané zakázky.
 */
export function getTerminalSegmentLockKind(
  seg: WorkSegmentClient
): TerminalSegmentLockKind {
  if (seg.sourceType === "tariff") return "tariff_terminal";
  if (seg.sourceType === "job" && Boolean(String(seg.jobId || "").trim())) {
    return "job_terminal";
  }
  return "none";
}

export function isSegmentLockedFromTerminal(seg: WorkSegmentClient): boolean {
  return getTerminalSegmentLockKind(seg) !== "none";
}
