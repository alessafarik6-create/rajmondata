import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { PLATFORM_MODULE_CODES, type PlatformModuleCode } from "@/lib/platform-config";
import { getRajmondataEditorEnv, editorUrlsFromCatalog } from "@/lib/rajmondata-editor/config";
import { requestEditorLogout } from "@/lib/rajmondata-editor/editor-api-client.server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_MODULES_COLLECTION } from "@/lib/firestore-collections";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";

export const dynamic = "force-dynamic";

function isCode(v: string): v is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(v);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ moduleCode: string }> }
) {
  const authHeader = request.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const v = await verifyCompanyBearer(authHeader);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!idToken) return NextResponse.json({ error: "Chybí token." }, { status: 401 });

  const { moduleCode: raw } = await params;
  const moduleCode = String(raw ?? "").trim();
  if (!isCode(moduleCode) || moduleCode !== "rajmondata_editor") {
    return NextResponse.json({ error: "Neplatný modul." }, { status: 400 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });
  const modSnap = await db.collection(PLATFORM_MODULES_COLLECTION).doc(moduleCode).get();
  const row = buildMergedPlatformCatalogMap(
    modSnap.exists ? [{ id: modSnap.id, ...(modSnap.data() as Record<string, unknown>) }] : []
  )[moduleCode];
  const apiUrl = editorUrlsFromCatalog(row).apiUrl || getRajmondataEditorEnv().apiUrl;

  const res = await requestEditorLogout({
    apiUrl,
    idToken,
    organizationId: v.caller.companyId,
  });
  if (!res.ok) return NextResponse.json({ error: res.error ?? "Logout selhal." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
