import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import { productionTasksCol, productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";
import {
  loadPausedProductionQrSessions,
  sumProductionWorkedSecondsForTask,
} from "@/lib/production-qr/production-qr-session-server";
import {
  productionQrStatusLabelCs,
  type ProductionQrDisplayStatus,
} from "@/lib/production-qr/production-qr-session-types";
import {
  buildTerminalActiveSegmentMapFromDocs,
  segmentStartMillisFromWorkSegmentData,
  type TerminalActiveSegment,
} from "@/lib/terminal-active-segment";

export type ActiveProductionWorkerApiRow = {
  entryId: string;
  employeeId: string;
  employeeName: string;
  jobId: string;
  jobName: string;
  taskId: string;
  taskName: string;
  startedAt: string | null;
  sessionStartedAt: string | null;
  runningSeconds: number;
  qrStatus: ProductionQrDisplayStatus;
  qrStatusLabel: string;
  activeTariffId: string | null;
  activeTariffName: string | null;
  tariffRunningSeconds: number;
  isPaused: boolean;
  activelyWorking: boolean;
};

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  let employeeRow: { canAccessProduction?: boolean } | null = null;
  if (v.caller.employeeId) {
    const es = await v.db
      .collection("companies")
      .doc(v.caller.companyId)
      .collection("employees")
      .doc(v.caller.employeeId)
      .get();
    if (es.exists) employeeRow = es.data() as { canAccessProduction?: boolean };
  }
  if (
    !userCanAccessProductionPortal({
      role: v.caller.role,
      globalRoles: v.caller.globalRoles,
      employeeRow,
    })
  ) {
    return NextResponse.json({ error: "Nemáte přístup k modulu Výroba." }, { status: 403 });
  }

  const todayIso = new Date().toISOString().split("T")[0]!;
  const now = Date.now();

  const openSegSnapPromise = v.db
    .collection("companies")
    .doc(v.caller.companyId)
    .collection("work_segments")
    .where("date", "==", todayIso)
    .where("closed", "==", false)
    .limit(80)
    .get();

  const [activeSnap, pausedSessions, openSegSnap] = await Promise.all([
    productionTimeEntriesCol(v.db, v.caller.companyId).where("endedAt", "==", null).limit(50).get(),
    loadPausedProductionQrSessions(v.db, v.caller.companyId, todayIso),
    openSegSnapPromise,
  ]);

  const openSegments = buildTerminalActiveSegmentMapFromDocs(openSegSnap.docs);
  const openSegmentStartMs = new Map<string, number>();
  for (const doc of openSegSnap.docs) {
    const eid = String((doc.data() as { employeeId?: string }).employeeId ?? "");
    if (!eid) continue;
    const ms = segmentStartMillisFromWorkSegmentData(doc.data() as Record<string, unknown>);
    if (ms > 0) openSegmentStartMs.set(eid, ms);
  }

  function tariffSecondsForEmployee(employeeId: string): number {
    const seg = openSegments.get(employeeId);
    if (seg?.sourceType !== "tariff") return 0;
    const startMs = openSegmentStartMs.get(employeeId);
    if (!startMs) return 0;
    return Math.max(0, Math.round((now - startMs) / 1000));
  }

  const rows: ActiveProductionWorkerApiRow[] = [];
  const seenEmployees = new Set<string>();

  for (const doc of activeSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const employeeId = String(d.employeeId ?? "");
    const jobId = String(d.jobId ?? "");
    const taskId = String(d.productionTaskId ?? "");
    const startedAt =
      d.startedAt instanceof Timestamp ? d.startedAt.toDate().toISOString() : null;
    const intervalSeconds =
      d.startedAt instanceof Timestamp
        ? Math.max(0, Math.round((now - d.startedAt.toMillis()) / 1000))
        : 0;

    const workedSeconds = await sumProductionWorkedSecondsForTask(
      v.db,
      v.caller.companyId,
      employeeId,
      jobId,
      taskId,
      now
    );

    const [empSnap, jobSnap, taskSnap] = await Promise.all([
      employeeId
        ? v.db.collection("companies").doc(v.caller.companyId).collection("employees").doc(employeeId).get()
        : Promise.resolve(null),
      jobId
        ? v.db.collection("companies").doc(v.caller.companyId).collection("jobs").doc(jobId).get()
        : Promise.resolve(null),
      jobId && taskId
        ? productionTasksCol(v.db, v.caller.companyId, jobId).doc(taskId).get()
        : Promise.resolve(null),
    ]);

    const emp = empSnap?.exists ? (empSnap.data() as Record<string, unknown>) : {};
    const job = jobSnap?.exists ? (jobSnap.data() as Record<string, unknown>) : {};
    const task = taskSnap?.exists ? (taskSnap.data() as Record<string, unknown>) : {};

    const seg = openSegments.get(employeeId) as TerminalActiveSegment | undefined;
    const tariffRunningSeconds = tariffSecondsForEmployee(employeeId);

    seenEmployees.add(employeeId);
    rows.push({
      entryId: doc.id,
      employeeId,
      employeeName:
        `${String(emp.firstName ?? "")} ${String(emp.lastName ?? "")}`.trim() || employeeId,
      jobId,
      jobName:
        String(job.productionInternalLabel ?? job.name ?? "").trim() || jobId,
      taskId,
      taskName: String(task.name ?? taskId),
      startedAt,
      sessionStartedAt: startedAt,
      runningSeconds: workedSeconds,
      qrStatus: "active",
      qrStatusLabel: productionQrStatusLabelCs("active"),
      activeTariffId: seg?.sourceType === "tariff" ? seg.tariffId ?? null : null,
      activeTariffName: seg?.sourceType === "tariff" ? seg.displayName ?? null : null,
      tariffRunningSeconds,
      isPaused: false,
      activelyWorking: true,
    });
  }

  for (const session of pausedSessions) {
    if (seenEmployees.has(session.employeeId)) continue;
    const employeeId = session.employeeId;
    const jobId = session.jobId;
    const taskId = session.productionTaskId;

    const workedSeconds = await sumProductionWorkedSecondsForTask(
      v.db,
      v.caller.companyId,
      employeeId,
      jobId,
      taskId,
      now
    );

    const [empSnap, jobSnap, taskSnap] = await Promise.all([
      v.db.collection("companies").doc(v.caller.companyId).collection("employees").doc(employeeId).get(),
      jobId
        ? v.db.collection("companies").doc(v.caller.companyId).collection("jobs").doc(jobId).get()
        : Promise.resolve(null),
      jobId && taskId
        ? productionTasksCol(v.db, v.caller.companyId, jobId).doc(taskId).get()
        : Promise.resolve(null),
    ]);

    const emp = empSnap?.exists ? (empSnap.data() as Record<string, unknown>) : {};
    const job = jobSnap?.exists ? (jobSnap.data() as Record<string, unknown>) : {};
    const task = taskSnap?.exists ? (taskSnap.data() as Record<string, unknown>) : {};

    const seg = openSegments.get(employeeId) as TerminalActiveSegment | undefined;
    const tariffRunningSeconds = tariffSecondsForEmployee(employeeId);

    const qrStatus = session.displayStatus;
    rows.push({
      entryId: `paused-${employeeId}`,
      employeeId,
      employeeName:
        `${String(emp.firstName ?? "")} ${String(emp.lastName ?? "")}`.trim() || employeeId,
      jobId,
      jobName:
        String(session.jobName ?? job.productionInternalLabel ?? job.name ?? "").trim() || jobId,
      taskId,
      taskName: String(session.taskName ?? task.name ?? taskId),
      startedAt: session.sessionStartedAt ?? session.pausedAt ?? null,
      sessionStartedAt: session.sessionStartedAt ?? null,
      runningSeconds: workedSeconds,
      qrStatus,
      qrStatusLabel: productionQrStatusLabelCs(qrStatus),
      activeTariffId:
        seg?.sourceType === "tariff"
          ? seg.tariffId ?? session.pauseTariffId ?? null
          : session.pauseTariffId ?? null,
      activeTariffName:
        seg?.sourceType === "tariff"
          ? seg.displayName ?? session.pauseTariffName ?? null
          : session.pauseTariffName ?? null,
      tariffRunningSeconds,
      isPaused: true,
      activelyWorking: false,
    });
    seenEmployees.add(employeeId);
  }

  const activelyWorkingCount = rows.filter((r) => r.activelyWorking).length;
  const pausedCount = rows.filter((r) => r.isPaused).length;

  return NextResponse.json({
    ok: true,
    workers: rows,
    summary: {
      total: rows.length,
      activelyWorking: activelyWorkingCount,
      paused: pausedCount,
    },
  });
}
