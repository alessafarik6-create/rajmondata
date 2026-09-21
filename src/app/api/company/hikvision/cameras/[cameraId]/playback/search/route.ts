import { NextRequest, NextResponse } from "next/server";
import { hikvisionTenantOk, requireCamerasPlayback } from "@/lib/hikvision/api-auth";
import { assertCallerCameraAccess } from "@/lib/hikvision/camera-access-guard";
import { HikvisionPlaybackService } from "@/lib/hikvision/playback-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireCamerasPlayback(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  let body: { companyId?: string; from?: string; to?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const access = await assertCallerCameraAccess({
    db: auth.db,
    organizationId: companyId,
    caller: auth.caller,
    employeeDoc: auth.employeeDoc,
    cameraId,
    permission: "playback",
  });
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const from = body.from ? new Date(body.from) : new Date();
  const to = body.to ? new Date(body.to) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ ok: false, error: "Neplatný rozsah dat." }, { status: 400 });
  }

  const svc = new HikvisionPlaybackService(auth.db, companyId);
  const result = await svc.searchRecordings({ cameraId, from, to });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: 502 });
  }

  return NextResponse.json(result);
}
