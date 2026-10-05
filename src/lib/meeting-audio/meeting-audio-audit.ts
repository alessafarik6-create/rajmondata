import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

const ACTIVITY = "activityLogs";

export async function logMeetingAudioAudit(
  db: Firestore,
  input: {
    companyId: string;
    userId: string;
    recordId: string;
    action:
      | "meeting_recording_started"
      | "meeting_recording_finished"
      | "meeting_recording_uploaded"
      | "meeting_audio_started"
      | "meeting_audio_finished"
      | "meeting_transcribed"
      | "meeting_ai_summary_generated"
      | "meeting_ai_summary_created"
      | "meeting_tasks_created"
      | "meeting_recording_deleted";
    detail?: string;
  }
): Promise<void> {
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection(ACTIVITY)
    .add({
      actionType: input.action,
      actionLabel: input.action,
      entityType: "meeting_record",
      entityId: input.recordId,
      userId: input.userId,
      sourceModule: "meetingRecords",
      metadata: {
        recordId: input.recordId,
        detail: input.detail?.slice(0, 500) ?? null,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
}
