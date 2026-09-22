import type { Firestore } from "firebase-admin/firestore";
import type { HikvisionErrorCode } from "@/lib/hikvision/errors";

export type HikvisionProviderId = "HIKCONNECT_OPENAPI" | "DIRECT_ISAPI" | "LOCAL_CONNECTOR";

export type HikvisionProviderContext = {
  db: Firestore;
  organizationId: string;
};

export type HikvisionNormalizedDevice = {
  externalDeviceId: string;
  name: string;
  model?: string | null;
  serialMasked?: string | null;
  online: boolean;
  capabilities?: Record<string, boolean>;
};

export type HikvisionNormalizedCamera = {
  externalDeviceId: string;
  externalCameraId: string;
  channelId: string;
  name: string;
  online: boolean;
  trackStreamId: string;
  ipAddress?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  capabilities?: {
    liveView?: boolean;
    playback?: boolean;
    snapshot?: boolean;
    ptz?: boolean;
  };
};

export type ProviderTestResult =
  | {
      ok: true;
      provider: HikvisionProviderId;
      message: string;
      latencyMs?: number;
      teamName?: string | null;
      deviceCountHint?: number;
    }
  | { ok: false; code: HikvisionErrorCode; error: string; provider: HikvisionProviderId };

export type ProviderSyncDevicesResult =
  | { ok: true; devices: HikvisionNormalizedDevice[] }
  | { ok: false; code: HikvisionErrorCode; error: string };

export type ProviderSyncCamerasResult =
  | { ok: true; cameras: HikvisionNormalizedCamera[] }
  | { ok: false; code: HikvisionErrorCode; error: string };

export type ProviderSnapshotResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; code: HikvisionErrorCode; error: string };

export type ProviderStreamSessionResult =
  | {
      ok: true;
      /** Krátkodobé — neukládat do DB */
      playbackType: "ezopen" | "hls" | "webrtc" | "url";
      sessionType: "sdk" | "hls" | "webrtc" | "url";
      ezopenUrl?: string;
      url?: string;
      accessToken?: string;
      appKey?: string;
      streamAreaDomain?: string;
      expiresAt?: string;
      message?: string;
      deviceSerialMasked?: string;
      channelNo?: string;
      streamType?: string;
      streamVariant?: "main" | "sub";
      protocol?: string;
      codecHint?: "H264" | "H265" | "unknown";
    }
  | { ok: false; code: HikvisionErrorCode; error: string };

export type ProviderLiveViewResult = ProviderStreamSessionResult;

export type ProviderPlaybackResult = ProviderStreamSessionResult;

export type ProviderRecordScheduleResult =
  | {
      ok: true;
      enableLocalStorage: boolean;
      enableCloudStorage: boolean;
      /** OpenAPI neposkytuje seznam souborů — jen plán nahrávání */
      note: string;
    }
  | { ok: false; code: HikvisionErrorCode; error: string };

export interface HikvisionProvider {
  readonly id: HikvisionProviderId;
  testConnection(ctx: HikvisionProviderContext): Promise<ProviderTestResult>;
  syncDevices(ctx: HikvisionProviderContext): Promise<ProviderSyncDevicesResult>;
  syncCameras(
    ctx: HikvisionProviderContext,
    externalDeviceId?: string
  ): Promise<ProviderSyncCamerasResult>;
  getSnapshot(
    ctx: HikvisionProviderContext,
    cameraDocId: string
  ): Promise<ProviderSnapshotResult>;
  getLiveView(
    ctx: HikvisionProviderContext,
    cameraDocId: string,
    options?: { streamVariant?: "main" | "sub" }
  ): Promise<ProviderLiveViewResult>;
  getPlayback?(
    ctx: HikvisionProviderContext,
    cameraDocId: string,
    params: {
      startTime: string;
      stopTime: string;
      source: "local" | "cloud";
      code?: string;
    }
  ): Promise<ProviderPlaybackResult>;
  getRecordSchedule?(
    ctx: HikvisionProviderContext,
    cameraDocId: string
  ): Promise<ProviderRecordScheduleResult>;
}
