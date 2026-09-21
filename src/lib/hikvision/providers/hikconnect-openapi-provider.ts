import {
  getHikConnectOpenApiServerConfig,
  isHikConnectOpenApiServerConfigured,
} from "@/lib/hikvision/hikconnect-openapi/config";
import { signHikConnectOpenApiRequest } from "@/lib/hikvision/hikconnect-openapi/sign-request";
import {
  loadHikConnectApiCredentials,
  loadHikvisionIntegration,
} from "@/lib/hikvision/stores";
import type {
  HikvisionProvider,
  ProviderLiveViewResult,
  ProviderSnapshotResult,
  ProviderSyncCamerasResult,
  ProviderSyncDevicesResult,
  ProviderTestResult,
} from "@/lib/hikvision/providers/types";

const NOT_CONFIGURED_MSG =
  "Hik-Connect OpenAPI: chybí oficiální specifikace nebo server env (HIKCONNECT_OPENAPI_BASE_URL, HIKCONNECT_OPENAPI_TEST_PATH, podpis requestu). Viz src/lib/hikvision/hikconnect-openapi/README.md";

type OpenApiCredFail = Extract<ProviderTestResult, { ok: false }>;

async function requireOpenApiCredentials(
  db: import("firebase-admin/firestore").Firestore,
  organizationId: string
): Promise<
  | { ok: true; apiKey: string; apiSecret: string }
  | { ok: false; fail: OpenApiCredFail }
> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  if (!integration?.active) {
    return {
      ok: false,
      fail: {
        ok: false,
        provider: "HIKCONNECT_OPENAPI",
        code: "INTEGRATION_NOT_CONFIGURED",
        error: "Integrace Hik-Connect není aktivní.",
      },
    };
  }
  const creds = await loadHikConnectApiCredentials(db, organizationId);
  if (!creds?.apiKey || !creds.apiSecret) {
    return {
      ok: false,
      fail: {
        ok: false,
        provider: "HIKCONNECT_OPENAPI",
        code: "HIKCONNECT_AUTH_FAILED",
        error: "Chybí API Key nebo API Secret.",
      },
    };
  }
  return { ok: true, apiKey: creds.apiKey, apiSecret: creds.apiSecret };
}

export const hikConnectOpenApiProvider: HikvisionProvider = {
  id: "HIKCONNECT_OPENAPI",

  async testConnection(ctx): Promise<ProviderTestResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) return cred.fail;

    if (!isHikConnectOpenApiServerConfigured()) {
      return {
        ok: false,
        provider: "HIKCONNECT_OPENAPI",
        code: "HIKCONNECT_API_NOT_CONFIGURED",
        error: NOT_CONFIGURED_MSG,
      };
    }

    const { baseUrl, testPath } = getHikConnectOpenApiServerConfig();
    const signed = signHikConnectOpenApiRequest({
      method: "GET",
      path: testPath!,
      apiKey: cred.apiKey,
      apiSecret: cred.apiSecret,
    });
    if (!signed) {
      return {
        ok: false,
        provider: "HIKCONNECT_OPENAPI",
        code: "HIKCONNECT_API_NOT_CONFIGURED",
        error:
          "Podpis Hik-Connect requestů není implementován (TODO sign-request.ts dle oficiální dokumentace).",
      };
    }

    const started = Date.now();
    try {
      const url = `${baseUrl!.replace(/\/$/, "")}${testPath!.startsWith("/") ? testPath : `/${testPath}`}`;
      const res = await fetch(url, {
        method: "GET",
        headers: signed.headers,
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          provider: "HIKCONNECT_OPENAPI",
          code: "HIKCONNECT_AUTH_FAILED",
          error: "Hik-Connect odmítl přihlášení (401/403).",
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          provider: "HIKCONNECT_OPENAPI",
          code: "HIKCONNECT_RATE_LIMIT",
          error: "Překročen limit Hik-Connect API.",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          provider: "HIKCONNECT_OPENAPI",
          code: "HIKCONNECT_API_ERROR",
          error: `Hik-Connect test HTTP ${res.status}.`,
        };
      }
      return {
        ok: true,
        provider: "HIKCONNECT_OPENAPI",
        message: "Hik-Connect test endpoint odpověděl.",
        latencyMs: Date.now() - started,
        teamName: integrationTeamLabel(ctx),
      };
    } catch {
      return {
        ok: false,
        provider: "HIKCONNECT_OPENAPI",
        code: "HIKCONNECT_API_ERROR",
        error: "Hik-Connect API není dostupné.",
      };
    }
  },

  async syncDevices(ctx): Promise<ProviderSyncDevicesResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    // TODO(HIKCONNECT_OPENAPI_DEVICES): implement when device list endpoint is documented
    return {
      ok: false,
      code: "HIKCONNECT_API_NOT_CONFIGURED",
      error: "Synchronizace zařízení Hik-Connect: chybí endpoint v dokumentaci (TODO).",
    };
  },

  async syncCameras(ctx): Promise<ProviderSyncCamerasResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    // TODO(HIKCONNECT_OPENAPI_CAMERAS): implement when channel/camera list endpoint is documented
    return {
      ok: false,
      code: "HIKCONNECT_API_NOT_CONFIGURED",
      error: "Synchronizace kamer Hik-Connect: chybí endpoint v dokumentaci (TODO).",
    };
  },

  async getSnapshot(_ctx, _cameraDocId): Promise<ProviderSnapshotResult> {
    return {
      ok: false,
      code: "HIKCONNECT_API_NOT_CONFIGURED",
      error: "Snapshot přes Hik-Connect OpenAPI: TODO (oficiální endpoint).",
    };
  },

  async getLiveView(_ctx, _cameraDocId): Promise<ProviderLiveViewResult> {
    return {
      ok: false,
      code: "LIVE_VIEW_NOT_SUPPORTED",
      error:
        "Live view přes Hik-Connect OpenAPI: TODO (oficiální stream URL / token / player SDK dle Hikvision).",
    };
  },
};

function integrationTeamLabel(ctx: {
  db: import("firebase-admin/firestore").Firestore;
  organizationId: string;
}): string | null {
  void ctx;
  return null;
}
