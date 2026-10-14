import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export async function writeFleetAuditLog(
  db: Firestore,
  input: {
    organizationId: string;
    userId: string;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const organizationId = String(input.organizationId ?? "").trim();
  if (!organizationId) return;
  await db.collection("companies").doc(organizationId).collection("activityLogs").add({
    organizationId,
    companyId: organizationId,
    userId: input.userId,
    createdBy: input.userId,
    actionType: input.action,
    actionLabel: input.action.replace(/_/g, " "),
    entityType: input.entityType ?? "fleet",
    entityId: input.entityId ?? null,
    sourceModule: "fleet",
    route: "/portal/fleet",
    metadata: input.metadata ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}
