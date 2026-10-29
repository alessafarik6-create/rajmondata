import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { createNotification } from "@/lib/notification-service/notification-service";
import {
  buildDirectConversationId,
  directMessageParticipantIds,
} from "@/lib/company-chat-types";

export async function respondToJobAssignmentInvite(input: {
  db: Firestore;
  companyId: string;
  callerUid: string;
  callerName: string;
  messageId: string;
  action: "accept" | "decline";
  declineReason?: string | null;
}): Promise<{ ok: true; status: "accepted" | "declined" } | { ok: false; error: string }> {
  const msgRef = input.db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("chat")
    .doc(input.messageId);
  const msgSnap = await msgRef.get();
  if (!msgSnap.exists) {
    return { ok: false, error: "Zpráva nenalezena." };
  }
  const msg = msgSnap.data() as Record<string, unknown>;
  const targetUid = String(msg.jobAssignmentTargetUserId ?? msg.recipientUserId ?? "").trim();
  if (!targetUid || targetUid !== input.callerUid) {
    return { ok: false, error: "Tuto zakázku může potvrdit pouze adresát zprávy." };
  }

  const jobId = String(msg.linkedJobId ?? "").trim();
  if (!jobId) {
    return { ok: false, error: "Chybí odkaz na zakázku." };
  }

  const currentStatus = String(msg.jobAssignmentStatus ?? "pending");
  if (currentStatus === "accepted" || currentStatus === "declined") {
    return {
      ok: true,
      status: currentStatus as "accepted" | "declined",
    };
  }

  if (input.action === "decline") {
    const reason = String(input.declineReason ?? "").trim();
    if (reason.length < 3) {
      return { ok: false, error: "Uveďte důvod odmítnutí (alespoň 3 znaky)." };
    }
  }

  const employeeDocId = String(msg.jobAssignmentEmployeeId ?? "").trim();
  const empSnap = employeeDocId
    ? await input.db
        .collection(COMPANIES_COLLECTION)
        .doc(input.companyId)
        .collection("employees")
        .doc(employeeDocId)
        .get()
    : null;
  if (empSnap && !empSnap.exists) {
    return { ok: false, error: "Zaměstnanec nepatří do organizace." };
  }
  if (empSnap?.exists) {
    const empCompany = String((empSnap.data() as { companyId?: string }).companyId ?? "").trim();
    if (empCompany && empCompany !== input.companyId) {
      return { ok: false, error: "Zaměstnanec nepatří do organizace." };
    }
  }

  const jobRef = input.db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("jobs")
    .doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    return { ok: false, error: "Zakázka nenalezena." };
  }

  const respondedAt = new Date().toISOString();
  const status = input.action === "accept" ? "accepted" : "declined";

  await msgRef.update({
    jobAssignmentStatus: status,
    jobAssignmentDeclineReason:
      input.action === "decline" ? String(input.declineReason ?? "").trim() : null,
    jobAssignmentRespondedAt: respondedAt,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const responseKey = employeeDocId || input.callerUid;
  await jobRef.update({
    [`employeeAssignmentResponses.${responseKey}`]: {
      employeeId: employeeDocId || null,
      authUserId: input.callerUid,
      status,
      respondedAt,
      declineReason: input.action === "decline" ? String(input.declineReason ?? "").trim() : null,
      chatMessageId: input.messageId,
      invitedByUid: String(msg.senderUserId ?? msg.senderId ?? "").trim() || null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (input.action === "decline") {
    const adminUid = String(msg.senderUserId ?? msg.senderId ?? "").trim();
    const jobName = String(msg.linkedJobName ?? jobSnap.data()?.name ?? jobId).trim();
    if (adminUid && adminUid !== input.callerUid) {
      const conversationId = buildDirectConversationId(adminUid, input.callerUid);
      const participantIds = directMessageParticipantIds(adminUid, input.callerUid);
      if (conversationId) {
        await input.db.collection(COMPANIES_COLLECTION).doc(input.companyId).collection("chat").add({
          companyId: input.companyId,
          organizationId: input.companyId,
          senderId: input.callerUid,
          senderUserId: input.callerUid,
          senderRole: "employee",
          senderName: input.callerName,
          text: `Nemohu převzít zakázku „${jobName}“.\nDůvod: ${String(input.declineReason ?? "").trim()}`,
          read: false,
          conversationId,
          participantIds,
          recipientUserId: adminUid,
          linkedJobId: jobId,
          linkedJobName: jobName,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: Date.now(),
        });
      }
      await createNotification({
        recipientUserId: adminUid,
        organizationId: input.companyId,
        type: "JOB_ASSIGNED",
        title: "Zaměstnanec odmítl zakázku",
        body: `${input.callerName}: ${jobName}`,
        url: `/portal/jobs/${encodeURIComponent(jobId)}`,
        entityType: "job",
        entityId: jobId,
        category: "job",
        eventId: `decline:${input.messageId}:${input.callerUid}`,
        source: "chat_ai_bulk",
      });
    }
  }

  return { ok: true, status };
}
