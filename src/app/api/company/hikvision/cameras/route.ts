import { NextRequest, NextResponse } from "next/server";
import { firestoreTimestampToIso, listHikvisionCameras } from "@/lib/hikvision/stores";
import { hikvisionTenantOk, requireCamerasRead } from "@/lib/hikvision/api-auth";
import { filterCamerasForEmployee } from "@/lib/hikvision/employee-camera-access";
import { normalizeCompanyRole } from "@/lib/company-privilege";

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

  let cameras = await listHikvisionCameras(auth.db, companyId);
  const role = normalizeCompanyRole(auth.caller.role);
  const privileged =
    role === "owner" || role === "admin" || role === "manager" ||
    (Array.isArray(auth.caller.globalRoles) && auth.caller.globalRoles.includes("super_admin"));
  const employeeId = String(auth.caller.employeeId ?? auth.caller.uid).trim();
  if (employeeId && !privileged) {
    cameras = await filterCamerasForEmployee(
      auth.db,
      companyId,
      employeeId,
      privileged,
      cameras
    );
  }

  return NextResponse.json({
    ok: true,
    cameras: cameras.map((c) => ({
      id: c.id,
      channelId: c.channelId,
      name: c.name,
      deviceId: c.deviceId ?? null,
      ipAddress: c.ipAddress ?? null,
      model: c.model ?? null,
      serialNumber: c.serialNumber ?? null,
      online: c.online,
      trackStreamId: c.trackStreamId,
      capabilities: c.capabilities ?? null,
      lastCheckedAt: firestoreTimestampToIso(c.lastCheckedAt),
    })),
  });
}
