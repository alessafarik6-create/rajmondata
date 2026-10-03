import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export type SatelitniFleetAuditAction =
  | "GPS_CONNECTED"
  | "GPS_DISCONNECTED"
  | "GPS_SYNC_STARTED"
  | "GPS_SYNC_FINISHED"
  | "GPS_SYNC_ERROR"
  | "GPS_TRIP_UPDATED";

export async function writeSatelitniFleetAudit(
  db: Firestore,
  input: {
    organizationId: string;
    userId: string;
    action: SatelitniFleetAuditAction;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const meta = { ...(input.metadata ?? {}) };
  delete meta.accessToken;
  delete meta.refreshToken;
  delete meta.codeVerifier;

  await db.collection("companies").doc(input.organizationId).collection("activityLogs").add({
    organizationId: input.organizationId,
    companyId: input.organizationId,
    userId: input.userId,
    createdBy: input.userId,
    actionType: input.action,
    actionLabel: input.action.replace(/_/g, " "),
    entityType: "fleet",
    sourceModule: "fleet",
    route: "/portal/fleet",
    metadata: meta,
    createdAt: FieldValue.serverTimestamp(),
  });
}
