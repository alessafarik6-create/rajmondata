import { NextRequest, NextResponse } from "next/server";
import { hikvisionTenantOk, requireCamerasLive } from "@/lib/hikvision/api-auth";
import { HikvisionStreamGateway } from "@/lib/hikvision/stream-gateway";
import { hikvisionErrorMessage } from "@/lib/hikvision/errors";
import type { HikvisionErrorCode } from "@/lib/hikvision/errors";
import { assertCallerCameraAccess } from "@/lib/hikvision/camera-access-guard";
import { logHikvisionAuditSafe } from "@/lib/hikvision/hikvision-audit-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireCamerasLive(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  let bodyCompanyId = "";
  try {
    const body = await request.json();
    bodyCompanyId = String(body?.companyId ?? "").trim();
  } catch {
    bodyCompanyId = "";
  }
  const companyId = bodyCompanyId || auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const access = await assertCallerCameraAccess({
    db: auth.db,
    organizationId: companyId,
    caller: auth.caller,
    employeeDoc: auth.employeeDoc,
    cameraId,
    permission: "live",
  });
  if (!access.ok) {
    const status = access.status === 404 ? 404 : access.status;
    return NextResponse.json(
      {
        ok: false,
        code: status === 404 ? "CAMERA_NOT_FOUND" : "HIKVISION_PERMISSION_DENIED",
        error: access.error,
      },
      { status }
    );
  }

  const gateway = new HikvisionStreamGateway(auth.db);
  const session = await gateway.startLiveSession({
    organizationId: companyId,
    cameraId,
    userId: auth.caller.uid,
  });

  if (!session.ok) {
    const code = session.code as HikvisionErrorCode | undefined;
    let apiCode = "HIKVISION_STREAM_UNAVAILABLE";
    if (session.code === "CAMERA_NOT_FOUND") apiCode = "CAMERA_NOT_FOUND";
    else if (code === "CAMERA_OFFLINE" || code === "DEVICE_OFFLINE") apiCode = "DEVICE_OFFLINE";
    else if (code === "HIKCONNECT_AUTH_FAILED" || code === "HIKCONNECT_API_ERROR")
      apiCode = "HIKVISION_TOKEN_FAILED";
    else if (code === "LIVE_VIEW_NOT_SUPPORTED") apiCode = "HIKVISION_STREAM_UNAVAILABLE";
    const status =
      code === "LIVE_VIEW_NOT_SUPPORTED"
        ? 501
        : code === "CAMERA_OFFLINE" || code === "DEVICE_OFFLINE"
          ? 503
          : 502;
    return NextResponse.json(
      {
        ok: false,
        code: apiCode,
        hikCode: code,
        error: session.error,
        message: code ? hikvisionErrorMessage(code) : session.error,
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }

  await logHikvisionAuditSafe(auth.db, companyId, {
    userId: auth.caller.uid,
    actionType: "HIKVISION_LIVE_OPEN",
    actionLabel: "Otevření živého obrazu kamery",
    entityType: "camera",
    entityId: cameraId,
    metadata: { playbackType: session.playbackType },
  });

  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
