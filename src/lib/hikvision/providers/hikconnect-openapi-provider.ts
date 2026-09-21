import { isIntegrationActiveFlag } from "@/lib/hikvision/connection-mode";
import {
  HccApiError,
  hccCapturePicture,
  hccGetStreamToken,
  hccListCameras,
  hccListDevices,
  hccTestConnection,
} from "@/lib/hikvision/hikconnect-openapi/client";
import {
  loadHikConnectApiCredentials,
  loadHikvisionIntegration,
  hikvisionCamerasCol,
} from "@/lib/hikvision/stores";
import type {
  HikvisionProvider,
  ProviderLiveViewResult,
  ProviderSnapshotResult,
  ProviderSyncCamerasResult,
  ProviderSyncDevicesResult,
  ProviderTestResult,
} from "@/lib/hikvision/providers/types";

type OpenApiCredFail = Extract<ProviderTestResult, { ok: false }>;

async function requireOpenApiCredentials(
  db: import("firebase-admin/firestore").Firestore,
  organizationId: string
): Promise<
  | { ok: true; apiKey: string; apiSecret: string }
  | { ok: false; fail: OpenApiCredFail }
> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  if (!integration || !isIntegrationActiveFlag(integration.active)) {
    return {
      ok: false,
      fail: {
        ok: false,
        provider: "HIKCONNECT_OPENAPI",
        code: "INTEGRATION_NOT_CONFIGURED",
        error: "Integrace Hik-Connect není aktivní (active=false).",
      },
    };
  }
  const creds = await loadHikConnectApiCredentials(db, organizationId);
  if (!creds.ok) {
    if (creds.reason === "DECRYPT_FAILED") {
      return {
        ok: false,
        fail: {
          ok: false,
          provider: "HIKCONNECT_OPENAPI",
          code: "INTEGRATION_NOT_CONFIGURED",
          error:
            "API Secret nelze dešifrovat (HIKCONNECT_CREDENTIAL_DECRYPT_FAILED). Zkontrolujte šifrovací klíč serveru.",
        },
      };
    }
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

function fromHccError(e: unknown): OpenApiCredFail {
  if (e instanceof HccApiError) {
    return {
      ok: false,
      provider: "HIKCONNECT_OPENAPI",
      code: e.code,
      error: e.message,
    };
  }
  return {
    ok: false,
    provider: "HIKCONNECT_OPENAPI",
    code: "HIKCONNECT_API_ERROR",
    error: e instanceof Error ? e.message : "Hik-Connect API chyba.",
  };
}

export const hikConnectOpenApiProvider: HikvisionProvider = {
  id: "HIKCONNECT_OPENAPI",

  async testConnection(ctx): Promise<ProviderTestResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) return cred.fail;
    try {
      const result = await hccTestConnection({
        organizationId: ctx.organizationId,
        db: ctx.db,
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret,
      });
      return {
        ok: true,
        provider: "HIKCONNECT_OPENAPI",
        message: "Připojení k Hik-Connect bylo úspěšné.",
        latencyMs: result.latencyMs,
        teamName: result.systemGuid ?? null,
      };
    } catch (e) {
      return fromHccError(e);
    }
  },

  async syncDevices(ctx): Promise<ProviderSyncDevicesResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    try {
      const devices = await hccListDevices({
        organizationId: ctx.organizationId,
        db: ctx.db,
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret,
      });
      return {
        ok: true,
        devices: devices.map((d) => ({
          externalDeviceId: d.id,
          name: d.name || d.serialNo || "Zařízení",
          model: d.model,
          serialMasked: d.serialNo ? `***${d.serialNo.slice(-4)}` : null,
          online: d.online,
          capabilities: { liveView: true, playback: true, snapshot: true },
        })),
      };
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },

  async syncCameras(ctx, externalDeviceId): Promise<ProviderSyncCamerasResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    try {
      let deviceSerial: string | undefined;
      if (externalDeviceId) {
        const devices = await hccListDevices({
          organizationId: ctx.organizationId,
          db: ctx.db,
          apiKey: cred.apiKey,
          apiSecret: cred.apiSecret,
        });
        const match = devices.find((d) => d.id === externalDeviceId);
        deviceSerial = match?.serialNo;
      }
      const cameras = await hccListCameras({
        organizationId: ctx.organizationId,
        db: ctx.db,
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret,
        deviceSerialNo: deviceSerial,
      });
      const filtered = externalDeviceId
        ? cameras.filter((c) => c.deviceId === externalDeviceId)
        : cameras;

      return {
        ok: true,
        cameras: filtered.map((ch) => ({
          externalDeviceId: ch.deviceId || ch.deviceSerial,
          externalCameraId: ch.id,
          channelId: ch.channelNo,
          name: ch.name,
          online: ch.online,
          trackStreamId: ch.channelId,
          ipAddress: null,
          model: null,
          serialNumber: ch.deviceSerial || null,
          capabilities: { liveView: true, playback: true, snapshot: true },
        })),
      };
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },

  async getSnapshot(ctx, cameraDocId): Promise<ProviderSnapshotResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    const camSnap = await hikvisionCamerasCol(ctx.db, ctx.organizationId).doc(cameraDocId).get();
    if (!camSnap.exists) {
      return { ok: false, code: "CAMERA_OFFLINE", error: "Kamera nenalezena." };
    }
    const cam = camSnap.data() as {
      serialNumber?: string | null;
      channelId?: string;
      externalDeviceId?: string | null;
    };
    const deviceSerial = String(cam.serialNumber ?? "").trim();
    const channelNo = String(cam.channelId ?? "1").trim();
    if (!deviceSerial) {
      return { ok: false, code: "CAMERA_OFFLINE", error: "Chybí serial zařízení — synchronizujte kamery." };
    }
    try {
      const pic = await hccCapturePicture({
        organizationId: ctx.organizationId,
        db: ctx.db,
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret,
        deviceSerial,
        channelNo,
      });
      if (!pic.captureUrl) {
        return { ok: false, code: "HIKCONNECT_API_ERROR", error: "Hik-Connect nevrátil URL náhledu." };
      }
      const imgRes = await fetch(pic.captureUrl, { cache: "no-store" });
      if (!imgRes.ok) {
        return { ok: false, code: "HIKCONNECT_API_ERROR", error: "Stažení náhledu selhalo." };
      }
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      return { ok: true, buffer, contentType };
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },

  async getLiveView(ctx, _cameraDocId): Promise<ProviderLiveViewResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    try {
      const stream = await hccGetStreamToken({
        organizationId: ctx.organizationId,
        db: ctx.db,
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret,
      });
      if (!stream.appToken) {
        return {
          ok: false,
          code: "LIVE_VIEW_NOT_SUPPORTED",
          error: "Hik-Connect nevrátil stream token — použijte Hikvision JSSDK dle dokumentace.",
        };
      }
      return {
        ok: true,
        sessionType: "sdk",
        token: stream.appToken,
        message:
          "Stream token pro Hik-Connect SDK (GET /api/hccgw/platform/v1/streamtoken/get). Přehrávač doplnit dle JSSDK.",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      };
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },
};
