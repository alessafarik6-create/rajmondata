import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearer, isCompanyPrivileged } from "@/lib/api-company-auth";
import { productionTasksCol, productionTimeEntriesCol } from "@/lib/production-qr/production-task-paths";
import { formatDurationCs } from "@/lib/production-qr/production-time-report";

/** Výrobní čas zaměstnance po zakázkách a úkolech (pro profil / HR). */
export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const employeeIdParam = request.nextUrl.searchParams.get("employeeId")?.trim() ?? "";
  const employeeId =
    employeeIdParam ||
    (isCompanyPrivileged(v.caller.role, v.caller.globalRoles) ? "" : v.caller.employeeId ?? "");
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
  }
  if (
    !isCompanyPrivileged(v.caller.role, v.caller.globalRoles) &&
    v.caller.employeeId !== employeeId
  ) {
    return NextResponse.json({ error: "Nemáte oprávnění." }, { status: 403 });
  }

  const snap = await productionTimeEntriesCol(v.db, v.caller.companyId)
    .where("employeeId", "==", employeeId)
    .get();

  const now = Date.now();
  const byJob = new Map<
    string,
    { jobName: string; byTask: Map<string, { taskName: string; seconds: number }> }
  >();

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const jobId = String(d.jobId ?? "");
    const taskId = String(d.productionTaskId ?? "");
    let seconds = typeof d.durationSeconds === "number" ? d.durationSeconds : 0;
    if (d.endedAt == null && d.startedAt instanceof Timestamp) {
      seconds = Math.max(0, Math.round((now - d.startedAt.toMillis()) / 1000));
    }
    if (!jobId || !taskId) continue;

    const jobSnap = await v.db
      .collection("companies")
      .doc(v.caller.companyId)
      .collection("jobs")
      .doc(jobId)
      .get();
    const job = jobSnap.data() as Record<string, unknown> | undefined;
    const jobName =
      String(job?.productionInternalLabel ?? job?.name ?? "").trim() || jobId;

    const taskSnap = await productionTasksCol(v.db, v.caller.companyId, jobId).doc(taskId).get();
    const taskName = taskSnap.exists
      ? String((taskSnap.data() as Record<string, unknown>).name ?? taskId)
      : taskId;

    const bucket = byJob.get(jobId) ?? { jobName, byTask: new Map() };
    bucket.byTask.set(taskId, {
      taskName,
      seconds: (bucket.byTask.get(taskId)?.seconds ?? 0) + seconds,
    });
    byJob.set(jobId, bucket);
  }

  const jobs = [...byJob.entries()].map(([jobId, bucket]) => ({
    jobId,
    jobName: bucket.jobName,
    tasks: [...bucket.byTask.entries()].map(([taskId, t]) => ({
      taskId,
      taskName: t.taskName,
      seconds: t.seconds,
      label: formatDurationCs(t.seconds),
    })),
  }));

  return NextResponse.json({ ok: true, employeeId, jobs });
}
