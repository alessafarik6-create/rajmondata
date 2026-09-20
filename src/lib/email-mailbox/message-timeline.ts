import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { EMAIL_SUBCOLLECTION_MESSAGE_TIMELINE } from "@/lib/email-mailbox/intelligence-types";

export async function appendEmailMessageTimeline(
  db: Firestore,
  companyId: string,
  messageId: string,
  event: {
    kind: string;
    label: string;
    userId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    await emailMessagesCol(db, companyId)
      .doc(messageId)
      .collection(EMAIL_SUBCOLLECTION_MESSAGE_TIMELINE)
      .add({
        organizationId: companyId,
        messageId,
        userId: event.userId ?? null,
        kind: event.kind,
        label: event.label,
        metadata: event.metadata ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch {
    /* timeline must not break flow */
  }
}
