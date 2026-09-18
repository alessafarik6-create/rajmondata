import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function logEmailMailboxAudit(
  db: Firestore,
  companyId: string,
  payload: {
    actionType: string;
    actionLabel: string;
    userId: string;
    entityId?: string | null;
    details?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await db.collection(COMPANIES_COLLECTION).doc(companyId).collection("activityLogs").add({
      organizationId: companyId,
      companyId,
      userId: payload.userId,
      actionType: payload.actionType,
      actionLabel: payload.actionLabel,
      entityType: "email_mailbox",
      entityId: payload.entityId ?? null,
      details: payload.details ?? null,
      sourceModule: "emails",
      metadata: payload.metadata ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit must not break primary flow */
  }
}
