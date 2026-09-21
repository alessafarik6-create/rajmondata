import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildIsapiConfigForOrg,
  hikvisionIntegrationRef,
  upsertHikvisionCameras,
} from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { fetchHikvisionInputProxyChannels } from "@/lib/hikvision/isapi-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const cfg = await buildIsapiConfigForOrg(auth.db, companyId);
  if (!cfg.ok) {
    return NextResponse.json({ ok: false, error: cfg.error }, { status: 400 });
  }

  const channelsRes = await fetchHikvisionInputProxyChannels(cfg.config);
  if (!channelsRes.ok) {
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastError: channelsRes.error.slice(0, 500),
        lastCommunicationAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: false, error: channelsRes.error }, { status: 502 });
  }

  const count = await upsertHikvisionCameras(
    auth.db,
    companyId,
    channelsRes.channels.map((ch) => ({
      channelId: ch.channelId,
      name: ch.name,
      ipAddress: ch.ipAddress,
      model: ch.model,
      serialNumber: ch.serialNumber,
      online: ch.online,
      trackStreamId: ch.trackStreamId,
    }))
  );

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

  return NextResponse.json({ ok: true, cameraCount: count, message: `Načteno ${count} kamer.` });
}
