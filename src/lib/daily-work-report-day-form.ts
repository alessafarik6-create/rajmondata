/**
 * Pomůcky pro jeden denní formulář výkazu: sloučení odemčených úseků do jedné řady řádků
 * a zpětné rozložení na segmentJobSplits pro API (sekvenční čerpání v čase úseků).
 */

import { NO_JOB_SEGMENT_JOB_ID, isNoJobSegmentJobId } from "@/lib/daily-work-report-constants";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  effectiveSegmentDurationHours,
  getTerminalSegmentLockKind,
  sortSegmentsByStart,
} from "@/lib/work-segment-client";

const EPS = 0.02;

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
  const pos = (s: WorkSegmentClient) => segmentDurationHours(s) > EPS;
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
    for (const item of saved as { segmentId?: string; jobId?: string; hours?: number }[]) {
      const sid = String(item.segmentId || "").trim();
      const rawJid = String(item.jobId || "").trim();
      const jid = isNoJobSegmentJobId(rawJid) ? "" : rawJid;
      const hr = typeof item.hours === "number" && Number.isFinite(item.hours) ? item.hours : 0;
      if (!sid || hr <= 0) continue;
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
 * Vrací kusy { segmentId, jobId, hours } pro segmentJobSplits.
 */
export function sequentialFillUnlockedSegments(
  unlockedSegments: WorkSegmentClient[],
  rows: DayFormRow[],
  parseHours: ParseHours
): Array<{ segmentId: string; jobId: string; hours: number }> {
  type QueueItem = { jobId: string; hours: number };
  const queue: QueueItem[] = [];
  for (const r of rows) {
    const jidRaw = String(r.jobId || "").trim();
    const jid = jidRaw ? jidRaw : NO_JOB_SEGMENT_JOB_ID;
    const h = parseHours(r.hoursStr);
    if (h == null) continue;
    queue.push({ jobId: jid, hours: Math.round(h * 100) / 100 });
  }

  const out: Array<{ segmentId: string; jobId: string; hours: number }> = [];

  for (const seg of unlockedSegments) {
    let need = segmentDurationHours(seg);
    if (need <= 0) continue;
    while (need > EPS) {
      if (queue.length === 0) {
        throw new Error(
          "Nedostatek hodin v řádcích — součet musí pokrýt odemčené úseky z terminálu (v pořadí času)."
        );
      }
      const head = queue[0];
      const take = Math.min(need, head.hours);
      const rounded = Math.round(take * 100) / 100;
      out.push({ segmentId: seg.id, jobId: head.jobId, hours: rounded });
      need = Math.round((need - rounded) * 100) / 100;
      head.hours = Math.round((head.hours - rounded) * 100) / 100;
      if (head.hours <= EPS) queue.shift();
    }
  }

  const leftover = queue.reduce((s, q) => s + q.hours, 0);
  if (leftover > EPS) {
    throw new Error(
      `Součet hodin v řádcích (${Math.round(leftover * 100) / 100} h) překračuje součet délek odemčených úseků.`
    );
  }
  return out;
}

/** Uzamčené úseky z terminálu (tarif / zakázka) → řádky pro API. */
export function buildLockedTerminalSplits(
  lockedSegments: WorkSegmentClient[]
): Array<{ segmentId: string; jobId: string; hours: number }> {
  const sorted = sortSegmentsByStart(lockedSegments);
  const out: Array<{ segmentId: string; jobId: string; hours: number }> = [];
  for (const seg of sorted) {
    const k = getTerminalSegmentLockKind(seg);
    const dur = segmentDurationHours(seg);
    if (dur <= 0) continue;
    if (k === "job_terminal") {
      const termJid = String(seg.jobId || "").trim();
      if (termJid) out.push({ segmentId: seg.id, jobId: termJid, hours: dur });
    } else if (k === "tariff_terminal") {
      out.push({ segmentId: seg.id, jobId: NO_JOB_SEGMENT_JOB_ID, hours: dur });
    }
  }
  return out;
}

/** Kompletní segmentJobSplits pro uložení výkazu. */
export function buildFullSegmentJobSplits(
  closedSegments: WorkSegmentClient[],
  dayFormRows: DayFormRow[],
  parseHours: ParseHours
): Array<{ segmentId: string; jobId: string; hours: number }> {
  const { locked, unlocked } = effectiveLockedUnlocked(closedSegments);
  const head = buildLockedTerminalSplits(locked);
  if (unlocked.length === 0) return head;
  const tail = sequentialFillUnlockedSegments(unlocked, dayFormRows, parseHours);
  return [...head, ...tail];
}
