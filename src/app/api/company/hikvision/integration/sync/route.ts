import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  hikvisionIntegrationRef,
  loadHikvisionIntegration,
  providerKindForOrgIntegration,
  upsertHikvisionCameras,
  deviceDocId,
} from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";
import { hikvisionErrorMessage } from "@/lib/hikvision/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string; externalDeviceId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { provider } = await resolveHikvisionProviderForOrg(auth.db, companyId);
  const integration = await loadHikvisionIntegration(auth.db, companyId);
  const providerKind = await providerKindForOrgIntegration(auth.db, companyId, integration);

  const result = await provider.syncCameras(
    { db: auth.db, organizationId: companyId },
    body.externalDeviceId
  );
  if (!result.ok) {
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastError: result.error.slice(0, 500),
        lastCommunicationAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        error: result.error,
        message: hikvisionErrorMessage(result.code),
      },
      { status: result.code === "HIKCONNECT_API_NOT_CONFIGURED" ? 503 : 502 }
    );
  }

  const count = await upsertHikvisionCameras(
    auth.db,
    companyId,
    result.cameras.map((ch) => ({
      provider: providerKind,
      deviceId: deviceDocId(ch.externalDeviceId),
      externalDeviceId: ch.externalDeviceId,
      externalCameraId: ch.externalCameraId,
      channelId: ch.channelId,
      name: ch.name,
      ipAddress: ch.ipAddress ?? null,
      model: ch.model ?? null,
      serialNumber: ch.serialNumber ?? null,
      online: ch.online,
      trackStreamId: ch.trackStreamId,
      capabilities: ch.capabilities,
    }))
  );

  const online = result.cameras.filter((c) => c.online).length;

  await hikvisionIntegrationRef(auth.db, companyId).set(
    {
      cameraCount: count,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastCommunicationAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json(
    {
      ok: true,
      cameraCount: count,
      onlineCount: online,
      message: `Synchronizováno ${count} kamer (${online} online).`,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
