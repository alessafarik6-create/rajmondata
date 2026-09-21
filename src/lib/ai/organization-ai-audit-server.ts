import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function logOrganizationAiQuerySafe(
  db: Firestore,
  organizationId: string,
  payload: {
    userId: string;
    actionType: "ORG_AI_BRIEFING" | "ORG_AI_ASK" | "ORG_AI_HOT_TODAY";
    questionPreview?: string;
    moduleHint?: string;
  }
): Promise<void> {
  try {
    await db.collection(COMPANIES_COLLECTION).doc(organizationId).collection("activityLogs").add({
      organizationId,
      userId: payload.userId,
      actionType: payload.actionType,
      actionLabel: "Dotaz na firemní AI sekretářku",
      entityType: "ai_assistant",
      details: payload.questionPreview?.slice(0, 200) ?? null,
      sourceModule: "overview",
      metadata: payload.moduleHint ? { moduleHint: payload.moduleHint } : null,
      createdAt: new Date(),
    });
  } catch {
    /* audit must not break */
  }
}
