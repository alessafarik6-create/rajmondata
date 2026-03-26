/**
 * Klientské pomůcky pro dokumenty work_segments (docházkový terminál).
 */

import { format } from "date-fns";
import { formatHm } from "./work-time-block";

/** Stejné jako server `workDayId` — jednoznačný klíč zaměstnanec + den (YYYY-MM-DD). */
export function buildWorkDayId(employeeId: string, dateIso: string): string {
  return `${employeeId}__${dateIso}`;
}

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
  /** Hodinová sazba pro tarif (nebo pro zakázku při sourceType job — z uložené sazby zakázky/tarifu). */
  hourlyRateCzk?: number | null;
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

/** Začátek úseku (Firestore Timestamp / Date). */
export function segmentStartTimestamp(seg: WorkSegmentClient): Date | null {
  return tsToDate(seg.startAt);
}

/** Konec úseku (Firestore Timestamp / Date). */
export function segmentEndTimestamp(seg: WorkSegmentClient): Date | null {
  return tsToDate(seg.endAt);
}

/**
 * Délka úseku v hodinách.
 * Pokud existují `startAt` i `endAt`, použije se výhradně rozdíl v ms (přesná délka).
 * Jinak fallback na `durationHours` (legacy / výkaz).
 */
export function effectiveSegmentDurationHours(seg: WorkSegmentClient): number {
  const a = tsToDate(seg.startAt);
  const b = tsToDate(seg.endAt);
  if (a && b && b > a) {
    const h = (b.getTime() - a.getTime()) / 36e5;
    return Math.round(h * 100) / 100;
  }
  const d =
    typeof seg.durationHours === "number" && Number.isFinite(seg.durationHours)
      ? seg.durationHours
      : 0;
  if (d > DUR_EPS) {
    return Math.round(d * 100) / 100;
  }
  return 0;
}

/**
 * Hodinová sazba uložená na segmentu (tarif nebo zakázka dle serveru).
 */
export function parseSegmentHourlyRateCzk(seg: WorkSegmentClient): number | null {
  const n = Number(seg.hourlyRateCzk);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Délka úseku pro přehled: uzavřený = jako výkaz; otevřený = od začátku do min(teď, konec dne)
 * u dnešního dne, u minulých dnů do konce kalendářního dne.
 */
export function segmentDurationForOverview(
  seg: WorkSegmentClient,
  dayIso: string,
  now: Date = new Date()
): number {
  const start = tsToDate(seg.startAt);
  if (!start) return 0;
  if (seg.closed === true) {
    return effectiveSegmentDurationHours(seg);
  }
  const endFromDb = tsToDate(seg.endAt);
  if (endFromDb && endFromDb > start) {
    return effectiveSegmentDurationHours(seg);
  }
  const [y, m, d] = dayIso.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const todayIso = format(now, "yyyy-MM-dd");
  const capEnd = todayIso === dayIso ? (now < dayEnd ? now : dayEnd) : dayEnd;
  if (capEnd <= start) return 0;
  return Math.round(((capEnd.getTime() - start.getTime()) / 36e5) * 100) / 100;
}

export function formatTimeHm(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

/** Začátek / konec pro přehled — otevřený úsek bez konec → „probíhá“. */
export function segmentStartEndDisplay(seg: WorkSegmentClient): {
  startHm: string;
  endHm: string | null;
  endLabel: string;
} {
  const start = tsToDate(seg.startAt);
  const end = tsToDate(seg.endAt);
  const startHm = start ? formatTimeHm(start) : "—";
  if (seg.closed !== true) {
    if (end && start && end > start) {
      const eh = formatTimeHm(end);
      return { startHm, endHm: eh, endLabel: eh };
    }
    return { startHm, endHm: null, endLabel: "probíhá" };
  }
  if (end && start && end > start) {
    const eh = formatTimeHm(end);
    return { startHm, endHm: eh, endLabel: eh };
  }
  return { startHm, endHm: null, endLabel: "—" };
}

/**
 * Den úseku jako YYYY-MM-DD — pole `date` může být řetězec nebo Firestore Timestamp.
 */
export function segmentDateIsoKey(seg: { date?: unknown }): string {
  const d = seg?.date;
  if (d == null) return "";
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return format(d, "yyyy-MM-dd");
  }
  if (typeof (d as { toDate?: () => Date }).toDate === "function") {
    try {
      return format((d as { toDate: () => Date }).toDate(), "yyyy-MM-dd");
    } catch {
      return "";
    }
  }
  return "";
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
      segmentDateIsoKey(s) === dayIso &&
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
