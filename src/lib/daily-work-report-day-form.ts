/**
 * Pomůcky pro jeden denní formulář výkazu: sloučení odemčených úseků do jedné řady řádků
 * a zpětné rozložení na segmentJobSplits pro API (sekvenční čerpání v čase úseků).
 */

import {
  DAILY_REPORT_ROW_SOURCE_MANUAL,
  DAILY_REPORT_ROW_SOURCE_TERMINAL,
  NO_JOB_SEGMENT_JOB_ID,
  isLegacyVirtualManualSegmentId,
  isNoJobSegmentJobId,
} from "@/lib/daily-work-report-constants";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  effectiveSegmentDurationHours,
  getTerminalSegmentLockKind,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";

/** Řádek pro POST /api/employee/daily-work-report */
export type DailyReportJobSplitPayload =
  | { segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL; jobId: string; hours: number }
  | {
      segmentType: typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
      segmentId: string;
      jobId: string;
      hours: number;
    };

/** Minimální délka úseku pro výpočty uzamčení/odemčení (0.02 h = 1,2 min vyřadilo reálné krátké úseky). */
const FILTER_MIN_DURATION = 0.0001;
/** Epsilon pro sekvenční čerpání fronty (ne 0.02 — u úseků < 0.02 h by se nic nerozdělilo). */
const LOOP_EPS = 1e-9;

/** Načtení uloženého výkazu: ruční řádek (nový tvar nebo starý virtuální segmentId). */
function savedRowIsManual(item: {
  segmentId?: unknown;
  segmentType?: unknown;
}): boolean {
  if (String(item.segmentType ?? "").trim() === DAILY_REPORT_ROW_SOURCE_MANUAL) return true;
  const sid = item.segmentId;
  if (sid === null || sid === undefined) return true;
  if (typeof sid === "string" && sid.trim() === "") return true;
  return isLegacyVirtualManualSegmentId(String(sid));
}

export type DayFormRow = {
  rowId: string;
  jobId: string;
  hoursStr: string;
  lineNote: string;
};

export function segmentDurationHours(seg: WorkSegmentClient): number {
  return effectiveSegmentDurationHours(seg);
}

export function splitLockedUnlocked(segments: WorkSegmentClient[]): {
  locked: WorkSegmentClient[];
  unlocked: WorkSegmentClient[];
} {
  const locked: WorkSegmentClient[] = [];
  const unlocked: WorkSegmentClient[] = [];
  for (const s of segments) {
    if (getTerminalSegmentLockKind(s) !== "none") locked.push(s);
    else unlocked.push(s);
  }
  return {
    locked,
    unlocked: sortSegmentsByStart(unlocked),
  };
}

/** Rozdělení uzamčeno/odemčeno jen u úseků s kladnou délkou (pro výpočty a výkaz). */
export function effectiveLockedUnlocked(segments: WorkSegmentClient[]): {
  locked: WorkSegmentClient[];
  unlocked: WorkSegmentClient[];
} {
  const { locked, unlocked } = splitLockedUnlocked(segments);
  const pos = (s: WorkSegmentClient) => segmentDurationHours(s) > FILTER_MIN_DURATION;
  return {
    locked: locked.filter(pos),
    unlocked: unlocked.filter(pos),
  };
}

/** Součet délek uzavřených úseků (terminál). */
export function sumClosedSegmentHours(segments: WorkSegmentClient[]): number {
  let s = 0;
  for (const seg of segments) {
    s += segmentDurationHours(seg);
  }
  return Math.round(s * 100) / 100;
}

/**
 * Z uloženého výkazu složí jednu řadu řádků pro odemčené úseky (pořadí podle začátku úseku).
 */
