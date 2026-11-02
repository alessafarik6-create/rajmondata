/**
 * Propojení docházky, QR výrobních intervalů a mzdových podkladů — bez dvojího započítání.
 * Uznávané hodiny pro mzdu = docházka / schválený denní výkaz; QR = alokace na zakázky.
 */

import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";

export const LABOR_APP_TIMEZONE = "Europe/Prague";

export function localDayKeyFromIsoTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LABOR_APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function dateStrInRange(dayIso: string, fromIso: string, toIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) return false;
  if (fromIso && dayIso < fromIso) return false;
  if (toIso && dayIso > toIso) return false;
  return true;
}

export type ProductionIntervalInput = {
  id: string;
  companyId: string;
  employeeId: string;
  jobId: string;
  jobNumber?: string | null;
  jobName?: string | null;
  productionTaskId: string;
  taskName?: string | null;
  startedAtIso: string;
  endedAtIso?: string | null;
  durationSeconds?: number | null;
  endedReason?: string | null;
  source?: string | null;
  workDateIso?: string | null;
};

export type DayAttendanceInput = {
  dayIso: string;
  /** Uznané odpracované hodiny z docházky (net). */
  hoursWorked: number | null;
  breakMinutes?: number | null;
};

export type DayDailyReportInput = {
  dayIso: string;
  status: string;
  hoursConfirmed?: number | null;
  hoursFromAttendance?: number | null;
  payableAmountCzk?: number | null;
};

export type WorkStatementIntervalRow = {
  id: string;
  workDateIso: string;
  jobId: string;
  jobNumber: string;
  jobName: string;
  productionTaskId: string;
  operationName: string;
  startedAtIso: string;
  endedAtIso: string | null;
  durationMinutes: number;
  durationLabel: string;
  source: "qr" | "manual";
  endReason: string | null;
  hourlyRateCzk: number | null;
  amountCzk: number | null;
  isRunning: boolean;
};

export type WorkStatementAnomaly = {
  code:
    | "qr_without_attendance"
    | "attendance_without_qr_allocation"
    | "qr_exceeds_attendance"
    | "overlapping_qr_intervals"
    | "unclosed_interval"
    | "long_operation"
    | "duplicate_start";
  severity: "info" | "warning" | "critical";
  message: string;
  workDateIso?: string;
  entryId?: string;
};

export type WorkStatementHoursBySource = {
  /** Hodiny uznávané pro mzdu (docházka / schválený výkaz) — nikdy se nesčítají s QR. */
  recognizedPayableHours: number;
  attendanceNetHours: number;
  terminalSegmentHours: number;
  qrJobHours: number;
  qrAssignedToJobsHours: number;
  unassignedToJobHours: number;
  overtimeHours: number;
  breakHours: number;
  manualCorrectionHours: number;
  pendingApprovalHours: number;
};

export type WorkStatementSummary = {
  totalQrMinutes: number;
  totalQrHours: number;
  distinctWorkDays: number;
  distinctJobs: number;
  distinctOperations: number;
  earningsFromQrTariffKc: number;
  openAnomalyCount: number;
};

function entryDurationMinutes(row: ProductionIntervalInput, nowMs: number): number {
  if (row.endedAtIso && row.durationSeconds != null && Number.isFinite(row.durationSeconds)) {
    return Math.max(0, Math.round(Number(row.durationSeconds) / 60));
  }
  const start = new Date(row.startedAtIso).getTime();
  if (Number.isNaN(start)) return 0;
  const end = row.endedAtIso ? new Date(row.endedAtIso).getTime() : nowMs;
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

function resolveRecognizedHoursForDay(
  att: DayAttendanceInput | undefined,
  report: DayDailyReportInput | undefined
): number {
  if (report?.status === "approved") {
    const h = Number(report.hoursConfirmed ?? report.hoursFromAttendance ?? 0);
    if (Number.isFinite(h) && h > 0) return Math.round(h * 100) / 100;
  }
  const ah = att?.hoursWorked;
  if (ah != null && Number.isFinite(ah) && ah > 0) return Math.round(ah * 100) / 100;
  return 0;
}

/** Překryvy intervalů v minutách (dvojí aktivní operace). */
export function computeOverlappingQrMinutes(
  intervals: Array<{ startMs: number; endMs: number }>
): number {
  const sorted = [...intervals]
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let overlap = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.startMs >= a.endMs) break;
      const oStart = Math.max(a.startMs, b.startMs);
      const oEnd = Math.min(a.endMs, b.endMs);
      if (oEnd > oStart) overlap += Math.round((oEnd - oStart) / 60000);
    }
  }
  return overlap;
}

