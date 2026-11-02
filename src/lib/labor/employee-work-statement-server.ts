import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { productionTasksCol, productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";
import type { AttendanceRow } from "@/lib/employee-attendance";
import {
  attendanceRowCalendarDateKey,
  getDayAttendanceSummaryForLocalDay,
} from "@/lib/employee-attendance";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import { segmentCalendarDateIsoKey, segmentDurationForOverview } from "@/lib/work-segment-client";
import {
  buildWorkStatementIntervalRows,
  computeWorkStatementHoursBySource,
  computeWorkStatementSummary,
  detectWorkStatementAnomalies,
  dateStrInRange,
  localDayKeyFromIsoTimestamp,
  type DayAttendanceInput,
  type DayDailyReportInput,
  type ProductionIntervalInput,
} from "@/lib/labor/employee-work-statement";

function tsToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

async function mapProductionEntries(
  db: Firestore,
  companyId: string,
  employeeId: string,
  fromIso: string,
  toIso: string
): Promise<ProductionIntervalInput[]> {
  const snap = await productionTimeEntriesCol(db, companyId)
    .where("employeeId", "==", employeeId)
    .get();
  const out: ProductionIntervalInput[] = [];
  const taskNameCache = new Map<string, string>();

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const startedAtIso = tsToIso(d.startedAt);
    if (!startedAtIso) continue;
    const workDateIso =
      String(d.workDateIso ?? "").trim().slice(0, 10) ||
      localDayKeyFromIsoTimestamp(startedAtIso);
    if (!dateStrInRange(workDateIso, fromIso, toIso)) continue;

    let taskName = String(d.taskName ?? "").trim();
    if (!taskName) {
      const jobId = String(d.jobId ?? "");
      const taskId = String(d.productionTaskId ?? "");
      const cacheKey = `${jobId}:${taskId}`;
      if (taskNameCache.has(cacheKey)) {
        taskName = taskNameCache.get(cacheKey)!;
      } else if (jobId && taskId) {
        const tSnap = await productionTasksCol(db, companyId, jobId).doc(taskId).get();
        taskName = tSnap.exists
          ? String((tSnap.data() as Record<string, unknown>).name ?? taskId)
          : taskId;
        taskNameCache.set(cacheKey, taskName);
      }
    }

    let jobNumber = String(d.jobNumber ?? "").trim();
    let jobName = String(d.jobName ?? "").trim();
    const jobId = String(d.jobId ?? "");
    if (jobId && (!jobNumber || !jobName)) {
      const jSnap = await db
        .collection("companies")
        .doc(companyId)
        .collection("jobs")
        .doc(jobId)
        .get();
      if (jSnap.exists) {
        const j = jSnap.data() as Record<string, unknown>;
        if (!jobNumber) {
          jobNumber = String(j.jobNumber ?? j.orderNumber ?? "").trim();
        }
        if (!jobName) {
          jobName = String(j.name ?? "").trim();
        }
      }
    }

    out.push({
      id: doc.id,
      companyId,
      employeeId,
      jobId,
      jobNumber: jobNumber || null,
      jobName: jobName || null,
      productionTaskId: String(d.productionTaskId ?? ""),
      taskName,
      startedAtIso,
      endedAtIso: tsToIso(d.endedAt),
      durationSeconds:
        typeof d.durationSeconds === "number" ? d.durationSeconds : null,
      endedReason: d.endedReason != null ? String(d.endedReason) : null,
      source: String(d.source ?? "qr"),
      workDateIso,
    });
  }
  return out;
}

