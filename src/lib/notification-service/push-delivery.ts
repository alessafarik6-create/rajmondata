import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import webpush from "web-push";
import type { NotificationPriority } from "@/lib/notification-service/types";

export function pushSubscriptionStorageDocId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
}

export type PushSubscriptionDoc = {
  ref: FirebaseFirestore.DocumentReference;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceName?: string;
  platform?: string;
  organizationId?: string | null;
};

export function pushEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

/** Aktivní subscription — isActive/enabled nesmí být explicitně false; chybějící pole = aktivní (zpětná kompatibilita). */
export function isPushSubscriptionActive(data: Record<string, unknown>): boolean {
  if (data.isActive === false) return false;
  if (data.enabled === false) return false;
  const endpoint = typeof data.endpoint === "string" ? data.endpoint.trim() : "";
  const p256dh =
    typeof (data.keys as { p256dh?: string } | undefined)?.p256dh === "string"
      ? (data.keys as { p256dh: string }).p256dh
      : "";
  const auth =
    typeof (data.keys as { auth?: string } | undefined)?.auth === "string"
      ? (data.keys as { auth: string }).auth
      : "";
  return Boolean(endpoint && p256dh && auth);
}

/**
 * Načte všechny push subscription uživatele (bez Firestore where — nevynechá legacy záznamy).
 * Volitelně filtruje podle organizationId, pokud je na subscription uloženo.
 */
export async function loadActivePushSubscriptions(
  db: FirebaseFirestore.Firestore,
  recipientUserId: string,
  _organizationId?: string | null
): Promise<PushSubscriptionDoc[]> {
  const snap = await db
    .collection("users")
    .doc(recipientUserId)
    .collection("pushSubscriptions")
    .get();

  const out: PushSubscriptionDoc[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!isPushSubscriptionActive(data)) continue;
    const subOrg = String(data.organizationId ?? "").trim();
    const endpoint = String(data.endpoint).trim();
    out.push({
      ref: doc.ref,
      endpoint,
      keys: {
        p256dh: (data.keys as { p256dh: string }).p256dh,
        auth: (data.keys as { auth: string }).auth,
      },
      deviceName: typeof data.deviceName === "string" ? data.deviceName : undefined,
      platform: typeof data.platform === "string" ? data.platform : undefined,
      organizationId: subOrg || null,
    });
  }

  return out;
}

export type SendPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  priority: NotificationPriority;
  eventType: string;
};

export type SendPushBatchResult = {
  pushAttempted: number;
  pushOk: number;
};

export async function sendPushToSubscriptions(params: {
  db: FirebaseFirestore.Firestore;
  recipientUserId: string;
  organizationId?: string | null;
  payload: SendPushPayload;
  /** Odeslat jen na tento endpoint (test aktuálního zařízení). */
  onlyEndpoint?: string | null;
}): Promise<SendPushBatchResult> {
  const { db, recipientUserId, organizationId, payload } = params;
  const onlyEndpoint = params.onlyEndpoint?.trim() || null;

  console.log("[PUSH] send start", {
    userId: recipientUserId,
    organizationId: organizationId ?? null,
    onlyEndpoint: onlyEndpoint ? pushEndpointHost(onlyEndpoint) : null,
  });

  let subs = await loadActivePushSubscriptions(db, recipientUserId, organizationId);
  if (onlyEndpoint) {
    subs = subs.filter((s) => s.endpoint === onlyEndpoint);
  }

  console.log("[PUSH] subscriptions count", subs.length);
  for (const s of subs) {
    console.log("[PUSH] endpoint host", pushEndpointHost(s.endpoint));
  }

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    priority: payload.priority,
    eventType: payload.eventType,
  });

  const ttlOpts = {
    TTL: payload.priority === "URGENT" ? 3600 : 86400,
    urgency: payload.priority === "URGENT" ? ("high" as const) : ("normal" as const),
  };

  const pushAttempted = subs.length;
  let pushOk = 0;

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          pushPayload,
          ttlOpts
        );
        console.log("[PUSH] send success", {
          userId: recipientUserId,
          endpointHost: pushEndpointHost(sub.endpoint),
        });
        await sub.ref.update({
          isActive: true,
          enabled: true,
          lastUsedAt: FieldValue.serverTimestamp(),
          failedCount: 0,
          lastPushError: null,
        });
        return true;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        console.warn("[PUSH] send failed", {
          userId: recipientUserId,
          statusCode: status ?? null,
          endpointHost: pushEndpointHost(sub.endpoint),
        });
        const snap = await sub.ref.get();
        const data = snap.data() as { failedCount?: number } | undefined;
        const failedCount = Number(data?.failedCount ?? 0) + 1;
        if (status === 404 || status === 410) {
          await sub.ref
            .update({
              isActive: false,
              deactivatedAt: FieldValue.serverTimestamp(),
              lastPushError: `HTTP ${status}`,
            })
            .catch(() => sub.ref.delete());
        } else if (failedCount >= 5) {
          await sub.ref.update({
            isActive: false,
            failedCount,
            lastPushError: String((err as Error)?.message ?? status ?? "push_failed").slice(0, 500),
          });
        } else {
          await sub.ref.update({
            failedCount,
            lastPushError: String((err as Error)?.message ?? status ?? "push_failed").slice(0, 500),
          });
        }
        throw err;
      }
    })
  );

  pushOk = results.filter((r) => r.status === "fulfilled").length;

  return { pushAttempted, pushOk };
}
