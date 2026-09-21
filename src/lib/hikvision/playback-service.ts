/** Fáze 5 — vyhledání a přehrání záznamu přes ISAPI (ContentMgmt / search). */
export class HikvisionPlaybackService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_organizationId: string) {}

  async searchRecordings(_params: {
    cameraId: string;
    from: Date;
    to: Date;
  }): Promise<{ ok: false; error: string }> {
    return { ok: false, error: "Přehrávání záznamu bude dostupné v další fázi." };
  }
}
