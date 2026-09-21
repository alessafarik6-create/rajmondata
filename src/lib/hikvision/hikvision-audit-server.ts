import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function logHikvisionAuditSafe(
  db: Firestore,
  organizationId: string,
  payload: {
    userId: string;
    actionType: string;
    actionLabel: string;
    entityType?: string;
    entityId?: string;
    entityName?: string;
    details?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const meta = { ...(payload.metadata ?? {}) };
    for (const key of Object.keys(meta)) {
      const k = key.toLowerCase();
      if (
        k.includes("secret") ||
        k.includes("password") ||
        k.includes("token") ||
        k.includes("url") ||
        k === "accesstoken"
      ) {
        delete meta[key];
      }
    }
    await db.collection(COMPANIES_COLLECTION).doc(organizationId).collection("activityLogs").add({
      organizationId,
      userId: payload.userId,
      actionType: payload.actionType,
      actionLabel: payload.actionLabel,
      entityType: payload.entityType ?? "hikvision",
      entityId: payload.entityId ?? null,
      entityName: payload.entityName ?? null,
      details: payload.details?.slice(0, 4000) ?? null,
      sourceModule: "cameras",
      metadata: Object.keys(meta).length ? meta : null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("[hikvision audit]", (e as Error)?.message ?? e);
  }
}