function buildAttendanceMaps(
  rows: AttendanceRow[],
  employeeId: string,
  authUid: string | null,
  fromIso: string,
  toIso: string
): Map<string, DayAttendanceInput> {
  const map = new Map<string, DayAttendanceInput>();
  const dayKeys = new Set<string>();
  for (const r of rows) {
    const dk = attendanceRowCalendarDateKey(r);
    if (dk && dateStrInRange(dk, fromIso, toIso)) dayKeys.add(dk);
  }
  for (const dayIso of dayKeys) {
    const { summary } = getDayAttendanceSummaryForLocalDay(rows, dayIso, {
      employeeId,
      authUid: authUid ?? undefined,
    });
    if (!summary) continue;
    map.set(dayIso, {
      dayIso,
      hoursWorked: summary.hoursWorked ?? null,
      breakMinutes:
        summary.breakHours != null ? Math.round(summary.breakHours * 60) : null,
    });
  }
  return map;
}

function buildDailyReportMap(
  reports: Record<string, unknown>[],
  fromIso: string,
  toIso: string
): Map<string, DayDailyReportInput> {
  const map = new Map<string, DayDailyReportInput>();
  for (const r of reports) {
    const dayIso = String(r.date ?? "").trim().slice(0, 10);
    if (!dateStrInRange(dayIso, fromIso, toIso)) continue;
    map.set(dayIso, {
      dayIso,
      status: String(r.status ?? ""),
      hoursConfirmed: Number(r.hoursConfirmed),
      hoursFromAttendance: Number(r.hoursFromAttendance),
      payableAmountCzk: Number(r.payableAmountCzk),
    });
  }
  return map;
}

function buildTerminalHoursByDay(
  segments: WorkSegmentClient[],
  fromIso: string,
  toIso: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of segments) {
    const dk = segmentCalendarDateIsoKey(s);
    if (!dateStrInRange(dk, fromIso, toIso)) continue;
    const h = segmentDurationForOverview(s, dk);
    map.set(dk, (map.get(dk) ?? 0) + h);
  }
  return map;
}

export async function loadEmployeeWorkStatement(params: {
  db: Firestore;
  companyId: string;
  employeeId: string;
  employeeAuthUid: string | null;
  fromIso: string;
  toIso: string;
  hourlyRateCzk: number;
  includeMoney: boolean;
  attendanceRows: AttendanceRow[];
  dailyReports: Record<string, unknown>[];
  workSegments: WorkSegmentClient[];
}) {
  const entries = await mapProductionEntries(
    params.db,
    params.companyId,
    params.employeeId,
    params.fromIso,
    params.toIso
  );
  const intervalRows = buildWorkStatementIntervalRows({
    entries,
    fromIso: params.fromIso,
    toIso: params.toIso,
    hourlyRateCzk: params.hourlyRateCzk,
    includeMoney: params.includeMoney,
  });
  const attendanceByDay = buildAttendanceMaps(
    params.attendanceRows,
    params.employeeId,
    params.employeeAuthUid,
    params.fromIso,
    params.toIso
  );
  const dailyReportsByDay = buildDailyReportMap(
    params.dailyReports,
    params.fromIso,
    params.toIso
  );
  const terminalHoursByDay = buildTerminalHoursByDay(
    params.workSegments,
    params.fromIso,
    params.toIso
  );
  const hoursBySource = computeWorkStatementHoursBySource({
    intervalRows,
    attendanceByDay,
    dailyReportsByDay,
    terminalHoursByDay,
    fromIso: params.fromIso,
    toIso: params.toIso,
  });
  const anomalies = detectWorkStatementAnomalies({
    intervalRows,
    attendanceByDay,
    dailyReportsByDay,
  });
  const summary = computeWorkStatementSummary({
    intervalRows,
    anomalies,
    includeMoney: params.includeMoney,
  });
  return {
    intervalRows,
    hoursBySource,
    anomalies,
    summary,
  };
}

export type JobQrLaborRow = {
  employeeId: string;
  employeeName: string;
  operationName: string;
  hours: number;
  hoursLabel: string;
  internalRateCzk: number;
  laborCostCzk: number;
  workDateIso: string;
};

