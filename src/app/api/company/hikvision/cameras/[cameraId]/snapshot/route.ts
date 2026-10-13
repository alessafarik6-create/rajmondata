import { NextRequest, NextResponse } from "next/server";
import { hikvisionCamerasCol } from "@/lib/hikvision/stores";
import { hikvisionTenantOk, requireCamerasView } from "@/lib/hikvision/api-auth";
import { assertCallerCameraAccess } from "@/lib/hikvision/camera-access-guard";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";
import { logHikvisionRouteError } from "@/lib/hikvision/api-route-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ cameraId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  let cameraId = "";
  let companyId = "";
  try {
    const auth = await requireCamerasView(request);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    const resolved = await params;
    cameraId = resolved.cameraId;
    companyId =
      String(request.nextUrl.searchParams.get("companyId") ?? "").trim() ||
      auth.caller.companyId;
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

    const camSnap = await hikvisionCamerasCol(auth.db, companyId).doc(cameraId).get();
    if (!camSnap.exists) {
      return NextResponse.json({ ok: false, error: "Kamera nenalezena." }, { status: 404 });
    }

    const { provider } = await resolveHikvisionProviderForOrg(auth.db, companyId);
    const pic = await provider.getSnapshot(
      { db: auth.db, organizationId: companyId },
      cameraId
    );
    if (!pic.ok) {
      logHikvisionRouteError(
        "cameras/snapshot",
        { companyId, cameraId, action: "provider_fail" },
        new Error(`${pic.code ?? "?"}: ${pic.error ?? "snapshot failed"}`)
      );
      return NextResponse.json(
        { ok: false, code: pic.code, error: pic.error },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    return new NextResponse(new Uint8Array(pic.buffer), {
      status: 200,
      headers: {
        "Content-Type": pic.contentType,
        "Cache-Control": "private, max-age=15",
      },
    });
  } catch (err) {
    logHikvisionRouteError("cameras/snapshot", { companyId, cameraId, action: "exception" }, err);
    return NextResponse.json(
      {
        ok: false,
        code: "HIKCONNECT_API_ERROR",
        error: "Nepodařilo se načíst náhled kamery.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