export function mergeUnlockedRowsFromReport(
  unlockedSegments: WorkSegmentClient[],
  report: Record<string, unknown> | null | undefined
): DayFormRow[] {
  const saved = report?.segmentJobSplits;
  const bySeg = new Map<string, DayFormRow[]>();
  if (Array.isArray(saved) && saved.length > 0) {
    for (const item of saved as {
      segmentId?: string;
      segmentType?: string;
      jobId?: string;
      hours?: number;
    }[]) {
      const hr = typeof item.hours === "number" && Number.isFinite(item.hours) ? item.hours : 0;
      if (savedRowIsManual(item) || hr <= 0) continue;
      const sid = String(item.segmentId || "").trim();
      if (!sid) continue;
      const rawJid = String(item.jobId || "").trim();
      const jid = isNoJobSegmentJobId(rawJid) ? "" : rawJid;
      if (!bySeg.has(sid)) bySeg.set(sid, []);
      bySeg.get(sid)!.push({
        rowId: `load-${sid}-${bySeg.get(sid)!.length}`,
        jobId: jid,
        hoursStr: String(hr).replace(".", ","),
        lineNote: "",
      });
    }
  }

  const savedLineNotes = report?.dayWorkLines;
  const notesByIndex: string[] = [];
  if (Array.isArray(savedLineNotes)) {
    for (const L of savedLineNotes as { lineNote?: string }[]) {
      notesByIndex.push(typeof L?.lineNote === "string" ? L.lineNote : "");
    }
  }

  const out: DayFormRow[] = [];
  let rowCounter = 0;
  let noteIdx = 0;
  for (const seg of unlockedSegments) {
    const rows = bySeg.get(seg.id);
    if (rows && rows.length > 0) {
      rows.forEach((r) => {
        const note = notesByIndex[noteIdx] ?? "";
        noteIdx += 1;
        out.push({
          ...r,
          rowId: r.rowId.startsWith("load-") ? `load-${seg.id}-${rowCounter++}` : r.rowId,
          lineNote: note,
        });
      });
    } else {
      const alloc = report?.segmentAllocations as { segmentId?: string; jobId?: string }[] | undefined;
      const legacyJob = typeof report?.jobId === "string" ? report.jobId.trim() : "";
      let jid = "";
      if (Array.isArray(alloc)) {
        const a = alloc.find((x) => String(x.segmentId || "").trim() === seg.id);
        if (a && String(a.jobId || "").trim()) jid = String(a.jobId).trim();
      }
      if (!jid) jid = legacyJob;
      const dur = segmentDurationHours(seg);
      const note = notesByIndex[noteIdx] ?? "";
      noteIdx += 1;
      out.push({
        rowId: `load-${seg.id}-${rowCounter++}`,
        jobId: jid,
        hoursStr: dur > 0 ? String(dur).replace(".", ",") : "",
        lineNote: note,
      });
    }
  }
  return out;
}

type ParseHours = (str: string) => number | null;

/**
 * Sekvenčně rozloží řádky formuláře na odemčené úseky (v pořadí času).
 * Vrací řádky terminálu pro segmentJobSplits.
 */
export function sequentialFillUnlockedSegments(
  unlockedSegments: WorkSegmentClient[],
  rows: DayFormRow[],
  parseHours: ParseHours
): DailyReportJobSplitPayload[] {
  type QueueItem = { jobId: string; hours: number };
  const queue: QueueItem[] = [];
  for (const r of rows) {
    const jidRaw = String(r.jobId || "").trim();
    const jid = jidRaw ? jidRaw : NO_JOB_SEGMENT_JOB_ID;
    const h = parseHours(r.hoursStr);
    if (h == null) continue;
    queue.push({ jobId: jid, hours: Math.round(h * 100) / 100 });
  }

  const out: DailyReportJobSplitPayload[] = [];

  for (const seg of unlockedSegments) {
    let need = segmentDurationHours(seg);
    if (need <= 0) continue;
    while (need > LOOP_EPS) {
      if (queue.length === 0) {
        throw new Error(
          "Nedostatek hodin v řádcích — součet musí pokrýt odemčené úseky z terminálu (v pořadí času)."
        );
      }
      const head = queue[0];
      const take = Math.min(need, head.hours);
      const rounded = Math.round(take * 100) / 100;
      out.push({
        segmentType: DAILY_REPORT_ROW_SOURCE_TERMINAL,
        segmentId: String(seg.id),
        jobId: head.jobId,
        hours: rounded,
      });
      need = Math.round((need - rounded) * 100) / 100;
      head.hours = Math.round((head.hours - rounded) * 100) / 100;
      if (head.hours <= LOOP_EPS) queue.shift();
    }
  }

  const leftover = queue.reduce((s, q) => s + q.hours, 0);
  if (leftover > LOOP_EPS) {
    throw new Error(
      `Součet hodin v řádcích (${Math.round(leftover * 100) / 100} h) překračuje součet délek odemčených úseků.`
    );
  }
  return out;
}

/** Uzamčené úseky z terminálu (tarif / zakázka) → řádky pro API. */
export function buildLockedTerminalSplits(lockedSegments: WorkSegmentClient[]): DailyReportJobSplitPayload[] {
  const sorted = sortSegmentsByStart(lockedSegments);
  const out: DailyReportJobSplitPayload[] = [];
  for (const seg of sorted) {
    const k = getTerminalSegmentLockKind(seg);
    const dur = segmentDurationHours(seg);
    if (dur <= 0) continue;
    if (k === "job_terminal") {
      const termJid = String(seg.jobId || "").trim();
      if (termJid) {
        out.push({
          segmentType: DAILY_REPORT_ROW_SOURCE_TERMINAL,
          segmentId: seg.id,
          jobId: termJid,
          hours: dur,
        });
      }
    } else if (k === "tariff_terminal") {
      out.push({
        segmentType: DAILY_REPORT_ROW_SOURCE_TERMINAL,
        segmentId: seg.id,
        jobId: NO_JOB_SEGMENT_JOB_ID,
        hours: dur,
      });
    }
  }
  return out;
}

