import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { hikvisionIntegrationRef } from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";
import { isHikvisionIntegrationConfiguredForOrg } from "@/lib/hikvision/integration-status";
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

  const configured = await isHikvisionIntegrationConfiguredForOrg(auth.db, companyId);
  if (!configured.configured) {
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastTestAt: FieldValue.serverTimestamp(),
        lastError: (configured.reason ?? "Není nakonfigurováno.").slice(0, 500),
        status: "error",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json({ ok: false, error: configured.reason });
  }

  const { provider, mode } = await resolveHikvisionProviderForOrg(auth.db, companyId);
  const result = await provider.testConnection({ db: auth.db, organizationId: companyId });

  if (!result.ok) {
    await hikvisionIntegrationRef(auth.db, companyId).set(
      {
        lastTestAt: FieldValue.serverTimestamp(),
        lastCommunicationAt: FieldValue.serverTimestamp(),
        lastError: result.error.slice(0, 500),
        status: result.code === "DEVICE_OFFLINE" ? "offline" : "error",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return NextResponse.json(
      {
        ok: false,
        provider: result.provider,
        connectionMode: mode,
        code: result.code,
        error: result.error,
        message: hikvisionErrorMessage(result.code),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  await hikvisionIntegrationRef(auth.db, companyId).set(
    {
      lastTestAt: FieldValue.serverTimestamp(),
      lastCommunicationAt: FieldValue.serverTimestamp(),
      lastError: null,
      status: "online",
      hikConnectTeamName: result.teamName ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json(
    {
      ok: true,
      provider: result.provider,
      connectionMode: mode,
      message: result.message,
      latencyMs: result.latencyMs,
      teamName: result.teamName ?? null,
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
