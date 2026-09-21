import type { Firestore } from "firebase-admin/firestore";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";
import { hikvisionCamerasCol } from "@/lib/hikvision/stores";

/** On-demand live view — krátkodobé tokeny/URL, bez permanentního ukládání. */
export class HikvisionStreamGateway {
  constructor(private readonly db: Firestore) {}

  async startLiveSession(params: {
    organizationId: string;
    cameraId: string;
    userId: string;
  }): Promise<
    | {
        ok: true;
        sessionType: "webrtc" | "hls" | "url" | "sdk";
        url?: string;
        token?: string;
        expiresAt?: string;
        message?: string;
      }
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
    return {
      ok: true,
      sessionType: live.sessionType,
      url: live.url,
      token: live.token,
      expiresAt: live.expiresAt,
      message: live.message,
    };
  }

  async stopLiveSession(_sessionId: string): Promise<void> {}
}
