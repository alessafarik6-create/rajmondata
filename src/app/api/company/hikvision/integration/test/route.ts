import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  hikvisionIntegrationRef,
  hasHikConnectApiKey,
  hasHikConnectApiSecret,
  loadHikvisionIntegration,
} from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";
import {
  isHikvisionIntegrationConfiguredForOrg,
  resolveHikvisionIntegrationLifecycle,
} from "@/lib/hikvision/integration-status";
import { hikvisionErrorMessage } from "@/lib/hikvision/errors";
import {
  isIntegrationActiveFlag,
  normalizeConnectionMode,
  providerNameForMode,
} from "@/lib/hikvision/connection-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function httpStatusForProviderCode(code: string): number {
  if (code === "INTEGRATION_NOT_CONFIGURED") return 400;
  if (code === "HIKCONNECT_AUTH_FAILED") return 401;
  if (code === "HIKCONNECT_PERMISSION_DENIED") return 403;
  if (code === "HIKCONNECT_RATE_LIMIT") return 429;
  if (code === "HIKCONNECT_API_NOT_CONFIGURED") return 503;
  if (code === "DEVICE_OFFLINE") return 503;
  return 502;
}

export async function POST(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, ok: false, error: auth.error },
      { status: auth.status }
    );
  }
  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json(
      { success: false, ok: false, error: "Neplatná organizace." },
      { status: 403 }
    );
  }

  try {
    const integration = await loadHikvisionIntegration(auth.db, companyId);
    const mode = normalizeConnectionMode(integration?.connectionMode);
    const active = isIntegrationActiveFlag(integration?.active);
    const hasApiKey = await hasHikConnectApiKey(auth.db, companyId);
    const hasApiSecret = await hasHikConnectApiSecret(auth.db, companyId);
    const providerLabel = providerNameForMode(mode);

    if (process.env.NODE_ENV === "development") {
      console.info("HIKVISION CONFIG:", {
        organizationId: companyId,
        mode,
        active,
        hasApiKey,
        hasApiSecret,
        provider: providerLabel,
      });
    }

    const configured = await isHikvisionIntegrationConfiguredForOrg(auth.db, companyId);
    if (!configured.configured) {
      const lifecycle = await resolveHikvisionIntegrationLifecycle(auth.db, companyId);
      await hikvisionIntegrationRef(auth.db, companyId).set(
        {
          lastTestAt: FieldValue.serverTimestamp(),
          lastError: (configured.reason ?? "Není nakonfigurováno.").slice(0, 500),
          status: "error",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return NextResponse.json(
        {
          success: false,
          ok: false,
          code: "INTEGRATION_NOT_CONFIGURED",
          message: configured.reason,
          error: configured.reason,
          connectionMode: mode,
          lifecycle: lifecycle.lifecycle,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { provider, mode: resolvedMode } = await resolveHikvisionProviderForOrg(
      auth.db,
      companyId
    );
    const result = await provider.testConnection({ db: auth.db, organizationId: companyId });

    if (!result.ok) {
      if (process.env.NODE_ENV === "development") {
        console.error("HikConnect test failed", {
          organizationId: companyId,
          connectionMode: resolvedMode,
          active,
          hasApiKey,
          hasApiSecret,
          provider: provider.id,
          code: result.code,
          errorMessage: result.error,
        });
      }
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
      const status = httpStatusForProviderCode(result.code);
      return NextResponse.json(
        {
          success: false,
          ok: false,
          provider: result.provider,
          connectionMode: resolvedMode,
          code: result.code,
          error: result.error,
          message: hikvisionErrorMessage(result.code),
        },
        { status, headers: { "Cache-Control": "no-store" } }
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
        success: true,
        ok: true,
        provider: result.provider,
        connectionMode: resolvedMode,
        message: result.message,
        latencyMs: result.latencyMs,
        teamName: result.teamName ?? null,
        lifecycle: "CONNECTED",
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "Error";
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("HikConnect test failed", {
      organizationId: companyId,
      errorName,
      errorMessage,
    });
    return NextResponse.json(
      {
        success: false,
        ok: false,
        code: "HIKCONNECT_API_ERROR",
        message: "Interní chyba serveru při testu Hikvision.",
        error: errorMessage.slice(0, 200),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
