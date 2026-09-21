import { NextRequest, NextResponse } from "next/server";
import { requireHikvisionIntegrationAdmin } from "@/lib/hikvision/api-auth";
import { getHikvisionJssdkPublicConfig } from "@/lib/hikvision/jssdk-config-shared";
import { checkHikvisionJssdkLocalFiles } from "@/lib/hikvision/jssdk-local-check";
import { listHikvisionCameras } from "@/lib/hikvision/stores";
import { HikvisionStreamGateway } from "@/lib/hikvision/stream-gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();

  const cfg = getHikvisionJssdkPublicConfig();
  const local = checkHikvisionJssdkLocalFiles();
  const jssdkHttpOk =
    local.mode === "external" || local.scriptFileExists === true ? "200" : "404";

  const cams = await listHikvisionCameras(auth.db, companyId);
  const sample = cams.find((c) => c.online) ?? cams[0];

  let liveApi: {
    status: "OK" | "Error";
    code?: string;
    httpStatus?: number;
    playbackType?: string;
    streamUrlPresent?: boolean;
    accessTokenPresent?: boolean;
    expiresAt?: string | null;
  } = {
    status: "Error",
    code: "NO_CAMERA",
  };
  if (sample) {
    const gateway = new HikvisionStreamGateway(auth.db);
    const session = await gateway.startLiveSession({
      organizationId: companyId,
      cameraId: sample.id,
      userId: auth.caller.uid,
    });
    if (session.ok) {
      liveApi = {
        status: "OK",
        playbackType: session.playbackType,
        streamUrlPresent: session.streamUrlPresent,
        accessTokenPresent: session.accessTokenPresent,
        expiresAt: session.expiresAt ?? null,
      };
    } else {
      liveApi = {
        status: "Error",
        code: session.code ?? "HIKVISION_STREAM_UNAVAILABLE",
      };
    }
  }

  return NextResponse.json({
    ok: true,
    jssdkUrl: cfg.scriptUrl,
    jssdkAliasUrls: ["/hikvision-jssdk/ezuikit.js", "/hikvision-jssdk/ezUIKit.js"],
    jssdkHttp: jssdkHttpOk,
    jssdkStatic: local.staticDirExists ? "OK" : "Missing",
    jssdkGlobal: "Check in browser (diagnostika Hik-Connect)",
    liveApiRoute: "POST /api/company/hikvision/cameras/{cameraId}/live",
    liveApi,
    streamToken: liveApi.status === "OK" ? "OK" : "Error",
    playerInit: jssdkHttpOk === "200" ? "Pending browser" : "Blocked (SDK 404)",
    sampleCameraId: sample?.id ?? null,
    timestamp: new Date().toISOString(),
  });
}
