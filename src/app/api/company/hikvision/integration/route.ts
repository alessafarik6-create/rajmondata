import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  hikvisionIntegrationRef,
  firestoreTimestampToIso,
  hikvisionCredentialsRef,
  loadHikvisionIntegration,
  saveHikvisionPassword,
} from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { isHikvisionIntegrationEncryptionConfigured } from "@/lib/hikvision/integration-crypto";
import type { HikvisionConnectionMode } from "@/lib/hikvision/types";

export const dynamic = "force-dynamic";

function safeIntegrationPublic(
  integration: Awaited<ReturnType<typeof loadHikvisionIntegration>>,
  hasPassword: boolean
) {
  if (!integration) {
    return {
      deviceLabel: "",
      host: "",
      httpPort: 80,
      httpsPort: 443,
      rtspPort: 554,
      useHttps: false,
      username: "",
      connectionMode: "direct" as HikvisionConnectionMode,
      active: false,
      status: "not_connected",
      hasPassword,
      model: null,
      serialNumber: null,
      firmwareVersion: null,
      deviceName: null,
      cameraCount: 0,
      connectorOnline: false,
      lastTestAt: null,
      lastSyncAt: null,
      lastCommunicationAt: null,
      lastError: null,
      lastConnectorHeartbeatAt: null,
      allowInsecureTls: false,
    };
  }
  return {
    deviceLabel: integration.deviceLabel ?? "",
    host: integration.host ?? "",
    httpPort: integration.httpPort ?? 80,
    httpsPort: integration.httpsPort ?? 443,
    rtspPort: integration.rtspPort ?? 554,
    useHttps: Boolean(integration.useHttps),
    username: integration.username ?? "",
    connectionMode: integration.connectionMode ?? "direct",
    active: Boolean(integration.active),
    status: integration.status ?? "not_connected",
    hasPassword,
    model: integration.model ?? null,
    serialNumber: integration.serialNumber ?? null,
    firmwareVersion: integration.firmwareVersion ?? null,
    deviceName: integration.deviceName ?? null,
    cameraCount: integration.cameraCount ?? 0,
    connectorOnline: Boolean(integration.connectorOnline),
    lastTestAt: firestoreTimestampToIso(integration.lastTestAt),
    lastSyncAt: firestoreTimestampToIso(integration.lastSyncAt),
    lastCommunicationAt: firestoreTimestampToIso(integration.lastCommunicationAt),
    lastConnectorHeartbeatAt: firestoreTimestampToIso(integration.lastConnectorHeartbeatAt),
    lastError: integration.lastError ?? null,
    allowInsecureTls: Boolean(integration.allowInsecureTls),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const integration = await loadHikvisionIntegration(auth.db, companyId);
  const credSnap = await hikvisionCredentialsRef(auth.db, companyId).get();
  const hasPassword = Boolean(
    String((credSnap.data() as { encryptedPassword?: string })?.encryptedPassword ?? "").trim()
  );
  return NextResponse.json({
    ok: true,
    integration: safeIntegrationPublic(integration, hasPassword),
    encryptionConfigured: isHikvisionIntegrationEncryptionConfigured(),
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const password = typeof body.password === "string" ? body.password.trim() : "";
  if (password && !isHikvisionIntegrationEncryptionConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Server nemá nastaven šifrovací klíč (EMAIL_CREDENTIALS_ENCRYPTION_KEY).",
      },
      { status: 503 }
    );
  }

  const ref = hikvisionIntegrationRef(auth.db, companyId);
  const patch: Record<string, unknown> = {
    organizationId: companyId,
    updatedAt: FieldValue.serverTimestamp(),
    configuredByUserId: auth.caller.uid,
  };
  if (body.deviceLabel !== undefined) patch.deviceLabel = String(body.deviceLabel ?? "").trim();
  if (body.host !== undefined) patch.host = String(body.host ?? "").trim();
  if (body.httpPort !== undefined) patch.httpPort = Number(body.httpPort) || 80;
  if (body.httpsPort !== undefined) patch.httpsPort = Number(body.httpsPort) || 443;
  if (body.rtspPort !== undefined) patch.rtspPort = Number(body.rtspPort) || 554;
  if (body.useHttps !== undefined) patch.useHttps = Boolean(body.useHttps);
  if (body.username !== undefined) patch.username = String(body.username ?? "").trim();
  if (body.connectionMode !== undefined) {
    const mode = String(body.connectionMode);
    patch.connectionMode =
      mode === "local_connector" ? "local_connector" : ("direct" as HikvisionConnectionMode);
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.allowInsecureTls !== undefined) patch.allowInsecureTls = Boolean(body.allowInsecureTls);
  if (body.active === false) patch.status = "disabled";
  else if (body.host) patch.status = "configured";

  await ref.set(patch, { merge: true });
  if (password) {
    await saveHikvisionPassword(auth.db, companyId, password);
  }

  return NextResponse.json({ ok: true, message: "Integrace Hikvision uložena." });
}
