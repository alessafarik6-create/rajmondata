import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { computePlatformModuleStats } from "@/lib/platform-module-stats.server";
import { probeEditorIntegrationHealth } from "@/lib/rajmondata-editor/editor-api-client.server";
import { getRajmondataEditorEnv } from "@/lib/rajmondata-editor/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Server error" }, { status: 503 });

  const stats = await computePlatformModuleStats(db);
  const editorHealth = await probeEditorIntegrationHealth(getRajmondataEditorEnv().apiUrl);
  return NextResponse.json({ ok: true, stats, editorIntegration: editorHealth });
}
