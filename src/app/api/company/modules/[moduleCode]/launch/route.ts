import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { verifyCompanyBearerFromRequest } from "@/lib/api-company-auth";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import { launchExternalModuleForUser } from "@/lib/rajmondata-editor/launch-module.server";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import { resolvePlatformModuleFromRouteParam } from "@/lib/platform-module-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function mapLaunchHttpStatus(status: number): number {
  if (status === 401 || status === 403) return status;
  if (status === 502 || status === 503 || status === 504) return status;
  if (status >= 500) return 502;
  return status;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ moduleCode: string }> }
) {
  const requestId = randomBytes(8).toString("hex");
  try {
    const v = await verifyCompanyBearerFromRequest(request);
    if (!v.ok) {
      console.warn("[module-launch] auth failed", { requestId, status: v.status });
      return NextResponse.json(
        { ok: false, error: v.error, requestId },
        { status: v.status }
      );
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const firebaseIdToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!firebaseIdToken) {
      return NextResponse.json(
        { ok: false, error: "Chybí Firebase token.", requestId },
        { status: 401 }
      );
    }

    const { moduleCode: raw } = await params;
    const moduleCode = resolvePlatformModuleFromRouteParam(String(raw ?? "").trim());
    if (!moduleCode || !(PLATFORM_MODULE_CODES as readonly string[]).includes(moduleCode)) {
      return NextResponse.json({ ok: false, error: "Neplatný modul.", requestId }, { status: 400 });
    }

    const db = getAdminFirestore();
    if (!db) {
      return NextResponse.json({ ok: false, error: "Server error", requestId }, { status: 503 });
    }

    const orgSnap = await db.collection(ORGANIZATIONS_COLLECTION).doc(v.caller.companyId).get();
    const companySnap = await db.collection(COMPANIES_COLLECTION).doc(v.caller.companyId).get();
    const userSnap = await db.collection("users").doc(v.caller.uid).get();
    const userData = userSnap.data() as Record<string, unknown> | undefined;
    const authUser = await getAdminAuth()?.getUser(v.caller.uid).catch(() => null);
    const orgName =
      String(orgSnap.data()?.name ?? companySnap.data()?.name ?? "Organizace").trim() || "Organizace";
    const email = String(authUser?.email ?? userData?.email ?? "").trim();
    const displayName = String(
      userData?.displayName ?? userData?.name ?? authUser?.displayName ?? email ?? "Uživatel"
    ).trim();

    const result = await launchExternalModuleForUser({
      db,
      organizationId: v.caller.companyId,
      organizationName: orgName,
      userId: v.caller.uid,
      email,
      displayName,
      moduleCode: moduleCode as PlatformModuleCode,
      portalRole: v.caller.role,
      firebaseIdToken,
    });

    if (!result.ok) {
      const httpStatus = mapLaunchHttpStatus(result.status);
      console.warn("[module-launch] failed", {
        requestId,
        moduleCode,
        organizationId: v.caller.companyId,
        uid: v.caller.uid,
        status: result.status,
        editorHttpStatus: result.editorHttpStatus ?? null,
        editorCode: result.code ?? null,
        error: result.error,
      });
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          requestId,
          editorCode: result.code ?? undefined,
          editorHttpStatus: result.editorHttpStatus ?? undefined,
        },
        { status: httpStatus }
      );
    }

    console.info("[module-launch] ok", {
      requestId,
      moduleCode,
      organizationId: v.caller.companyId,
      uid: v.caller.uid,
    });

    return NextResponse.json({
      ok: true,
      redirectUrl: result.redirectUrl,
      mode: result.mode,
      requestId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[module-launch] unhandled", { requestId, message: msg });
    return NextResponse.json(
      { ok: false, error: "Interní chyba při spuštění modulu.", requestId },
      { status: 500 }
    );
  }
}
