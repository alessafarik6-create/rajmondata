import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import { productionTasksCol, productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const userSnap = await v.db.collection("users").doc(v.caller.uid).get();
  const profile = userSnap.data() as Record<string, unknown> | undefined;
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

  const snap = await productionTimeEntriesCol(v.db, v.caller.companyId)
    .where("endedAt", "==", null)
    .limit(50)
    .get();

  const now = Date.now();
  const rows: {
    entryId: string;
    employeeId: string;
    employeeName: string;
    jobId: string;
    jobName: string;
    taskId: string;
    taskName: string;
    startedAt: string | null;
    runningSeconds: number;
  }[] = [];

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const employeeId = String(d.employeeId ?? "");
    const jobId = String(d.jobId ?? "");
    const taskId = String(d.productionTaskId ?? "");
    const startedAt =
      d.startedAt instanceof Timestamp ? d.startedAt.toDate().toISOString() : null;
    const runningSeconds =
      d.startedAt instanceof Timestamp
        ? Math.max(0, Math.round((now - d.startedAt.toMillis()) / 1000))
        : 0;

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
      runningSeconds,
    });
  }

  return NextResponse.json({ ok: true, workers: rows });
}
