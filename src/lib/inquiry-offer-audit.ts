import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function logInquiryOfferSentAudit(
  db: Firestore,
  input: {
    companyId: string;
    userId: string;
    offerId: string;
    leadId?: string | null;
    customerId?: string | null;
    recipientEmail: string;
    sentByName?: string | null;
    sentByEmail?: string | null;
    auditCopyEnabled: boolean;
    auditCopyCount: number;
  }
): Promise<void> {
  try {
    await db.collection(COMPANIES_COLLECTION).doc(input.companyId).collection("activityLogs").add({
      type: "offer_sent",
      action: "offer_sent",
      userId: input.userId,
      offerId: input.offerId,
      leadId: input.leadId ?? null,
      customerId: input.customerId ?? null,
      recipientEmail: input.recipientEmail,
      sentByUserId: input.userId,
      sentByName: input.sentByName ?? null,
      sentByEmail: input.sentByEmail ?? null,
      auditCopyEnabled: input.auditCopyEnabled,
      auditCopyCount: input.auditCopyCount,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[inquiry-offer-audit] log failed", err);
  }
}
