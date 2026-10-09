import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_PORTAL_ANALYTICS_DEDUP_COLLECTION,
  PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION,
  PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION,
} from "@/lib/firestore-collections";
import { deviceClassFromUa } from "@/lib/analytics/referrer-bucket";
import {
  isPortalAnalyticsEventName,
  sanitizePortalAnalyticsModuleId,
  type PortalAnalyticsEventName,
} from "@/lib/portal-analytics/event-types";
import { portalAnalyticsDedupeKey, portalAnalyticsUserHash } from "@/lib/portal-analytics/pseudonym";

export type RecordPortalAnalyticsInput = {
  organizationId: string;
  userId: string;
  event: PortalAnalyticsEventName;
  moduleId?: string;
  actionKey?: string;
  deviceClass?: string;
  userAgent?: string;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function minuteBucket(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 16)}`;
}

function mapKey(raw: string): string {
  return raw.replace(/\//g, "_").replace(/\./g, "_").slice(0, 80) || "_";
}

function incMap(map: Record<string, number> | undefined, key: string, by = 1) {
  const m = { ...(map ?? {}) };
  m[key] = (m[key] ?? 0) + by;
  return m;
}

export function normalizePortalAnalyticsCollectBody(body: unknown): RecordPortalAnalyticsInput | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const organizationId = String(o.organizationId ?? "").trim();
  const event = String(o.event ?? "").trim();
  if (!organizationId || !isPortalAnalyticsEventName(event)) return null;
  const moduleId = sanitizePortalAnalyticsModuleId(String(o.moduleId ?? o.module ?? ""));
  const actionKey = String(o.actionKey ?? o.action ?? "")
    .trim()
    .slice(0, 80);
  const deviceClass = String(o.deviceClass ?? "").trim().slice(0, 24);
  return {
    organizationId,
    /** Doplní server z ověřeného volajícího — klient nemusí posílat UID. */
    userId: "",
    event,
    moduleId,
    actionKey: actionKey || undefined,
    deviceClass: deviceClass || undefined,
    userAgent: typeof o.userAgent === "string" ? o.userAgent.slice(0, 200) : undefined,
  };
}

/**
 * Zapíše agregovanou událost (dedup + denní souhrny). Neukládá obsah formulářů ani PII.
 */
export async function recordPortalAnalyticsEvent(
  db: Firestore,
  input: RecordPortalAnalyticsInput
): Promise<{ recorded: boolean; duplicate?: boolean }> {
  const day = todayKey();
  const userHash = portalAnalyticsUserHash(input.userId, input.organizationId);
  if (!userHash) return { recorded: false };

  const moduleId = sanitizePortalAnalyticsModuleId(input.moduleId);
  const dev =
    input.deviceClass && ["desktop", "mobile", "tablet"].includes(input.deviceClass)
      ? input.deviceClass
      : deviceClassFromUa(input.userAgent ?? "");

  const dedupeId = portalAnalyticsDedupeKey({
    organizationId: input.organizationId,
    userHash,
    event: input.event,
    moduleId,
    actionKey: input.actionKey,
    minuteBucket: minuteBucket(),
  });

  const dedupeRef = db.collection(PLATFORM_PORTAL_ANALYTICS_DEDUP_COLLECTION).doc(dedupeId);
  const globalRef = db.collection(PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION).doc(day);
  const orgRef = db
    .collection(PLATFORM_PORTAL_ANALYTICS_ORG_DAILY_COLLECTION)
    .doc(`${day}_${input.organizationId}`);

  const expireAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const recorded = await db.runTransaction(async (tx) => {
    const dedupeSnap = await tx.get(dedupeRef);
    if (dedupeSnap.exists) return false;

    const [globalSnap, orgSnap] = await Promise.all([tx.get(globalRef), tx.get(orgRef)]);
    const g = (globalSnap.data() ?? {}) as Record<string, unknown>;
    const o = (orgSnap.data() ?? {}) as Record<string, unknown>;

    const events = incMap(g.events as Record<string, number>, input.event);
    const modules = incMap(g.modules as Record<string, number>, moduleId);
    const devices = incMap(g.devices as Record<string, number>, mapKey(dev));
    const workflows =
      input.event === "form_started" ||
      input.event === "form_completed" ||
      input.event === "form_abandoned"
        ? incMap(
            g.workflows as Record<string, number>,
            `${input.actionKey || moduleId}:${input.event}`
          )
        : (g.workflows as Record<string, number>) ?? {};

    let orgEvents = incMap(o.events as Record<string, number>, input.event);
    let orgModules = incMap(o.modules as Record<string, number>, moduleId);
    let orgDevices = incMap(o.devices as Record<string, number>, mapKey(dev));
    let orgWorkflows =
      input.event === "form_started" ||
      input.event === "form_completed" ||
      input.event === "form_abandoned"
        ? incMap(
            o.workflows as Record<string, number>,
            `${input.actionKey || moduleId}:${input.event}`
          )
        : (o.workflows as Record<string, number>) ?? {};

    const userHashes = { ...((o.userHashes as Record<string, boolean>) ?? {}) };
    userHashes[userHash] = true;

    tx.set(
      dedupeRef,
      { createdAt: FieldValue.serverTimestamp(), expireAt },
      { merge: true }
    );

    tx.set(
      globalRef,
      {
        date: day,
        events,
        modules,
        devices,
        workflows,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      orgRef,
      {
        date: day,
        organizationId: input.organizationId,
        events: orgEvents,
        modules: orgModules,
        devices: orgDevices,
        workflows: orgWorkflows,
        userHashes,
        lastEventAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return true;
  });

  return { recorded, duplicate: !recorded };
}
