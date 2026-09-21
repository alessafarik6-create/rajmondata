import { NextRequest, NextResponse } from "next/server";
import {
  buildIsapiConfigForOrg,
  hikvisionCamerasCol,
} from "@/lib/hikvision/stores";
import { hikvisionTenantOk, requireCamerasRead } from "@/lib/hikvision/api-auth";
import { fetchHikvisionChannelPicture } from "@/lib/hikvision/isapi-client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cameraId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireCamerasRead(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { cameraId } = await params;
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const camSnap = await hikvisionCamerasCol(auth.db, companyId).doc(cameraId).get();
  if (!camSnap.exists) {
    return NextResponse.json({ ok: false, error: "Kamera nenalezena." }, { status: 404 });
  }
  const cam = camSnap.data() as { trackStreamId?: string };
  const trackStreamId = String(cam.trackStreamId ?? "").trim();
  if (!trackStreamId) {
    return NextResponse.json({ ok: false, error: "Chybí stream ID kamery." }, { status: 400 });
  }

  const cfg = await buildIsapiConfigForOrg(auth.db, companyId);
  if (!cfg.ok) {
    return NextResponse.json({ ok: false, error: cfg.error }, { status: 400 });
  }

  const pic = await fetchHikvisionChannelPicture(cfg.config, trackStreamId);
  if (!pic.ok) {
    return NextResponse.json({ ok: false, error: pic.error }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(pic.buffer), {
    status: 200,
    headers: {
      "Content-Type": pic.contentType,
      "Cache-Control": "private, max-age=15",
    },
  });
}
