import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export const PLATFORM_LICENSE_AUDIT_COLLECTION = "platform_license_audit";

export type PlatformLicenseAuditAction =
  | "trial_started_registration"
  | "trial_extended"
  | "trial_end_changed"
  | "trial_ended"
  | "trial_converted_paid"
  | "subscription_status_changed";

export async function logPlatformLicenseAudit(
  db: Firestore,
  entry: {
    companyId: string;
    action: PlatformLicenseAuditAction;
    actor: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    note?: string;
  }
): Promise<void> {
  try {
    await db.collection(PLATFORM_LICENSE_AUDIT_COLLECTION).add({
      companyId: entry.companyId,
      action: entry.action,
      actor: entry.actor,
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? "",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("[platform_license_audit]", (e as Error)?.message ?? e);
  }
}
