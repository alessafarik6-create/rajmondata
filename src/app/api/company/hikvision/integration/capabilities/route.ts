import { NextRequest, NextResponse } from "next/server";
import {
  hccCapturePicture,
  hccGetStreamToken,
  hccGetVideoAddress,
  hccListCameras,
  hccTestConnection,
} from "@/lib/hikvision/hikconnect-openapi/client";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import {
  loadHikConnectApiCredentials,
  loadHikvisionIntegration,
  listHikvisionCameras,
} from "@/lib/hikvision/stores";
import { resolveEffectiveConnectionMode } from "@/lib/hikvision/resolve-effective-connection-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CapRow = { id: string; label: string; status: "ok" | "fail" | "unsupported"; detail?: string };

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
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const integration = await loadHikvisionIntegration(auth.db, companyId);
  const mode = await resolveEffectiveConnectionMode(integration, auth.db, companyId);
  const capabilities: CapRow[] = [];

  if (mode !== "HIKCONNECT_OPENAPI") {
    return NextResponse.json({
      ok: true,
      connectionMode: mode,
      capabilities: [
        { id: "auth", label: "Autentizace", status: "ok" as const },
        {
          id: "live",
          label: "Live stream",
          status: "unsupported" as const,
          detail: "Diagnostika live je pro Hik-Connect Cloud OpenAPI.",
        },
      ],
    });
  }

  const creds = await loadHikConnectApiCredentials(auth.db, companyId);
  if (!creds.ok) {
    return NextResponse.json({
      ok: false,
      error: "Chybí API Key nebo Secret.",
    });
  }

  try {
    await hccTestConnection({
      organizationId: companyId,
      db: auth.db,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });
    capabilities.push({ id: "auth", label: "Autentizace", status: "ok" });
  } catch (e) {
    capabilities.push({
      id: "auth",
      label: "Autentizace",
      status: "fail",
      detail: e instanceof Error ? e.message : "Selhalo",
    });
  }

  try {
    await hccListCameras({
      organizationId: companyId,
      db: auth.db,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });
    capabilities.push({ id: "cameras", label: "Kamery", status: "ok" });
  } catch (e) {
    capabilities.push({
      id: "cameras",
      label: "Kamery",
      status: "fail",
      detail: e instanceof Error ? e.message : "Selhalo",
    });
  }

  const cams = await listHikvisionCameras(auth.db, companyId);
  const sample = cams[0];
  if (sample?.serialNumber && sample.channelId) {
    try {
      await hccCapturePicture({
        organizationId: companyId,
        db: auth.db,
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        deviceSerial: String(sample.serialNumber),
        channelNo: String(sample.channelId),
      });
      capabilities.push({ id: "snapshot", label: "Snapshot", status: "ok" });
    } catch (e) {
      capabilities.push({
        id: "snapshot",
        label: "Snapshot",
        status: "fail",
        detail: e instanceof Error ? e.message : "Selhalo",
      });
    }
  } else {
    capabilities.push({
      id: "snapshot",
      label: "Snapshot",
      status: "unsupported",
      detail: "Synchronizujte kamery.",
    });
  }

  try {
    const token = await hccGetStreamToken({
      organizationId: companyId,
      db: auth.db,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });
    if (sample && token.appToken) {
      await hccGetVideoAddress({
        organizationId: companyId,
        db: auth.db,
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        resourceId: String(sample.externalCameraId ?? sample.trackStreamId),
        deviceSerial: String(sample.serialNumber),
        type: "1",
      });
      capabilities.push({
        id: "live",
        label: "Live (ezopen + JSSDK)",
        status: "ok",
        detail: "Vyžaduje Hik-Connect JSSDK v prohlížeči.",
      });
    } else {
      capabilities.push({
        id: "live",
        label: "Live stream",
        status: "fail",
        detail: "Chybí stream token nebo ukázková kamera.",
      });
    }
  } catch (e) {
    capabilities.push({
      id: "live",
      label: "Live stream",
      status: "fail",
      detail: e instanceof Error ? e.message : "Selhalo",
    });
  }

  capabilities.push({
    id: "playback",
    label: "Playback (live/address type 2/3)",
    status: sample ? "ok" : "unsupported",
    detail: sample
      ? "Vyžaduje JSSDK; OpenAPI neposkytuje seznam souborů."
      : "Synchronizujte kamery.",
  });

  capabilities.push({
    id: "events",
    label: "Alarmy (mq pull)",
    status: "ok",
    detail: "Pull POST /api/hccgw/alarm/v1/mq/messages — webhook push v dokumentaci není.",
  });

  return NextResponse.json({
    ok: true,
    connectionMode: mode,
    capabilities,
    timestamp: new Date().toISOString(),
  });
}
