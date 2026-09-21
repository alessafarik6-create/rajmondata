import { NextRequest, NextResponse } from "next/server";
import { hikvisionTenantOk, requireCamerasView } from "@/lib/hikvision/api-auth";
import { HikvisionEventService } from "@/lib/hikvision/event-service";
import { listEmployeeCameraAccess } from "@/lib/hikvision/employee-camera-access";
import { isCameraPrivilegedCaller } from "@/lib/hikvision/camera-access-guard";
import { hikvisionCamerasCol } from "@/lib/hikvision/stores";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireCamerasView(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const svc = new HikvisionEventService(auth.db, companyId);
  await svc.ensureAlarmSubscription().catch(() => undefined);
  await svc.pollAndStoreAlarms().catch(() => undefined);

  let events = await svc.listEvents(200);
  const cameraFilter = String(request.nextUrl.searchParams.get("cameraId") ?? "").trim();
  const typeFilter = String(request.nextUrl.searchParams.get("type") ?? "").trim();
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";

  if (!isCameraPrivilegedCaller(auth.caller)) {
    const employeeId = String(auth.caller.employeeId ?? auth.caller.uid).trim();
    const rules = await listEmployeeCameraAccess(auth.db, companyId, employeeId);
    if (rules.length > 0) {
      const allowed = new Set(rules.map((r) => r.cameraId));
      events = events.filter((e) => !e.cameraId || allowed.has(e.cameraId));
    }
  }

  if (cameraFilter) events = events.filter((e) => e.cameraId === cameraFilter);
  if (typeFilter) events = events.filter((e) => e.type === typeFilter);
  if (unreadOnly) events = events.filter((e) => !e.acknowledged);

  const camerasSnap = await hikvisionCamerasCol(auth.db, companyId).get();
  const nameById = new Map(camerasSnap.docs.map((d) => [d.id, (d.data() as { name?: string }).name]));

  return NextResponse.json({
    ok: true,
    events: events.map((e) => ({
      ...e,
      cameraName: e.cameraId ? nameById.get(e.cameraId) ?? null : null,
    })),
  });
}
