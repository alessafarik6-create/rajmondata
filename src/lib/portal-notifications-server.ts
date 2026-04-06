/**
 * Server: zápis do inboxu cílového uživatele + odeslání Web Push na uložené subscription.
 * Volá se z API rout (Firebase Admin), ne z klienta.
 */

import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";
import webpush from "web-push";
import { getAdminFirestore } from "@/lib/firebase-admin";
import type { PortalNotificationCategory } from "@/lib/portal-notifications-types";

let vapidConfigured = false;

function ensureWebPushVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_CONTACT_EMAIL?.trim() ||
    "mailto:notify@localhost";
  if (!publicKey || !privateKey) {
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch (e) {
    console.error("[portal-notifications] setVapidDetails failed", e);
    return false;
  }
}

export function pushSubscriptionStorageDocId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
}

export type EmitPortalNotificationInput = {
  targetUserId: string;
  companyId?: string | null;
  category: PortalNotificationCategory;
  title: string;
  body: string;
  linkUrl?: string | null;
  /** Např. název API routy */
  source?: string | null;
};

/**
 * Zapíše notifikaci a pokusí se poslat Web Push všem subscription daného uživatele.
 */
export async function emitPortalNotification(
  input: EmitPortalNotificationInput
): Promise<{ inboxId: string | null; pushAttempted: number; pushOk: number }> {
  const db = getAdminFirestore();
  if (!db) {
    console.warn("[portal-notifications] Admin Firestore missing — skip emit.");
    return { inboxId: null, pushAttempted: 0, pushOk: 0 };
  }

  const inboxRef = db
    .collection("users")
    .doc(input.targetUserId)
    .collection("notificationInbox")
    .doc();

  const payload: Record<string, unknown> = {
    companyId: input.companyId ?? null,
    category: input.category,
    title: input.title,
    body: input.body,
    linkUrl: input.linkUrl ?? null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    source: input.source ?? null,
  };

  await inboxRef.set(payload);

  const pushPayload = JSON.stringify({
    title: input.title,
    body: input.body,
    url: input.linkUrl || "/portal/notifications",
    tag: `portal-${inboxRef.id}`,
  });

  const canPush = ensureWebPushVapid();
  if (!canPush) {
    return { inboxId: inboxRef.id, pushAttempted: 0, pushOk: 0 };
  }

  const subsSnap = await db
    .collection("users")
    .doc(input.targetUserId)
    .collection("pushSubscriptions")
    .get();

  let pushOk = 0;
  let pushAttempted = 0;

  for (const doc of subsSnap.docs) {
    const data = doc.data() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const endpoint = data.endpoint;
    if (!endpoint || !data.keys?.p256dh || !data.keys?.auth) {
      await doc.ref.delete().catch(() => {});
      continue;
    }
    pushAttempted += 1;
    try {
      await webpush.sendNotification(
        {
          endpoint,
          keys: {
            p256dh: data.keys.p256dh,
            auth: data.keys.auth,
          },
        },
        pushPayload,
        { TTL: 86400 }
      );
      pushOk += 1;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await doc.ref.delete().catch(() => {});
      }
      console.warn("[portal-notifications] push failed", status, endpoint);
    }
  }

  return { inboxId: inboxRef.id, pushAttempted, pushOk };
}
