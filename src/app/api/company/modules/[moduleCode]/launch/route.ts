import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import { launchExternalModuleForUser } from "@/lib/rajmondata-editor/launch-module.server";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

function isCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ moduleCode: string }> }
) {
  const authHeader = request.headers.get("authorization") ?? "";
  const firebaseIdToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!firebaseIdToken) {
    return NextResponse.json({ error: "Chybí Firebase token." }, { status: 401 });
  }
  const v = await verifyCompanyBearer(authHeader);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const { moduleCode: raw } = await params;
  const moduleCode = String(raw ?? "").trim();
  if (!isCode(moduleCode)) {
    return NextResponse.json({ error: "Neplatný modul." }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

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
    moduleCode,
    portalRole: v.caller.role,
    firebaseIdToken,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    redirectUrl: result.redirectUrl,
    mode: result.mode,
  });
}
