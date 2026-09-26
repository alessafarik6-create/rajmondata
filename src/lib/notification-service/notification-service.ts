/**
 * Jednotný NotificationService: in-app inbox + Web Push (+ budoucí e-mail z preferences).
 */

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import webpush from "web-push";
import { getAdminFirestore } from "@/lib/firebase-admin";
import {
  pushSubscriptionStorageDocId,
  sendPushToSubscriptions,
} from "@/lib/notification-service/push-delivery";
import type { PortalNotificationCategory } from "@/lib/portal-notifications-types";
import {
  mergeNotificationPreferences,
  shouldSendPushForNotification,
} from "@/lib/notification-service/preferences";
import type { CreateNotificationInput, NotificationPriority } from "@/lib/notification-service/types";
import { resolveCreateNotificationTarget } from "@/lib/notification-target";

let vapidConfigured = false;

export function getVapidPublicKey(): string | null {
  return (
    process.env.VAPID_PUBLIC_KEY?.trim() ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
    null
  );
}

export function ensureWebPushVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = getVapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    process.env.VAPID_CONTACT_EMAIL?.trim() ||
    "mailto:notify@rajmondata.cz";
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch (e) {
    console.error("[notification-service] setVapidDetails failed", e);
    return false;
  }
}

export { pushSubscriptionStorageDocId };

function defaultCategory(type: CreateNotificationInput["type"]): PortalNotificationCategory {
  if (type.startsWith("JOB") || type === "DOCUMENT_APPROVED") return "job";
  if (type.startsWith("EMAIL")) return "message";
  if (type === "INQUIRY_CREATED") return "activity";
  if (type === "INVOICE_OVERDUE") return "document";
  if (type === "MEETING_REMINDER") return "activity";
  if (type === "ATTENDANCE_REMINDER") return "system";
  return "system";
}

function buildDedupDocId(input: CreateNotificationInput): string {
  if (input.eventId?.trim()) {
    return createHash("sha256")
      .update(`${input.recipientUserId}:${input.eventId.trim()}`)
      .digest("hex")
      .slice(0, 40);
  }
  return createHash("sha256")
    .update(
      `${input.recipientUserId}:${input.type}:${input.organizationId}:${input.entityId ?? ""}:${input.title}`
    )
    .digest("hex")
    .slice(0, 40);
}

async function claimDedup(
  db: FirebaseFirestore.Firestore,
  recipientUserId: string,
  dedupId: string
): Promise<boolean> {
  const ref = db
    .collection("users")
    .doc(recipientUserId)
    .collection("notificationDedup")
    .doc(dedupId);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const created = snap.data()?.createdAt as { toMillis?: () => number } | undefined;
    const ms = typeof created?.toMillis === "function" ? created.toMillis() : 0;
    if (ms && now - ms < 120_000) return false;
  }
  await ref.set({ createdAt: FieldValue.serverTimestamp(), dedupId }, { merge: true });
  return true;
}

async function loadUserPreferences(
  db: FirebaseFirestore.Firestore,
  recipientUserId: string
): Promise<ReturnType<typeof mergeNotificationPreferences>> {
  const snap = await db.collection("users").doc(recipientUserId).get();
  const raw = snap.data()?.notificationPreferences as Record<string, unknown> | undefined;
  return mergeNotificationPreferences(raw);
}

export type CreateNotificationResult = {
  inboxId: string | null;
  skippedDuplicate: boolean;
  pushAttempted: number;
  pushOk: number;
};

