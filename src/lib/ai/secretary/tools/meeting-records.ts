import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { resolveMeetingTitle } from "@/lib/meeting-records-types";
import type { MeetingAiSummaryMeta } from "@/lib/meeting-records-media-types";

export async function searchMeetingRecordsTool(
  db: Firestore,
  companyId: string,
  args: { query?: string; limit?: number }
): Promise<{ records: Array<Record<string, unknown>> }> {
  const q = String(args.query ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 8);

  let snap;
  try {
    snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("meetingRecords")
      .orderBy("meetingAt", "desc")
      .limit(40)
      .get();
  } catch {
    snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("meetingRecords")
      .limit(40)
      .get();
  }

  const records = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const ai = (data.aiSummary ?? {}) as MeetingAiSummaryMeta;
      const title = resolveMeetingTitle({
        title: typeof data.title === "string" ? data.title : "",
        meetingTitle: typeof data.meetingTitle === "string" ? data.meetingTitle : null,
      });
      const summary =
        ai.structured?.shortSummary ??
        (typeof data.meetingNotes === "string" ? data.meetingNotes.slice(0, 400) : "");
      return {
        recordId: d.id,
        title,
        customerName: data.customerName ?? null,
        jobName: data.jobName ?? null,
        meetingAt:
          (data.meetingAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null,
        shortSummary: summary,
        hasAiSummary: ai.status === "ready",
        keyPoints: ai.structured?.mainPoints?.slice(0, 5) ?? [],
        decisions: ai.structured?.agreed?.slice(0, 5) ?? [],
        nextSteps: ai.structured?.nextSteps?.slice(0, 5) ?? [],
      };
    })
    .filter((r) => {
      if (!q) return true;
      const hay = `${r.title} ${r.customerName ?? ""} ${r.jobName ?? ""} ${r.shortSummary}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, limit);

  return { records };
}
