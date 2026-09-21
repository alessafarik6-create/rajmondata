import { NextRequest, NextResponse } from "next/server";
import { hikvisionTenantOk, requireCamerasLive } from "@/lib/hikvision/api-auth";
import { HikvisionStreamGateway } from "@/lib/hikvision/stream-gateway";
import { hikvisionErrorMessage } from "@/lib/hikvision/errors";
import type { HikvisionErrorCode } from "@/lib/hikvision/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireCamerasLive(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  const companyId = auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const gateway = new HikvisionStreamGateway(auth.db);
  const session = await gateway.startLiveSession({
    organizationId: companyId,
    cameraId,
    userId: auth.caller.uid,
  });

  if (!session.ok) {
    const code = session.code as HikvisionErrorCode | undefined;
    const status = code === "LIVE_VIEW_NOT_SUPPORTED" ? 501 : 502;
    return NextResponse.json(
      {
        ok: false,
        code,
        error: session.error,
        message: code ? hikvisionErrorMessage(code) : session.error,
      },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