export function buildWorkStatementIntervalRows(params: {
  entries: ProductionIntervalInput[];
  fromIso: string;
  toIso: string;
  hourlyRateCzk: number | null;
  includeMoney: boolean;
  nowMs?: number;
}): WorkStatementIntervalRow[] {
  const nowMs = params.nowMs ?? Date.now();
  const rate =
    params.hourlyRateCzk != null && Number.isFinite(params.hourlyRateCzk)
      ? params.hourlyRateCzk
      : null;
  const rows: WorkStatementIntervalRow[] = [];
  for (const e of params.entries) {
    const workDateIso =
      String(e.workDateIso ?? "").trim().slice(0, 10) ||
      localDayKeyFromIsoTimestamp(e.startedAtIso);
    if (!dateStrInRange(workDateIso, params.fromIso, params.toIso)) continue;
    const mins = entryDurationMinutes(e, nowMs);
    const isRunning = !e.endedAtIso;
    const amount =
      params.includeMoney && rate != null && mins > 0
        ? Math.round((mins / 60) * rate * 100) / 100
        : null;
    rows.push({
      id: e.id,
      workDateIso,
      jobId: e.jobId,
      jobNumber: String(e.jobNumber ?? "").trim(),
      jobName: String(e.jobName ?? "").trim() || e.jobId,
      productionTaskId: e.productionTaskId,
      operationName: String(e.taskName ?? "").trim() || e.productionTaskId,
      startedAtIso: e.startedAtIso,
      endedAtIso: e.endedAtIso ?? null,
      durationMinutes: mins,
      durationLabel: formatDurationCs(mins * 60),
      source: e.source === "manual" ? "manual" : "qr",
      endReason: e.endedReason ? String(e.endedReason) : null,
      hourlyRateCzk: params.includeMoney ? rate : null,
      amountCzk: amount,
      isRunning,
    });
  }
  rows.sort(
    (a, b) =>
      b.workDateIso.localeCompare(a.workDateIso) ||
      a.startedAtIso.localeCompare(b.startedAtIso)
  );
  return rows;
}

export function computeWorkStatementHoursBySource(params: {
  intervalRows: WorkStatementIntervalRow[];
  attendanceByDay: Map<string, DayAttendanceInput>;
  dailyReportsByDay: Map<string, DayDailyReportInput>;
  terminalHoursByDay: Map<string, number>;
  fromIso: string;
  toIso: string;
}): WorkStatementHoursBySource {
  const qrByDay = new Map<string, number>();
  for (const r of params.intervalRows) {
    if (r.isRunning) continue;
    qrByDay.set(r.workDateIso, (qrByDay.get(r.workDateIso) ?? 0) + r.durationMinutes / 60);
  }

  let recognized = 0;
  let attendanceNet = 0;
  let terminal = 0;
  let unassigned = 0;
  let pending = 0;
  let breakH = 0;

  const dayKeys = new Set<string>();
  for (const k of qrByDay.keys()) dayKeys.add(k);
  for (const k of params.attendanceByDay.keys()) dayKeys.add(k);
  for (const k of params.dailyReportsByDay.keys()) dayKeys.add(k);

  for (const dayIso of dayKeys) {
    if (!dateStrInRange(dayIso, params.fromIso, params.toIso)) continue;
    const att = params.attendanceByDay.get(dayIso);
    const rep = params.dailyReportsByDay.get(dayIso);
    const rec = resolveRecognizedHoursForDay(att, rep);
    const qrH = Math.round((qrByDay.get(dayIso) ?? 0) * 100) / 100;
    recognized += rec;
    attendanceNet += att?.hoursWorked ?? 0;
    terminal += params.terminalHoursByDay.get(dayIso) ?? 0;
    if (rep && rep.status !== "approved" && rep.status !== "rejected") {
      const h = Number(rep.hoursConfirmed ?? rep.hoursFromAttendance ?? 0);
      if (Number.isFinite(h)) pending += h;
    }
    const br = att?.breakMinutes;
    if (br != null && Number.isFinite(br)) breakH += br / 60;
    if (rec > 0 && qrH < rec - 0.08) {
      unassigned += Math.round((rec - qrH) * 100) / 100;
    }
  }

  const qrJobHours = [...qrByDay.values()].reduce((s, h) => s + h, 0);

  return {
    recognizedPayableHours: Math.round(recognized * 100) / 100,
    attendanceNetHours: Math.round(attendanceNet * 100) / 100,
    terminalSegmentHours: Math.round(terminal * 100) / 100,
    qrJobHours: Math.round(qrJobHours * 100) / 100,
    qrAssignedToJobsHours: Math.round(qrJobHours * 100) / 100,
    unassignedToJobHours: Math.round(unassigned * 100) / 100,
    overtimeHours: 0,
    breakHours: Math.round(breakH * 100) / 100,
    manualCorrectionHours: 0,
    pendingApprovalHours: Math.round(pending * 100) / 100,
  };
}