export async function createNotification(
  input: CreateNotificationInput
): Promise<CreateNotificationResult> {
  const db = getAdminFirestore();
  if (!db) {
    console.warn("[notification-service] Admin Firestore missing");
    return { inboxId: null, skippedDuplicate: false, pushAttempted: 0, pushOk: 0 };
  }

  const dedupId = buildDedupDocId(input);
  const okDedup = await claimDedup(db, input.recipientUserId, dedupId);
  if (!okDedup) {
    return { inboxId: null, skippedDuplicate: true, pushAttempted: 0, pushOk: 0 };
  }

  const prefs = await loadUserPreferences(db, input.recipientUserId);
  const category = input.category ?? defaultCategory(input.type);
  const priority: NotificationPriority = input.priority ?? "NORMAL";
  const targetResolved = resolveCreateNotificationTarget(input);
  const linkUrl = targetResolved.url || "/portal/notifications";

  const inboxRef = db
    .collection("users")
    .doc(input.recipientUserId)
    .collection("notificationInbox")
    .doc();

  await inboxRef.set({
    companyId: input.organizationId,
    category,
    type: input.type,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    priority,
    title: input.title,
    body: input.body,
    linkUrl,
    targetType: targetResolved.targetType,
    targetId: targetResolved.targetId,
    targetUrl: targetResolved.targetUrl,
    jobId: targetResolved.jobId ?? null,
    messageId: targetResolved.messageId ?? null,
    commentId: input.commentId ?? input.messageId ?? null,
    conversationId: targetResolved.conversationId ?? input.conversationId ?? null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    source: input.source ?? null,
    eventId: input.eventId ?? dedupId,
  });

  let pushAttempted = 0;
  let pushOk = 0;

  if (input.skipPush) {
    return { inboxId: inboxRef.id, skippedDuplicate: false, pushAttempted: 0, pushOk: 0 };
  }

  const allowPush = input.forcePush || shouldSendPushForNotification(prefs, input);
  if (!allowPush) {
    console.log("[PUSH] skipped preferences", {
      userId: input.recipientUserId,
      organizationId: input.organizationId,
      type: input.type,
    });
    return { inboxId: inboxRef.id, skippedDuplicate: false, pushAttempted: 0, pushOk: 0 };
  }

  const canPush = ensureWebPushVapid();
  if (!canPush) {
    console.warn("[PUSH] skipped VAPID not configured", { userId: input.recipientUserId });
    return { inboxId: inboxRef.id, skippedDuplicate: false, pushAttempted: 0, pushOk: 0 };
  }

  const batch = await sendPushToSubscriptions({
    db,
    recipientUserId: input.recipientUserId,
    organizationId: input.organizationId,
    payload: {
      title: input.title,
      body: input.body,
      url: linkUrl,
      tag: input.eventId ? `evt-${dedupId}` : `inbox-${inboxRef.id}`,
      priority,
      eventType: input.type,
    },
  });
  pushAttempted = batch.pushAttempted;
  pushOk = batch.pushOk;

  return { inboxId: inboxRef.id, skippedDuplicate: false, pushAttempted, pushOk };
}

/** Centrální vstup — in-app + push (+ deduplikace). */
export const notify = createNotification;

/** Zpětná kompatibilita se starým API. */
export async function emitPortalNotification(input: {
  targetUserId: string;
  companyId?: string | null;
  category: PortalNotificationCategory;
  title: string;
  body: string;
  linkUrl?: string | null;
  source?: string | null;
  type?: CreateNotificationInput["type"];
  eventId?: string | null;
  priority?: NotificationPriority;
  entityType?: CreateNotificationInput["entityType"];
  entityId?: string | null;
  jobId?: string | null;
  commentId?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
  inquiryId?: string | null;
  calendarEventId?: string | null;
}): Promise<{ inboxId: string | null; pushAttempted: number; pushOk: number }> {
  const r = await createNotification({
    organizationId: input.companyId ?? "",
    recipientUserId: input.targetUserId,
    type: input.type ?? "SYSTEM_ALERT",
    title: input.title,
    body: input.body,
    url: input.linkUrl,
    category: input.category,
    source: input.source,
    eventId: input.eventId,
    priority: input.priority,
    entityType: input.entityType,
    entityId: input.entityId,
    jobId: input.jobId,
    commentId: input.commentId,
    messageId: input.messageId,
    conversationId: input.conversationId,
    inquiryId: input.inquiryId,
    calendarEventId: input.calendarEventId,
  });
  return { inboxId: r.inboxId, pushAttempted: r.pushAttempted, pushOk: r.pushOk };
}
