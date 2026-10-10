import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { resolveProductionTaskByPublicToken } from "@/lib/production-qr/resolve-public-token";
import { verifyProductionQrPin } from "@/lib/production-qr/production-pin-guard";
import { getRequestIp } from "@/lib/production-qr/request-ip";
import { resolveEmployeeProductionAttendanceEligibility } from "@/lib/production-qr/attendance-eligibility";
import { startProductionTimeViaQr } from "@/lib/production-qr/production-time-server";

type Body = { employeeId?: string; pin?: string; deviceInfo?: string };

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Server není k dispozici." }, { status: 503 });
  }
  const { token } = await ctx.params;
  const resolved = await resolveProductionTaskByPublicToken(db, token);
  if (!resolved) {
    return NextResponse.json({ error: "Neplatný QR kód." }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const employeeId = String(body.employeeId ?? "").trim();
  const pin = normalizeTerminalPin(body.pin != null ? String(body.pin) : "");
  if (!employeeId || !pin) {
    return NextResponse.json({ error: "Chybí zaměstnanec nebo PIN." }, { status: 400 });
  }

  const pinCheck = await verifyProductionQrPin(db, {
    companyId: resolved.companyId,
    employeeId,
    pinNormalized: pin,
    ip: getRequestIp(request),
    route: "/api/public/work-task/[token]/start",
  });
  if (!pinCheck.ok) {
    return NextResponse.json({ error: pinCheck.error }, { status: pinCheck.status });
  }

  const empSnap = await db
    .collection("companies")
    .doc(resolved.companyId)
    .collection("employees")
    .doc(employeeId)
    .get();
  if (!empSnap.exists) {
    return NextResponse.json({ error: "Zaměstnanec neexistuje." }, { status: 404 });
  }
  const emp = empSnap.data() as Record<string, unknown>;
  const employeeName =
    `${String(emp.firstName ?? "")} ${String(emp.lastName ?? "")}`.trim() || "Zaměstnanec";

  const todayIso = new Date().toISOString().split("T")[0]!;
  const eligibility = await resolveEmployeeProductionAttendanceEligibility(
    db,
    resolved.companyId,
    employeeId,
    todayIso
  );
  if (!eligibility.canStartProduction) {
    let errorMsg: string;
    switch (eligibility.status) {
      case "ON_BREAK":
        errorMsg = `${employeeName} má právě přestávku. QR výrobní úkol spustíte až po návratu do práce na hlavním terminálu.`;
        break;
      case "NON_WORKING_TARIFF":
        errorMsg = `${employeeName} není v pracovním režimu (oběd / tarif). Nejprve se vraťte k práci na hlavním docházkovém terminálu.`;
        break;
      default:
        errorMsg = `${employeeName} není aktuálně přihlášen/a v práci. Nejprve se přihlaste na hlavním docházkovém terminálu.`;
    }
    return NextResponse.json(
      {
        error: errorMsg,
        code: eligibility.status,
        attendanceBlocked: true,
        employee: { id: employeeId, name: employeeName },
      },
      { status: 403 }
    );
  }

  try {
    const result = await startProductionTimeViaQr(db, {
      companyId: resolved.companyId,
      jobId: resolved.jobId,
      productionTaskId: resolved.taskId,
      employeeId,
      deviceInfo: body.deviceInfo != null ? String(body.deviceInfo) : null,
    });

    return NextResponse.json({
      success: true,
      employee: { id: employeeId, name: employeeName },
      activeTask: {
        taskId: resolved.taskId,
        taskName: resolved.taskName,
        jobId: resolved.jobId,
        jobName: resolved.jobDisplayName,
        startedAt: result.startedAt,
        entryId: result.activeEntryId,
      },
      alreadyActiveOnSameTask: result.alreadyActiveOnSameTask,
      previousTaskStopped: result.previousTaskStopped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "start_failed";
    if (msg === "task_inactive") {
      return NextResponse.json({ error: "Úkol není aktivní." }, { status: 403 });
    }
    console.error("[work-task/start]", e);
    return NextResponse.json({ error: "Nepodařilo se zahájit práci." }, { status: 500 });
  }
}