export function detectWorkStatementAnomalies(params: {
  intervalRows: WorkStatementIntervalRow[];
  attendanceByDay: Map<string, DayAttendanceInput>;
  dailyReportsByDay: Map<string, DayDailyReportInput>;
}): WorkStatementAnomaly[] {
  const out: WorkStatementAnomaly[] = [];
  const qrByDay = new Map<string, number>();
  const startsByDay = new Map<string, string[]>();

  for (const r of params.intervalRows) {
    qrByDay.set(r.workDateIso, (qrByDay.get(r.workDateIso) ?? 0) + r.durationMinutes / 60);
    const list = startsByDay.get(r.workDateIso) ?? [];
    list.push(r.startedAtIso);
    startsByDay.set(r.workDateIso, list);
    if (r.isRunning) {
      out.push({
        code: "unclosed_interval",
        severity: "warning",
        message: `Neuzavřený QR interval (${r.operationName}, ${r.workDateIso}).`,
        workDateIso: r.workDateIso,
        entryId: r.id,
      });
    }
    if (r.durationMinutes > 12 * 60) {
      out.push({
        code: "long_operation",
        severity: "warning",
        message: `Podezřele dlouhá operace (${r.durationLabel}).`,
        workDateIso: r.workDateIso,
        entryId: r.id,
      });
    }
  }

  for (const [dayIso, starts] of startsByDay) {
    const uniq = new Set(starts);
    if (uniq.size < starts.length) {
      out.push({
        code: "duplicate_start",
        severity: "info",
        message: `Duplicitní začátky QR záznamů dne ${dayIso}.`,
        workDateIso: dayIso,
      });
    }
  }

  const intervalsMs = params.intervalRows
    .filter((r) => !r.isRunning && r.endedAtIso)
    .map((r) => ({
      startMs: new Date(r.startedAtIso).getTime(),
      endMs: new Date(r.endedAtIso!).getTime(),
    }));
  const overlapMin = computeOverlappingQrMinutes(intervalsMs);
  if (overlapMin > 2) {
    out.push({
      code: "overlapping_qr_intervals",
      severity: "critical",
      message: `Překryv QR intervalů cca ${overlapMin} min (dvě operace současně).`,
    });
  }

  for (const [dayIso, qrH] of qrByDay) {
    const att = params.attendanceByDay.get(dayIso);
    const rep = params.dailyReportsByDay.get(dayIso);
    const rec = resolveRecognizedHoursForDay(att, rep);
    if (qrH > 0.08 && rec < 0.08) {
      out.push({
        code: "qr_without_attendance",
        severity: "warning",
        message: `QR práce ${Math.round(qrH * 10) / 10} h bez uznané docházky (${dayIso}) — ke kontrole.`,
        workDateIso: dayIso,
      });
    } else if (rec > 0.08 && qrH + 0.08 < rec) {
      out.push({
        code: "attendance_without_qr_allocation",
        severity: "warning",
        message: `Zaměstnanec má ${Math.round(rec * 10) / 10} h docházky, ale pouze ${Math.round(qrH * 10) / 10} h přiřazených k zakázkám (${dayIso}).`,
        workDateIso: dayIso,
      });
    } else if (qrH > rec + 0.25) {
      out.push({
        code: "qr_exceeds_attendance",
        severity: "warning",
        message: `Součet QR (${Math.round(qrH * 10) / 10} h) převyšuje uznanou docházku (${Math.round(rec * 10) / 10} h) dne ${dayIso}.`,
        workDateIso: dayIso,
      });
    }
  }

  return out;
}

export function computeWorkStatementSummary(params: {
  intervalRows: WorkStatementIntervalRow[];
  anomalies: WorkStatementAnomaly[];
  includeMoney: boolean;
}): WorkStatementSummary {
  let totalMin = 0;
  let earnings = 0;
  const days = new Set<string>();
  const jobs = new Set<string>();
  const ops = new Set<string>();
  for (const r of params.intervalRows) {
    if (r.isRunning) continue;
    totalMin += r.durationMinutes;
    days.add(r.workDateIso);
    if (r.jobId) jobs.add(r.jobId);
    if (r.productionTaskId) ops.add(r.productionTaskId);
    if (params.includeMoney && r.amountCzk != null) earnings += r.amountCzk;
  }
  return {
    totalQrMinutes: totalMin,
    totalQrHours: Math.round((totalMin / 60) * 100) / 100,
    distinctWorkDays: days.size,
    distinctJobs: jobs.size,
    distinctOperations: ops.size,
    earningsFromQrTariffKc: params.includeMoney ? Math.round(earnings * 100) / 100 : 0,
    openAnomalyCount: params.anomalies.filter((a) => a.severity !== "info").length,
  };
}
