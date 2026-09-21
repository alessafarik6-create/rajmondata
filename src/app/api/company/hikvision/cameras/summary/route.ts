import { NextRequest, NextResponse } from "next/server";
import {
  listHikvisionCameras,
  loadHikvisionIntegration,
} from "@/lib/hikvision/stores";
import { hikvisionTenantOk, requireCamerasRead } from "@/lib/hikvision/api-auth";
import { normalizeConnectionMode } from "@/lib/hikvision/providers/resolver";
import { isHikvisionIntegrationConfigured } from "@/lib/hikvision/integration-status";

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

  const [integration, cameras] = await Promise.all([
    loadHikvisionIntegration(auth.db, companyId),
    listHikvisionCameras(auth.db, companyId),
  ]);
  const online = cameras.filter((c) => c.online).length;
  const offline = cameras.length - online;

  const configured = integration
    ? await isHikvisionIntegrationConfigured(integration, auth.db, companyId)
    : { configured: false as const };

  return NextResponse.json({
    ok: true,
    total: cameras.length,
    online,
    offline,
    connectionMode: normalizeConnectionMode(integration?.connectionMode),
    integrationConfigured: configured.configured,
    nvrStatus: integration?.status ?? "not_connected",
    deviceCount: integration?.deviceCount ?? 0,
    connectorOnline: Boolean(integration?.connectorOnline),
    lastError: integration?.lastError ?? null,
    recentEvents: [],
  });
}
