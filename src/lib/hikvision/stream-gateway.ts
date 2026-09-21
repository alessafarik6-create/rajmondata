/** Fáze 4 — on-demand RTSP → WebRTC/HLS gateway (bez permanentního transcodingu). */
export class HikvisionStreamGateway {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async startLiveSession(_params: {
    organizationId: string;
    cameraId: string;
    userId: string;
  }): Promise<{ ok: false; error: string }> {
    return { ok: false, error: "Živý obraz bude dostupný v další fázi (WebRTC/HLS gateway)." };
  }

  async stopLiveSession(_sessionId: string): Promise<void> {}
}
