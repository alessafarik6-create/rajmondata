import { NextRequest, NextResponse } from "next/server";
import { firestoreTimestampToIso, listHikvisionCameras } from "@/lib/hikvision/stores";
import { hikvisionTenantOk, requireCamerasRead } from "@/lib/hikvision/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireCamerasRead(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const cameras = await listHikvisionCameras(auth.db, companyId);
  return NextResponse.json({
    ok: true,
    cameras: cameras.map((c) => ({
      id: c.id,
      channelId: c.channelId,
      name: c.name,
      ipAddress: c.ipAddress ?? null,
      model: c.model ?? null,
      serialNumber: c.serialNumber ?? null,
      online: c.online,
      trackStreamId: c.trackStreamId,
      lastCheckedAt: firestoreTimestampToIso(c.lastCheckedAt),
    })),
  });
}
