import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  hikvisionIntegrationRef,
  providerKindForOrgIntegration,
  upsertHikvisionDevices,
  loadHikvisionIntegration,
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

  const { provider } = await resolveHikvisionProviderForOrg(auth.db, companyId);
  const integration = await loadHikvisionIntegration(auth.db, companyId);
  const providerKind = providerKindForOrgIntegration(integration);

  const result = await provider.syncDevices({ db: auth.db, organizationId: companyId });
  if (!result.ok) {
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastError: result.error.slice(0, 500),
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

  const count = await upsertHikvisionDevices(
    auth.db,
    companyId,
    providerKind,
    result.devices.map((d) => ({
      externalDeviceId: d.externalDeviceId,
      name: d.name,
      model: d.model ?? null,
      serialMasked: d.serialMasked ?? null,
      online: d.online,
      capabilities: d.capabilities,
    }))
  );

  await hikvisionIntegrationRef(auth.db, companyId).set(
    {
      deviceCount: count,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastCommunicationAt: FieldValue.serverTimestamp(),
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json(
    { ok: true, deviceCount: count, message: `Synchronizováno ${count} zařízení.` },
    { headers: { "Cache-Control": "no-store" } }
  );
}
