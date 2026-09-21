import { NextRequest, NextResponse } from "next/server";
import {
  hikvisionTenantOk,
  requireCamerasPlayback,
} from "@/lib/hikvision/api-auth";
import { assertCallerCameraAccess } from "@/lib/hikvision/camera-access-guard";
import { HikvisionPlaybackService } from "@/lib/hikvision/playback-service";
import { hikvisionErrorMessage } from "@/lib/hikvision/errors";
import type { HikvisionErrorCode } from "@/lib/hikvision/errors";
import { logHikvisionAuditSafe } from "@/lib/hikvision/hikvision-audit-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

function formatHccLocalTime(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireCamerasPlayback(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  let body: {
    companyId?: string;
    startTime?: string;
    stopTime?: string;
    source?: "local" | "cloud";
    code?: string;
  } = {};
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

  const startTime = formatHccLocalTime(String(body.startTime ?? ""));
  const stopTime = formatHccLocalTime(String(body.stopTime ?? ""));
  if (!body.startTime || !body.stopTime) {
    return NextResponse.json(
      { ok: false, error: "Vyplňte čas od a čas do." },
      { status: 400 }
    );
  }

  const svc = new HikvisionPlaybackService(auth.db, companyId);
  const session = await svc.startPlayback({
    cameraId,
    userId: auth.caller.uid,
    startTime,
    stopTime,
    source: body.source === "cloud" ? "cloud" : "local",
    code: body.code,
  });

  if (!session.ok) {
    const code = session.code as HikvisionErrorCode | undefined;
    return NextResponse.json(
      {
        ok: false,
        code,
        error: session.error,
        message: code ? hikvisionErrorMessage(code) : session.error,
      },
      { status: code === "LIVE_VIEW_NOT_SUPPORTED" ? 501 : 502 }
    );
  }

  await logHikvisionAuditSafe(auth.db, companyId, {
    userId: auth.caller.uid,
    actionType: "HIKVISION_PLAYBACK_OPEN",
    actionLabel: "Otevření přehrání záznamu",
    entityType: "camera",
    entityId: cameraId,
    metadata: { source: body.source ?? "local" },
  });

  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
