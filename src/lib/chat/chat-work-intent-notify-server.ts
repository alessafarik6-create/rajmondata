import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { createNotification } from "@/lib/notification-service/notification-service";
import { buildDirectConversationId, directMessageParticipantIds } from "@/lib/company-chat-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { buildJobAssignmentMessageText } from "@/lib/chat/chat-work-intent-notify-message";

export { buildJobAssignmentMessageText };

export async function sendJobAssignmentChatAndNotification(params: {
  db: Firestore;
  companyId: string;
  adminUid: string;
  adminName: string;
  employeeAuthUserId: string;
  jobId: string;
  jobName: string;
  messageText: string;
  eventKey: string;
}): Promise<void> {
  const recipient = String(params.employeeAuthUserId ?? "").trim();
  if (!recipient || recipient === params.adminUid) return;

  const conversationId = buildDirectConversationId(params.adminUid, recipient);
  const participantIds = directMessageParticipantIds(params.adminUid, recipient);
  if (!conversationId) return;

  const chatRef = params.db.collection(COMPANIES_COLLECTION).doc(params.companyId).collection("chat");
  await chatRef.add({
    companyId: params.companyId,
    organizationId: params.companyId,
    senderId: params.adminUid,
    senderUserId: params.adminUid,
    senderRole: "admin",
    senderName: params.adminName,
    senderPhotoURL: "",
    text: params.messageText,
    read: false,
    conversationId,
    participantIds,
    recipientUserId: recipient,
    linkedJobId: params.jobId,
    linkedJobName: params.jobName,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  });

  const userSnap = await params.db.collection("users").doc(recipient).get();
  const role = String(userSnap.data()?.role ?? "").trim();
  const jobUrl =
    role === "employee"
      ? `/portal/employee/jobs/${encodeURIComponent(params.jobId)}`
      : `/portal/jobs/${encodeURIComponent(params.jobId)}`;

  await createNotification({
    recipientUserId: recipient,
    organizationId: params.companyId,
    type: "JOB_ASSIGNED",
    title: "Nová přiřazená zakázka",
    body: params.jobName,
    url: jobUrl,
    entityType: "job",
    entityId: params.jobId,
    category: "job",
    eventId: params.eventKey,
    source: "chat_ai_bulk",
  });
}
