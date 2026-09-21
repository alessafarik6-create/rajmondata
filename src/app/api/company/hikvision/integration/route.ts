import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  hikvisionIntegrationRef,
  firestoreTimestampToIso,
  hikvisionCredentialsRef,
  loadHikvisionIntegration,
  saveHikvisionPassword,
  saveHikConnectApiCredentials,
  hasHikConnectApiSecret,
} from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { isHikvisionIntegrationEncryptionConfigured } from "@/lib/hikvision/integration-crypto";
import type { HikvisionConnectionMode } from "@/lib/hikvision/types";
import {
  isHikvisionIntegrationConfiguredForOrg,
  isHikvisionIntegrationConfigured,
} from "@/lib/hikvision/integration-status";
import { normalizeConnectionMode } from "@/lib/hikvision/providers/resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseConnectionMode(raw: unknown): HikvisionConnectionMode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "hikconnect_openapi" || v === "hikconnect") return "hikconnect_openapi";
  if (v === "local_connector") return "local_connector";
  return "direct";
}

function safeIntegrationPublic(
  integration: Awaited<ReturnType<typeof loadHikvisionIntegration>>,
  hasPassword: boolean,
  hasApiSecret: boolean,
  apiKey: string,
  integrationConfigured: boolean
) {
  const mode = normalizeConnectionMode(integration?.connectionMode);
  if (!integration) {
    return {
      deviceLabel: "",
      host: "",
      httpPort: 80,
      httpsPort: 443,
      rtspPort: 554,
      useHttps: false,
      username: "",
      connectionMode: "hikconnect_openapi" as HikvisionConnectionMode,
      active: false,
      status: "not_connected",
      hasPassword: false,
      hasApiSecret: false,
      apiKey: "",
      integrationConfigured: false,
      model: null,
      serialNumber: null,
      firmwareVersion: null,
      deviceName: null,
      cameraCount: 0,
      deviceCount: 0,
      hikConnectTeamName: null,
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
    connectionMode: mode,
    active: Boolean(integration.active),
    status: integration.status ?? "not_connected",
    hasPassword,
    hasApiSecret,
    apiKey,
    integrationConfigured,
    model: integration.model ?? null,
    serialNumber: integration.serialNumber ?? null,
    firmwareVersion: integration.firmwareVersion ?? null,
    deviceName: integration.deviceName ?? null,
    cameraCount: integration.cameraCount ?? 0,
    deviceCount: integration.deviceCount ?? 0,
    hikConnectTeamName: integration.hikConnectTeamName ?? null,
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
  const credData = credSnap.data() as { encryptedPassword?: string; apiKey?: string };
  const hasPassword = Boolean(String(credData?.encryptedPassword ?? "").trim());
  const hasApiSecret = await hasHikConnectApiSecret(auth.db, companyId);
  const apiKey = String(credData?.apiKey ?? "").trim();
  const configuredCheck = integration
    ? await isHikvisionIntegrationConfigured(integration, auth.db, companyId)
    : { configured: false as const };
  return NextResponse.json(
    {
      ok: true,
      integration: safeIntegrationPublic(
        integration,
        hasPassword,
        hasApiSecret,
        apiKey,
        configuredCheck.configured
      ),
      encryptionConfigured: isHikvisionIntegrationEncryptionConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
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
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
  const needsEncryption = Boolean(password) || Boolean(apiSecret);
  if (needsEncryption && !isHikvisionIntegrationEncryptionConfigured()) {
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
    patch.connectionMode = parseConnectionMode(body.connectionMode);
  }
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.allowInsecureTls !== undefined) patch.allowInsecureTls = Boolean(body.allowInsecureTls);
  if (body.active === false) patch.status = "disabled";
  else patch.status = "configured";

  await ref.set(patch, { merge: true });
  if (password) {
    await saveHikvisionPassword(auth.db, companyId, password);
  }
  if (apiKey || apiSecret) {
    await saveHikConnectApiCredentials(auth.db, companyId, {
      apiKey: apiKey || undefined,
      apiSecret: apiSecret || undefined,
    });
  }

  const integration = await loadHikvisionIntegration(auth.db, companyId);
  const configured = integration
    ? await isHikvisionIntegrationConfigured(integration, auth.db, companyId)
    : await isHikvisionIntegrationConfiguredForOrg(auth.db, companyId);

  return NextResponse.json(
    {
      ok: true,
      message: "Integrace Hikvision uložena.",
      integrationConfigured: configured.configured,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
