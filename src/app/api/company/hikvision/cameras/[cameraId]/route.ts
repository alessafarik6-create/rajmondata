import { NextRequest, NextResponse } from "next/server";
import {
  firestoreTimestampToIso,
  hikvisionCamerasCol,
  listHikvisionDevices,
} from "@/lib/hikvision/stores";
import { hikvisionTenantOk, requireCamerasView } from "@/lib/hikvision/api-auth";
import { assertCallerCameraAccess } from "@/lib/hikvision/camera-access-guard";
import { HikvisionEventService } from "@/lib/hikvision/event-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireCamerasView(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const access = await assertCallerCameraAccess({
    db: auth.db,
    organizationId: companyId,
    caller: auth.caller,
    employeeDoc: auth.employeeDoc,
    cameraId,
    permission: "view",
  });
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const snap = await hikvisionCamerasCol(auth.db, companyId).doc(cameraId).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Kamera nenalezena." }, { status: 404 });
  }
  const cam = snap.data()!;
  const devices = await listHikvisionDevices(auth.db, companyId);
  const device = devices.find((d) => d.id === cam.deviceId || d.externalDeviceId === cam.externalDeviceId);

  const eventsSvc = new HikvisionEventService(auth.db, companyId);
  const allEvents = await eventsSvc.listEvents(50);
  const recentEvents = allEvents.filter((e) => e.cameraId === cameraId).slice(0, 8);

  return NextResponse.json({
    ok: true,
    camera: {
      id: cameraId,
      name: cam.name,
      channelId: cam.channelId,
      online: cam.online,
      deviceId: cam.deviceId ?? null,
      deviceName: device?.name ?? null,
      externalDeviceId: cam.externalDeviceId ?? null,
      capabilities: cam.capabilities ?? null,
      lastCheckedAt: firestoreTimestampToIso(cam.lastCheckedAt),
      trackStreamId: cam.trackStreamId,
    },
    recentEvents,
  });
}
