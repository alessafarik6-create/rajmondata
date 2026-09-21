import { NextRequest, NextResponse } from "next/server";
import { requireHikvisionIntegrationAdmin } from "@/lib/hikvision/api-auth";
import { getHikvisionJssdkPublicConfig } from "@/lib/hikvision/jssdk-config-shared";
import { checkHikvisionJssdkLocalFiles } from "@/lib/hikvision/jssdk-local-check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const config = getHikvisionJssdkPublicConfig();
  const local = checkHikvisionJssdkLocalFiles();

  return NextResponse.json({
    ok: true,
    config,
    local,
    timestamp: new Date().toISOString(),
  });
}