/** Kompletní segmentJobSplits pro uložení výkazu. */
export function buildFullSegmentJobSplits(
  closedSegments: WorkSegmentClient[],
  dayFormRows: DayFormRow[],
  parseHours: ParseHours
): DailyReportJobSplitPayload[] {
  const { locked, unlocked } = effectiveLockedUnlocked(closedSegments);
  const head = buildLockedTerminalSplits(locked);
  if (unlocked.length === 0) {
    return [...head, ...buildAttendanceOnlySplits(dayFormRows, parseHours)];
  }
  const tail = sequentialFillUnlockedSegments(unlocked, dayFormRows, parseHours);
  return [...head, ...tail];
}

/** Výkaz pouze z odpracované docházky — bez úseků z terminálu (ruční řádky). */
export function buildAttendanceOnlySplits(
  dayFormRows: DayFormRow[],
  parseHours: ParseHours
): DailyReportJobSplitPayload[] {
  const out: DailyReportJobSplitPayload[] = [];
  for (const r of dayFormRows) {
    const h = parseHours(r.hoursStr);
    if (h == null || h <= 0) continue;
    const jidRaw = String(r.jobId || "").trim();
    const jid = jidRaw ? jidRaw : NO_JOB_SEGMENT_JOB_ID;
    out.push({
      segmentType: DAILY_REPORT_ROW_SOURCE_MANUAL,
      jobId: jid,
      hours: Math.round(h * 100) / 100,
    });
  }
  return out;
}

/**
 * Ruční řádky z uloženého výkazu (segmentType manual / starý virtuální segmentId), např. tarif
 * z terminálu a zbytek směny jen z docházky.
 */
export function mergeManualSplitsFromReport(
  report: Record<string, unknown> | null | undefined
): DayFormRow[] {
  const saved = report?.segmentJobSplits as
    | Array<{ segmentId?: string; segmentType?: string; jobId?: string; hours?: number }>
    | undefined;
  if (!saved?.length) return [];
  const notes = Array.isArray(report?.dayWorkLines)
    ? (report.dayWorkLines as { lineNote?: string }[])
    : [];
  const out: DayFormRow[] = [];
  let noteIdx = 0;
  let rowCounter = 0;
  for (const item of saved) {
    if (!savedRowIsManual(item)) continue;
    const hr = typeof item.hours === "number" && Number.isFinite(item.hours) ? item.hours : 0;
    if (hr <= 0) continue;
    const rawJid = String(item.jobId || "").trim();
    const jid = isNoJobSegmentJobId(rawJid) ? "" : rawJid;
    const rawLine = notes[noteIdx];
    const note =
      rawLine && typeof rawLine.lineNote === "string" ? rawLine.lineNote : "";
    noteIdx += 1;
    out.push({
      rowId: `load-manual-${rowCounter++}`,
      jobId: jid,
      hoursStr: String(hr).replace(".", ","),
      lineNote: note,
    });
  }
  return out;
}

/** Obnoví řádky z uloženého výkazu uloženého jen přes docházku (bez terminálových úseků). */
export function mergeAttendanceOnlyRowsFromReport(
  report: Record<string, unknown> | null | undefined
): DayFormRow[] {
  const saved = report?.segmentJobSplits as
    | Array<{ segmentId?: string; segmentType?: string; jobId?: string; hours?: number }>
    | undefined;
  if (!saved?.length) return [];
  if (!saved.every((s) => savedRowIsManual(s))) {
    return [];
  }
  const notes = Array.isArray(report?.dayWorkLines)
    ? (report.dayWorkLines as { lineNote?: string }[])
    : [];
  const out: DayFormRow[] = [];
  let noteIdx = 0;
  let rowCounter = 0;
  for (const item of saved) {
    const hr = typeof item.hours === "number" && Number.isFinite(item.hours) ? item.hours : 0;
    if (hr <= 0) continue;
    const rawJid = String(item.jobId || "").trim();
    const jid = isNoJobSegmentJobId(rawJid) ? "" : rawJid;
    const rawLine = notes[noteIdx];
    const note =
      rawLine && typeof rawLine.lineNote === "string" ? rawLine.lineNote : "";
    noteIdx += 1;
    out.push({
      rowId: `load-manual-${rowCounter++}`,
      jobId: jid,
      hoursStr: String(hr).replace(".", ","),
      lineNote: note,
    });
  }
  return out;
}
