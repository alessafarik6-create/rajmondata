/**
 * Pomůcky pro administrátorskou úpravu uloženého denního výkazu (bez plné validace terminálu).
 */

import {
  DAILY_REPORT_ROW_SOURCE_MANUAL,
  DAILY_REPORT_ROW_SOURCE_TERMINAL,
  NO_JOB_SEGMENT_JOB_ID,
  isNoJobSegmentJobId,
} from "@/lib/daily-work-report-constants";

export type AdminPatchSplitRow = {
  segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL | typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
  segmentId: string | null;
  jobId: string;
  jobName: string | null;
  hours: number;
  /** Volitelná poznámka k řádku (admin / rozšířené uložení). */
  lineNote?: string;
};

export function normalizeJobIdForDailyReport(raw: unknown): string {
  const j = String(raw ?? "").trim();
  if (!j || isNoJobSegmentJobId(j)) return NO_JOB_SEGMENT_JOB_ID;
  return j;
}

export function parseAdminPatchSplits(raw: unknown): AdminPatchSplitRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AdminPatchSplitRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") return null;
    const o = row as Record<string, unknown>;
    const st = String(o.segmentType ?? "").trim();
    if (st !== DAILY_REPORT_ROW_SOURCE_MANUAL && st !== DAILY_REPORT_ROW_SOURCE_TERMINAL) {
      return null;
    }
    const sidRaw = o.segmentId;
    const segmentId =
      sidRaw === null || sidRaw === undefined
        ? null
        : String(sidRaw).trim() === ""
          ? null
          : String(sidRaw).trim();
    if (st === DAILY_REPORT_ROW_SOURCE_TERMINAL && !segmentId) {
      return null;
    }
    if (st === DAILY_REPORT_ROW_SOURCE_MANUAL && segmentId) {
      return null;
    }
    const hoursNum = Number(o.hours);
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
      return null;
    }
    const hours = Math.round(hoursNum * 100) / 100;
    const jobId = normalizeJobIdForDailyReport(o.jobId);
    const jobName =
      typeof o.jobName === "string" && o.jobName.trim() ? o.jobName.trim() : null;
    const lineNote =
      typeof o.lineNote === "string" ? o.lineNote.trim().slice(0, 4000) : undefined;
    out.push({
      segmentType: st,
      segmentId: st === DAILY_REPORT_ROW_SOURCE_MANUAL ? null : segmentId,
      jobId,
      jobName,
      hours,
      ...(lineNote !== undefined && lineNote !== "" ? { lineNote } : {}),
    });
  }
  return out;
}

export function buildSegmentAllocationsFromAdminSplits(
  splits: AdminPatchSplitRow[]
): Array<{
  segmentId: string | null;
  segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL | typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
  jobId: string;
  jobName: string | null;
}> {
  const terminalSeen = new Set<string>();
  const segmentAllocations: Array<{
    segmentId: string | null;
    segmentType: typeof DAILY_REPORT_ROW_SOURCE_MANUAL | typeof DAILY_REPORT_ROW_SOURCE_TERMINAL;
    jobId: string;
    jobName: string | null;
  }> = [];

  for (const s of splits) {
    if (s.segmentType !== DAILY_REPORT_ROW_SOURCE_TERMINAL || !s.segmentId) continue;
    if (terminalSeen.has(s.segmentId)) continue;
    terminalSeen.add(s.segmentId);
    segmentAllocations.push({
      segmentId: s.segmentId,
      segmentType: DAILY_REPORT_ROW_SOURCE_TERMINAL,
      jobId: s.jobId,
      jobName: s.jobName,
    });
  }

  const firstManual = splits.find((x) => x.segmentType === DAILY_REPORT_ROW_SOURCE_MANUAL);
  if (firstManual) {
    segmentAllocations.push({
      segmentId: null,
      segmentType: DAILY_REPORT_ROW_SOURCE_MANUAL,
      jobId: firstManual.jobId,
      jobName: firstManual.jobName,
    });
  }

  return segmentAllocations;
}

export function primaryJobFromSplits(splits: AdminPatchSplitRow[]): {
  primaryJobId: string | null;
  primaryJobName: string | null;
} {
  const firstWithJob = splits.find((s) => !isNoJobSegmentJobId(s.jobId));
  return {
    primaryJobId: firstWithJob?.jobId ?? null,
    primaryJobName: firstWithJob?.jobName ?? null,
  };
}

export function sumSplitHours(splits: AdminPatchSplitRow[]): number {
  let s = 0;
  for (const r of splits) {
    s += r.hours;
  }
  return Math.round(s * 100) / 100;
}
