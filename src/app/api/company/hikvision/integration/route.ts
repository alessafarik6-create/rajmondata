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
  hasHikConnectApiKey,
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
  resolveHikvisionIntegrationLifecycle,
} from "@/lib/hikvision/integration-status";
import {
  isIntegrationActiveFlag,
  normalizeConnectionMode,
} from "@/lib/hikvision/connection-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseConnectionMode(raw: unknown): HikvisionConnectionMode {
  return normalizeConnectionMode(typeof raw === "string" ? raw : String(raw ?? ""));
}

function safeIntegrationPublic(
  integration: Awaited<ReturnType<typeof loadHikvisionIntegration>>,
  hasPassword: boolean,
  hasApiSecret: boolean,
  hasApiKey: boolean,
  apiKey: string,
  integrationConfigured: boolean,
  lifecycle: string
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
      connectionMode: "HIKCONNECT_OPENAPI" as HikvisionConnectionMode,
      active: true,
      status: "not_connected",
      lifecycle: "NOT_CONFIGURED",
      hasPassword: false,
      hasApiSecret: false,
      hasApiKey: false,
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
    active: isIntegrationActiveFlag(integration.active),
    status: integration.status ?? "not_connected",
    lifecycle,
    hasPassword,
    hasApiSecret,
    hasApiKey,
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
  const hasApiKey = await hasHikConnectApiKey(auth.db, companyId);
  const apiKey = String(credData?.apiKey ?? "").trim();
  const configuredCheck = integration
    ? await isHikvisionIntegrationConfigured(integration, auth.db, companyId)
    : { configured: false as const };
  const lifecycleResult = await resolveHikvisionIntegrationLifecycle(auth.db, companyId);
  return NextResponse.json(
    {
      ok: true,
      integration: safeIntegrationPublic(
        integration,
        hasPassword,
        hasApiSecret,
        hasApiKey,
        apiKey,
        configuredCheck.configured,
        lifecycleResult.lifecycle
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

  const connectionMode =
    body.connectionMode !== undefined
      ? parseConnectionMode(body.connectionMode)
      : undefined;

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
  if (connectionMode !== undefined) {
    patch.connectionMode = connectionMode;
  }
  if (body.active !== undefined) {
    patch.active = Boolean(body.active);
  } else if (connectionMode === "HIKCONNECT_OPENAPI" && (apiKey || apiSecret)) {
    patch.active = true;
  }
  if (body.allowInsecureTls !== undefined) patch.allowInsecureTls = Boolean(body.allowInsecureTls);

  const activeAfter = body.active !== undefined ? Boolean(body.active) : patch.active !== false;
  if (activeAfter === false) {
    patch.status = "disabled";
  } else {
    patch.status = "configured";
  }

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
  const lifecycle = await resolveHikvisionIntegrationLifecycle(auth.db, companyId);

  if (process.env.NODE_ENV === "development") {
    const mode = normalizeConnectionMode(integration?.connectionMode);
    console.info("HIKVISION SAVE:", {
      organizationId: companyId,
      connectionMode: mode,
      active: isIntegrationActiveFlag(integration?.active),
      hasApiKey: await hasHikConnectApiKey(auth.db, companyId),
      hasApiSecret: await hasHikConnectApiSecret(auth.db, companyId),
      lifecycle: lifecycle.lifecycle,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      message: "Integrace Hikvision uložena.",
      integrationConfigured: configured.configured,
      lifecycle: lifecycle.lifecycle,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
