import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildIsapiConfigForOrg,
  hikvisionIntegrationRef,
} from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { fetchHikvisionDeviceInfo } from "@/lib/hikvision/isapi-client";

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
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastTestAt: FieldValue.serverTimestamp(),
        lastError: cfg.error.slice(0, 500),
        status: "error",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: false, error: cfg.error });
  }

  const result = await fetchHikvisionDeviceInfo(cfg.config);
  if (!result.ok) {
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastTestAt: FieldValue.serverTimestamp(),
        lastCommunicationAt: FieldValue.serverTimestamp(),
        lastError: result.error.slice(0, 500),
        status: "offline",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: false, error: result.error, status: result.status });
  }

  await hikvisionIntegrationRef(auth.db, companyId).set(
    {
      lastTestAt: FieldValue.serverTimestamp(),
      lastCommunicationAt: FieldValue.serverTimestamp(),
      lastError: null,
      status: "online",
      model: result.info.model,
      serialNumber: result.info.serialNumber,
      firmwareVersion: result.info.firmwareVersion,
      deviceName: result.info.deviceName,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({
    ok: true,
    online: true,
    deviceName: result.info.deviceName,
    model: result.info.model,
    serialNumber: result.info.serialNumber,
    firmwareVersion: result.info.firmwareVersion,
    message: "NVR online — deviceInfo OK.",
  });
}
