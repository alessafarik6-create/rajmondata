import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function logSecretaryAudit(
  db: Firestore,
  input: {
    companyId: string;
    userId: string;
    action:
      | "ai_voice_session_started"
      | "ai_voice_session_finished"
      | "ai_action_proposed"
      | "ai_action_confirmed"
      | "ai_action_executed"
      | "ai_action_failed";
    detail?: string;
    toolName?: string;
  }
): Promise<void> {
  await db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("activityLogs")
    .add({
      actionType: input.action,
      actionLabel: input.action,
      entityType: "ai_secretary",
      userId: input.userId,
      sourceModule: "ai",
      metadata: {
        toolName: input.toolName ?? null,
        detail: input.detail?.slice(0, 500) ?? null,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
}
