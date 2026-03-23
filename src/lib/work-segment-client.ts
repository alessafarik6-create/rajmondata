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
