import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export type BankAuditAction =
  | "BANK_CONNECTED"
  | "BANK_CONNECTION_UPDATED"
  | "BANK_SYNC_STARTED"
  | "BANK_SYNC_FINISHED"
  | "BANK_TRANSACTION_MATCHED"
  | "BANK_TRANSACTION_UNMATCHED"
  | "BANK_TRANSACTION_CATEGORIZED"
  | "BANK_TRANSACTION_NOTE_UPDATED"
  | "BANK_ACCESS_CHANGED";

export async function writeBankAuditLog(
  db: Firestore,
  input: {
    organizationId: string;
    userId: string;
    action: BankAuditAction;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const organizationId = String(input.organizationId ?? "").trim();
  if (!organizationId) return;
  const meta = { ...(input.metadata ?? {}) };
  delete meta.certificate;
  delete meta.password;
  delete meta.encryptedCertificate;
  delete meta.encryptedCertificatePassword;
  delete meta.clientSecret;

  await db.collection("companies").doc(organizationId).collection("activityLogs").add({
    organizationId,
    companyId: organizationId,
    userId: input.userId,
    createdBy: input.userId,
    actionType: input.action,
    actionLabel: input.action.replace(/_/g, " "),
    entityType: "bank",
    entityId: String(input.entityId ?? "").slice(0, 200) || null,
    sourceModule: "bank",
    route: "/portal/bank",
    metadata: meta,
    createdAt: FieldValue.serverTimestamp(),
  });
}
