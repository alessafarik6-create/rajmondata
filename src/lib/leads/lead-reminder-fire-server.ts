import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createNotification } from "@/lib/notification-service/notification-service";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import { formatRemindTimePrague } from "@/lib/leads/lead-reminder-datetime";
import { leadReminderOpenUrl } from "@/lib/leads/lead-reminder-types";

export type FireLeadReminderResult = {
  fired: boolean;
  skippedDuplicate: boolean;
  reminderId: string;
};

function reminderEventId(companyId: string, reminderId: string): string {
  return `lead_reminder:${companyId}:${reminderId}`;
}

type ClaimPayload = {
  assignedUserId: string;
  customerName: string;
  inquiryTitle: string;
  note: string;
  leadKey: string;
  timeLabel: string;
};

export async function fireLeadReminderIfDue(
  db: Firestore,
  companyId: string,
  reminderId: string,
  opts?: { graceMs?: number }
): Promise<FireLeadReminderResult> {
  const graceMs = opts?.graceMs ?? 120_000;
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(LEAD_REMINDERS_SUBCOLLECTION)
    .doc(reminderId);

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const status = String(data.status ?? "");
    if (status !== "active") return null;
    if (data.notificationFired === true) return { alreadyFired: true as const };
    const remindAt = data.remindAt as Timestamp | undefined;
    const dueMs = remindAt?.toDate?.()?.getTime?.() ?? NaN;
    if (!Number.isFinite(dueMs) || dueMs > Date.now() + graceMs) return null;

    const assignedUserId = String(data.assignedUserId ?? "").trim();
    if (!assignedUserId) return null;

    tx.update(ref, {
      notificationFired: true,
      firedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const payload: ClaimPayload = {
      assignedUserId,
      customerName: String(data.customerName ?? "Zákazník").trim(),
      inquiryTitle: String(data.inquiryTitle ?? "Poptávka").trim(),
      note: String(data.note ?? "").trim(),
      leadKey: String(data.leadKey ?? "").trim(),
      timeLabel: remindAt ? formatRemindTimePrague(remindAt.toDate()) : "—",
    };
    return { alreadyFired: false as const, payload };
  });

  if (!claim) {
    return { fired: false, skippedDuplicate: false, reminderId };
  }
  if ("alreadyFired" in claim && claim.alreadyFired) {
    return { fired: false, skippedDuplicate: true, reminderId };
  }
  if (!("payload" in claim) || !claim.payload) {
    return { fired: false, skippedDuplicate: false, reminderId };
  }

  const p = claim.payload;
  const bodyLines = [
    `Zákazník: ${p.customerName}`,
    `Poptávka: ${p.inquiryTitle}`,
    `Čas: ${p.timeLabel}`,
    p.note ? `Poznámka: ${p.note}` : "",
  ].filter(Boolean);

  const notifyResult = await createNotification({
    recipientUserId: p.assignedUserId,
    organizationId: companyId,
    type: "LEAD_REMINDER",
    entityType: "inquiry",
    entityId: p.leadKey || reminderId,
    inquiryId: p.leadKey || null,
    title: "⏰ Připomínka – zavolat zákazníkovi",
    body: bodyLines.join("\n"),
    url: p.leadKey ? leadReminderOpenUrl(p.leadKey) : "/portal/notifications?reminders=1",
    eventId: reminderEventId(companyId, reminderId),
    priority: "HIGH",
    category: "activity",
  });

  return {
    fired: true,
    skippedDuplicate: notifyResult.skippedDuplicate,
    reminderId,
  };
}

export async function processDueLeadRemindersGlobal(
  db: Firestore,
  limit = 40
): Promise<{ processed: number; fired: number; errors: string[] }> {
  const now = Timestamp.now();
  const errors: string[] = [];
  let processed = 0;
  let fired = 0;

  const qs = await db
    .collectionGroup(LEAD_REMINDERS_SUBCOLLECTION)
    .where("status", "==", "active")
    .where("notificationFired", "==", false)
    .where("remindAt", "<=", now)
    .orderBy("remindAt", "asc")
    .limit(limit)
    .get();

  for (const docSnap of qs.docs) {
    processed++;
    const path = docSnap.ref.path.split("/");
    const companyIdx = path.indexOf(COMPANIES_COLLECTION);
    const companyId = companyIdx >= 0 ? path[companyIdx + 1] : "";
    if (!companyId) continue;
    try {
      const r = await fireLeadReminderIfDue(db, companyId, docSnap.id);
      if (r.fired) fired++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { processed, fired, errors };
}
