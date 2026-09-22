import {
  buildIsapiConfigForOrg,
  hikvisionCamerasCol,
  listHikvisionCameras,
  loadHikvisionIntegration,
} from "@/lib/hikvision/stores";
import {
  fetchHikvisionChannelPicture,
  fetchHikvisionDeviceInfo,
  fetchHikvisionInputProxyChannels,
} from "@/lib/hikvision/isapi-client";
import type {
  HikvisionProvider,
  HikvisionProviderContext,
  ProviderLiveViewResult,
  ProviderSnapshotResult,
  ProviderSyncCamerasResult,
  ProviderSyncDevicesResult,
  ProviderTestResult,
} from "@/lib/hikvision/providers/types";

export const directIsapiProvider: HikvisionProvider = {
  id: "DIRECT_ISAPI",

  async testConnection(ctx): Promise<ProviderTestResult> {
    const cfg = await buildIsapiConfigForOrg(ctx.db, ctx.organizationId);
    if (!cfg.ok) {
      return {
        ok: false,
        provider: "DIRECT_ISAPI",
        code: "INTEGRATION_NOT_CONFIGURED",
        error: cfg.error,
      };
    }
    const started = Date.now();
    const result = await fetchHikvisionDeviceInfo(cfg.config);
    if (!result.ok) {
      return {
        ok: false,
        provider: "DIRECT_ISAPI",
        code: "ISAPI_ERROR",
        error: result.error,
      };
    }
    return {
      ok: true,
      provider: "DIRECT_ISAPI",
      message: "NVR online — deviceInfo OK (ISAPI).",
      latencyMs: Date.now() - started,
      teamName: null,
      deviceCountHint: 1,
    };
  },

  async syncDevices(ctx): Promise<ProviderSyncDevicesResult> {
    const integration = await loadHikvisionIntegration(ctx.db, ctx.organizationId);
    if (!integration || integration.active === false) {
      return {
        ok: false,
        code: "INTEGRATION_NOT_CONFIGURED",
        error: "Integrace není aktivní.",
      };
    }
    const cfg = await buildIsapiConfigForOrg(ctx.db, ctx.organizationId);
    if (!cfg.ok) {
      return { ok: false, code: "INTEGRATION_NOT_CONFIGURED", error: cfg.error };
    }
    const info = await fetchHikvisionDeviceInfo(cfg.config);
    const online = info.ok;
    return {
      ok: true,
      devices: [
        {
          externalDeviceId: integration.serialNumber?.trim() || "direct-nvr",
          name: integration.deviceLabel?.trim() || integration.deviceName || "NVR",
          model: info.ok ? info.info.model : integration.model,
          serialMasked: info.ok ? info.info.serialNumber : integration.serialNumber,
          online,
          capabilities: { liveView: true, playback: true, snapshot: true },
        },
      ],
    };
  },

  async syncCameras(ctx): Promise<ProviderSyncCamerasResult> {
    const cfg = await buildIsapiConfigForOrg(ctx.db, ctx.organizationId);
    if (!cfg.ok) {
      return { ok: false, code: "INTEGRATION_NOT_CONFIGURED", error: cfg.error };
    }
    const integration = await loadHikvisionIntegration(ctx.db, ctx.organizationId);
    const deviceId = integration?.serialNumber?.trim() || "direct-nvr";
    const channelsRes = await fetchHikvisionInputProxyChannels(cfg.config);
    if (!channelsRes.ok) {
      return { ok: false, code: "ISAPI_ERROR", error: channelsRes.error };
    }
    return {
      ok: true,
      cameras: channelsRes.channels.map((ch) => ({
        externalDeviceId: deviceId,
        externalCameraId: ch.channelId,
        channelId: ch.channelId,
        name: ch.name,
        online: ch.online,
        trackStreamId: ch.trackStreamId,
        ipAddress: ch.ipAddress,
        model: ch.model,
        serialNumber: ch.serialNumber,
        capabilities: { liveView: true, playback: true, snapshot: true },
      })),
    };
  },

  async getSnapshot(ctx, cameraDocId): Promise<ProviderSnapshotResult> {
    const camSnap = await hikvisionCamerasCol(ctx.db, ctx.organizationId).doc(cameraDocId).get();
    if (!camSnap.exists) {
      return { ok: false, code: "CAMERA_OFFLINE", error: "Kamera nenalezena." };
    }
    const trackStreamId = String((camSnap.data() as { trackStreamId?: string })?.trackStreamId ?? "");
    if (!trackStreamId.trim()) {
      return { ok: false, code: "CAMERA_OFFLINE", error: "Chybí stream ID kamery." };
    }
    const cfg = await buildIsapiConfigForOrg(ctx.db, ctx.organizationId);
    if (!cfg.ok) {
      return { ok: false, code: "INTEGRATION_NOT_CONFIGURED", error: cfg.error };
    }
    const pic = await fetchHikvisionChannelPicture(cfg.config, trackStreamId);
    if (!pic.ok) {
      return { ok: false, code: "ISAPI_ERROR", error: pic.error };
    }
    return { ok: true, buffer: pic.buffer, contentType: pic.contentType };
  },

  async getLiveView(_ctx, _cameraDocId, _options?): Promise<ProviderLiveViewResult> {
    return {
      ok: false,
      code: "LIVE_VIEW_NOT_SUPPORTED",
      error:
        "Direct ISAPI: živý obraz přes cloud gateway bude doplněn (WebRTC/HLS). Pro LAN použijte Local Connector.",
    };
  },
};

/** Pro kontrolu existence kamer bez import cycle v testech. */
export async function listDirectIsapiCameraIds(ctx: HikvisionProviderContext) {
  const cams = await listHikvisionCameras(ctx.db, ctx.organizationId);
  return cams.map((c) => c.id);
}