export async function loadJobQrLaborSummary(params: {
  db: Firestore;
  companyId: string;
  jobId: string;
}): Promise<{
  rows: JobQrLaborRow[];
  totalHours: number;
  totalCostCzk: number;
  byEmployee: Array<{ employeeId: string; name: string; hours: number; costCzk: number }>;
  byOperation: Array<{ taskId: string; name: string; hours: number; costCzk: number }>;
}> {
  const { db, companyId, jobId } = params;
  const [entriesSnap, empSnap] = await Promise.all([
    productionTimeEntriesCol(db, companyId).where("jobId", "==", jobId).get(),
    db.collection("companies").doc(companyId).collection("employees").get(),
  ]);
  const empRates = new Map<string, { name: string; rate: number }>();
  for (const d of empSnap.docs) {
    const e = d.data() as Record<string, unknown>;
    const name =
      `${String(e.firstName ?? "")} ${String(e.lastName ?? "")}`.trim() || d.id;
    const rate = Number(e.hourlyRate ?? e.internalHourlyRate ?? 0);
    empRates.set(d.id, {
      name,
      rate: Number.isFinite(rate) && rate > 0 ? rate : 0,
    });
  }

  const rows: JobQrLaborRow[] = [];
  const now = Date.now();
  for (const doc of entriesSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.endedAt == null) continue;
    const empId = String(d.employeeId ?? "");
    const emp = empRates.get(empId);
    let sec = typeof d.durationSeconds === "number" ? d.durationSeconds : 0;
    if (!sec && d.startedAt instanceof Timestamp && d.endedAt instanceof Timestamp) {
      sec = Math.max(
        0,
        Math.round((d.endedAt.toMillis() - d.startedAt.toMillis()) / 1000)
      );
    }
    const hours = Math.round((sec / 3600) * 100) / 100;
    const rate = emp?.rate ?? 0;
    const workDateIso =
      String(d.workDateIso ?? "").slice(0, 10) ||
      (tsToIso(d.startedAt)
        ? localDayKeyFromIsoTimestamp(tsToIso(d.startedAt)!)
        : "");
    rows.push({
      employeeId: empId,
      employeeName: emp?.name ?? empId,
      operationName: String(d.taskName ?? d.productionTaskId ?? "—"),
      hours,
      hoursLabel: `${hours} h`,
      internalRateCzk: rate,
      laborCostCzk: Math.round(hours * rate * 100) / 100,
      workDateIso,
    });
  }

  let totalHours = 0;
  let totalCost = 0;
  const byEmp = new Map<string, { name: string; hours: number; costCzk: number }>();
  const byOp = new Map<string, { name: string; hours: number; costCzk: number }>();

  for (const r of rows) {
    totalHours += r.hours;
    totalCost += r.laborCostCzk;
    const e = byEmp.get(r.employeeId) ?? {
      name: r.employeeName,
      hours: 0,
      costCzk: 0,
    };
    e.hours += r.hours;
    e.costCzk += r.laborCostCzk;
    byEmp.set(r.employeeId, e);
    const opKey = r.operationName;
    const o = byOp.get(opKey) ?? { name: opKey, hours: 0, costCzk: 0 };
    o.hours += r.hours;
    o.costCzk += r.laborCostCzk;
    byOp.set(opKey, o);
  }

  return {
    rows,
    totalHours: Math.round(totalHours * 100) / 100,
    totalCostCzk: Math.round(totalCost * 100) / 100,
    byEmployee: [...byEmp.entries()].map(([employeeId, v]) => ({
      employeeId,
      name: v.name,
      hours: Math.round(v.hours * 100) / 100,
      costCzk: Math.round(v.costCzk * 100) / 100,
    })),
    byOperation: [...byOp.entries()].map(([taskId, v]) => ({
      taskId,
      name: v.name,
      hours: Math.round(v.hours * 100) / 100,
      costCzk: Math.round(v.costCzk * 100) / 100,
    })),
  };
}
