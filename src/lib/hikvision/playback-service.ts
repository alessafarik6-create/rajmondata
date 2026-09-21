import type { Firestore } from "firebase-admin/firestore";
import { HikvisionStreamGateway } from "@/lib/hikvision/stream-gateway";
import { resolveHikvisionProviderForOrg } from "@/lib/hikvision/providers/resolver";

export class HikvisionPlaybackService {
  constructor(
    private readonly db: Firestore,
    private readonly organizationId: string
  ) {}

  async searchRecordings(params: {
    cameraId: string;
    from: Date;
    to: Date;
  }): Promise<
    | {
        ok: true;
        segments: Array<{ start: string; end: string; source: "local" | "cloud" }>;
        note: string;
      }
    | { ok: false; error: string; code?: string }
  > {
    const { provider } = await resolveHikvisionProviderForOrg(this.db, this.organizationId);
    if (!provider.getRecordSchedule) {
      return {
        ok: true,
        segments: [
          {
            start: params.from.toISOString(),
            end: params.to.toISOString(),
            source: "local",
          },
        ],
        note:
          "Hik-Connect OpenAPI neuvádí API pro seznam souborů záznamu — zvolte interval a spusťte přehrání.",
      };
    }
    const schedule = await provider.getRecordSchedule(
      { db: this.db, organizationId: this.organizationId },
      params.cameraId
    );
    if (!schedule.ok) {
      return { ok: false, error: schedule.error, code: schedule.code };
    }
    const source: "local" | "cloud" = schedule.enableCloudStorage ? "cloud" : "local";
    return {
      ok: true,
      segments: [
        {
          start: params.from.toISOString(),
          end: params.to.toISOString(),
          source,
        },
      ],
      note: schedule.note,
    };
  }

  async startPlayback(params: {
    cameraId: string;
    userId: string;
    startTime: string;
    stopTime: string;
    source: "local" | "cloud";
    code?: string;
  }) {
    const gateway = new HikvisionStreamGateway(this.db);
    return gateway.startPlaybackSession({
      organizationId: this.organizationId,
      cameraId: params.cameraId,
      userId: params.userId,
      startTime: params.startTime,
      stopTime: params.stopTime,
      source: params.source,
      code: params.code,
    });
  }
}
