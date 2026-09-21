import type { Firestore } from "firebase-admin/firestore";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";
import { hikvisionCamerasCol } from "@/lib/hikvision/stores";

/** On-demand live view — krátkodobé tokeny/URL, bez permanentního ukládání. */
export class HikvisionStreamGateway {
  constructor(private readonly db: Firestore) {}

  private mapSession(live: Extract<
    import("@/lib/hikvision/providers/types").ProviderLiveViewResult,
    { ok: true }
  >) {
    return {
      ok: true as const,
      success: true as const,
      playbackType: live.playbackType,
      sessionType: live.sessionType,
      url: live.url ?? live.ezopenUrl,
      ezopenUrl: live.ezopenUrl,
      accessToken: live.accessToken,
      appKey: live.appKey,
      streamAreaDomain: live.streamAreaDomain,
      expiresAt: live.expiresAt,
      message: live.message,
    };
  }

  async startLiveSession(params: {
    organizationId: string;
    cameraId: string;
    userId: string;
  }): Promise<
    | ReturnType<HikvisionStreamGateway["mapSession"]>
    | { ok: false; error: string; code?: string }
  > {
    void params.userId;
    const camSnap = await hikvisionCamerasCol(this.db, params.organizationId)
      .doc(params.cameraId)
      .get();
    if (!camSnap.exists) {
      return { ok: false, error: "Kamera nenalezena." };
    }

    const { provider } = await resolveHikvisionProviderForOrg(this.db, params.organizationId);
    const live = await provider.getLiveView(
      { db: this.db, organizationId: params.organizationId },
      params.cameraId
    );
    if (!live.ok) {
      return { ok: false, error: live.error, code: live.code };
    }
    return this.mapSession(live);
  }

  async startPlaybackSession(params: {
    organizationId: string;
    cameraId: string;
    userId: string;
    startTime: string;
    stopTime: string;
    source: "local" | "cloud";
    code?: string;
  }): Promise<
    | ReturnType<HikvisionStreamGateway["mapSession"]>
    | { ok: false; error: string; code?: string }
  > {
    void params.userId;
    const camSnap = await hikvisionCamerasCol(this.db, params.organizationId)
      .doc(params.cameraId)
      .get();
    if (!camSnap.exists) {
      return { ok: false, error: "Kamera nenalezena." };
    }

    const { provider } = await resolveHikvisionProviderForOrg(this.db, params.organizationId);
    if (!provider.getPlayback) {
      return {
        ok: false,
        code: "LIVE_VIEW_NOT_SUPPORTED",
        error: "Přehrávání záznamu není pro tento režim připojení podporováno.",
      };
    }
    const playback = await provider.getPlayback(
      { db: this.db, organizationId: params.organizationId },
      params.cameraId,
      {
        startTime: params.startTime,
        stopTime: params.stopTime,
        source: params.source,
        code: params.code,
      }
    );
    if (!playback.ok) {
      return { ok: false, error: playback.error, code: playback.code };
    }
    return this.mapSession(playback);
  }

  async stopLiveSession(_sessionId: string): Promise<void> {}
}
