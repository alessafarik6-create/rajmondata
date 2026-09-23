import { isIntegrationActiveFlag } from "@/lib/hikvision/connection-mode";
import {
  HccApiError,
  hccCapturePicture,
  hccGetRecordSettings,
  hccGetStreamToken,
  hccGetVideoAddress,
  hccListCameras,
  hccListDevices,
  hccTestConnection,
} from "@/lib/hikvision/hikconnect-openapi/client";
import {
  loadHikConnectApiCredentials,
  loadHikvisionIntegration,
  hikvisionCamerasCol,
} from "@/lib/hikvision/stores";
import {
  maskDeviceSerial,
  parseEzopenLiveUrl,
  parseRecordSettingStreams,
  pickWebLiveEzopenStream,
  type RecordSettingStreams,
} from "@/lib/hikvision/ezopen-stream-meta";
import type {
  HikvisionProvider,
  ProviderLiveViewResult,
  ProviderPlaybackResult,
  ProviderRecordScheduleResult,
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

async function loadCameraForStream(
  ctx: { db: import("firebase-admin/firestore").Firestore; organizationId: string },
  cameraDocId: string
): Promise<
  | {
      ok: true;
      resourceId: string;
      deviceSerial: string;
      externalCameraId: string;
      channelNo: string;
    }
  | { ok: false; code: "CAMERA_OFFLINE"; error: string }
> {
  const camSnap = await hikvisionCamerasCol(ctx.db, ctx.organizationId).doc(cameraDocId).get();
  if (!camSnap.exists) {
    return { ok: false, code: "CAMERA_OFFLINE", error: "Kamera nenalezena." };
  }
  const cam = camSnap.data() as {
    serialNumber?: string | null;
    trackStreamId?: string;
    externalCameraId?: string | null;
    channelId?: string | null;
  };
  const deviceSerial = String(cam.serialNumber ?? "").trim();
  const resourceId = String(cam.externalCameraId ?? cam.trackStreamId ?? "").trim();
  if (!deviceSerial || !resourceId) {
    return {
      ok: false,
      code: "CAMERA_OFFLINE",
      error: "Chybí identifikátor kamery — synchronizujte kamery z Hik-Connect.",
    };
  }
  const channelNo = String(cam.channelId ?? "1").trim() || "1";
  return {
    ok: true,
    resourceId,
    deviceSerial,
    externalCameraId: resourceId,
    channelNo,
  };
}

async function buildEzopenSession(
  ctx: { db: import("firebase-admin/firestore").Firestore; organizationId: string },
  cred: { apiKey: string; apiSecret: string },
  cameraDocId: string,
  addressType: "1" | "2" | "3",
  times?: { startTime: string; stopTime: string; code?: string },
  liveOpts?: { streamVariant?: "main" | "sub"; subCandidateIndex?: number }
): Promise<ProviderLiveViewResult> {
  const cam = await loadCameraForStream(ctx, cameraDocId);
  if (!cam.ok) return { ok: false, code: cam.code, error: cam.error };

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
      error: "Hik-Connect nevrátil stream token (streamtoken/get).",
    };
  }

  const address = await hccGetVideoAddress({
    organizationId: ctx.organizationId,
    db: ctx.db,
    apiKey: cred.apiKey,
    apiSecret: cred.apiSecret,
    resourceId: cam.resourceId,
    deviceSerial: cam.deviceSerial,
    type: addressType,
    code: times?.code,
    startTime: times?.startTime,
    stopTime: times?.stopTime,
  });

  if (!address.url) {
    return {
      ok: false,
      code: "LIVE_VIEW_NOT_SUPPORTED",
      error: "Hik-Connect nevrátil ezopen URL (live/address/get).",
    };
  }

  const openapiUrl = address.url;
  let streamMeta: RecordSettingStreams = {
    main: { codec: "unknown", width: null, height: null, fps: null, bitrateKbps: null },
    sub: null,
  };
  try {
    const settings = await hccGetRecordSettings({
      organizationId: ctx.organizationId,
      db: ctx.db,
      apiKey: cred.apiKey,
      apiSecret: cred.apiSecret,
      cameraIds: [cam.resourceId],
    });
    if (settings[0]) {
      streamMeta = parseRecordSettingStreams(settings[0] as Record<string, unknown>);
    }
  } catch {
    /* optional */
  }

  const expireMs = stream.appToken ? Date.now() + 6 * 3600 * 1000 : Date.now() + 3600 * 1000;

  /** Výchozí live = přesná URL z OpenAPI (funkční chování před web stream pickerem). */
  if (!liveOpts) {
    const parsedDefault = parseEzopenLiveUrl(openapiUrl);
    return {
      ok: true,
      playbackType: "ezopen",
      sessionType: "sdk",
      ezopenUrl: openapiUrl,
      accessToken: stream.appToken,
      appKey: stream.appKey,
      streamAreaDomain: stream.streamAreaDomain,
      expiresAt: new Date(expireMs).toISOString(),
      message: "Přehrávání přes oficiální Hik-Connect JSSDK (ezopen).",
      deviceSerialMasked: maskDeviceSerial(cam.deviceSerial),
      channelNo: parsedDefault?.channelNo ?? cam.channelNo,
      streamType: parsedDefault?.streamSuffix ?? "live",
      streamVariant: parsedDefault?.streamProfile === "sub" ? "sub" : "main",
      protocol: parsedDefault?.protocol ?? "ezopen",
      codecHint: streamMeta.main.codec,
      openapiEzopenUrl: openapiUrl,
      mainStream: streamMeta.main,
      subStream: streamMeta.sub,
      webLiveSelectionReason: "openapi_default",
      subCandidateIndex: 0,
      webLiveWarning: null,
    };
  }

  const pick = pickWebLiveEzopenStream({
    openapiUrl,
    streams: streamMeta,
    requestedVariant: liveOpts.streamVariant ?? "sub",
    subCandidateIndex: liveOpts.subCandidateIndex ?? 0,
  });
  const ezopenUrl = pick.ezopenUrl;
  const streamVariant = pick.streamVariant;
  const codecHint = pick.codecHint;
  const parsed = parseEzopenLiveUrl(ezopenUrl);

  return {
    ok: true,
    playbackType: "ezopen",
    sessionType: "sdk",
    ezopenUrl,
    accessToken: stream.appToken,
    appKey: stream.appKey,
    streamAreaDomain: stream.streamAreaDomain,
    expiresAt: new Date(expireMs).toISOString(),
    message: "Přehrávání přes oficiální Hik-Connect JSSDK (ezopen).",
    deviceSerialMasked: maskDeviceSerial(cam.deviceSerial),
    channelNo: parsed?.channelNo ?? cam.channelNo,
    streamType: parsed?.streamSuffix ?? (streamVariant === "sub" ? "substream" : "main"),
    streamVariant,
    protocol: parsed?.protocol ?? "ezopen",
    codecHint,
    openapiEzopenUrl: openapiUrl,
    mainStream: streamMeta.main,
    subStream: streamMeta.sub,
    webLiveSelectionReason: pick.selectionReason,
    subCandidateIndex: pick.subCandidateIndex,
    webLiveWarning: pick.webLiveWarning ?? null,
  };
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

  async getLiveView(ctx, cameraDocId, options): Promise<ProviderLiveViewResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    try {
      const liveOpts =
        options &&
        (options.streamVariant != null || options.subCandidateIndex != null)
          ? {
              streamVariant: options.streamVariant ?? "sub",
              subCandidateIndex: options.subCandidateIndex ?? 0,
            }
          : undefined;
      return await buildEzopenSession(
        ctx,
        { apiKey: cred.apiKey, apiSecret: cred.apiSecret },
        cameraDocId,
        "1",
        undefined,
        liveOpts
      );
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },

  async getPlayback(ctx, cameraDocId, params): Promise<ProviderPlaybackResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    const type = params.source === "cloud" ? "3" : "2";
    try {
      return await buildEzopenSession(
        ctx,
        { apiKey: cred.apiKey, apiSecret: cred.apiSecret },
        cameraDocId,
        type,
        {
          startTime: params.startTime,
          stopTime: params.stopTime,
          code: params.code,
        }
      );
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },

  async getRecordSchedule(ctx, cameraDocId): Promise<ProviderRecordScheduleResult> {
    const cred = await requireOpenApiCredentials(ctx.db, ctx.organizationId);
    if (!cred.ok) {
      return { ok: false, code: cred.fail.code, error: cred.fail.error };
    }
    const cam = await loadCameraForStream(ctx, cameraDocId);
    if (!cam.ok) {
      return { ok: false, code: cam.code, error: cam.error };
    }
    try {
      const rows = await hccGetRecordSettings({
        organizationId: ctx.organizationId,
        db: ctx.db,
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret,
        cameraIds: [cam.externalCameraId],
      });
      const row = rows[0] as Record<string, unknown> | undefined;
      const enableLocal = Number(row?.enableLocalStorage) === 1;
      const enableCloud = Number(row?.enableCloudStorage) === 1;
      return {
        ok: true,
        enableLocalStorage: enableLocal,
        enableCloudStorage: enableCloud,
        note:
          "Hik-Connect OpenAPI neposkytuje vyhledání jednotlivých záznamů — lze získat plán nahrávání a adresu přehrání pro zvolený interval (live/address/get).",
      };
    } catch (e) {
      const fail = fromHccError(e);
      return { ok: false, code: fail.code, error: fail.error };
    }
  },
};
