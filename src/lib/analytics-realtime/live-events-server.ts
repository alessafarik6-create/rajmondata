import type { Firestore, Query } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { PLATFORM_PORTAL_LIVE_EVENTS_COLLECTION } from "@/lib/firestore-collections";
import { liveEventLabelCs, moduleLabelCs } from "@/lib/analytics-realtime/module-labels-cs";
import type { PortalAnalyticsEventName } from "@/lib/portal-analytics/event-types";
import { loadPortalAnalyticsSettings } from "@/lib/portal-analytics/settings";

export type AppendLiveEventInput = {
  organizationId: string;
  organizationName?: string | null;
  userId: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  event: PortalAnalyticsEventName | string;
  moduleId?: string | null;
  actionKey?: string | null;
  actionLabel?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
  route?: string | null;
  result?: string | null;
  sessionId?: string | null;
};

export async function appendPortalLiveEvent(
  db: Firestore,
  input: AppendLiveEventInput
): Promise<void> {
  const settings = await loadPortalAnalyticsSettings(db);
  const retentionDays = settings.retentionDays;
  const expireAt = Timestamp.fromDate(
    new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
  );

  const labelCs = liveEventLabelCs({
    event: input.event,
    moduleId: input.moduleId,
    actionKey: input.actionKey,
    actionLabel: input.actionLabel,
  });

  await db.collection(PLATFORM_PORTAL_LIVE_EVENTS_COLLECTION).add({
    organizationId: String(input.organizationId).trim(),
    organizationName: input.organizationName?.trim()?.slice(0, 200) ?? null,
    userId: String(input.userId).trim(),
    userDisplayName: input.userDisplayName?.trim()?.slice(0, 200) ?? null,
    userEmail: input.userEmail?.trim()?.slice(0, 200) ?? null,
    event: String(input.event).slice(0, 80),
    moduleId: input.moduleId?.slice(0, 64) ?? null,
    moduleLabelCs: moduleLabelCs(input.moduleId),
    actionKey: input.actionKey?.slice(0, 80) ?? null,
    actionLabelCs: labelCs,
    entityType: input.entityType?.slice(0, 80) ?? null,
    entityId: input.entityId?.slice(0, 120) ?? null,
    entityName: input.entityName?.slice(0, 300) ?? null,
    route: input.route?.slice(0, 500) ?? null,
    result: input.result?.slice(0, 80) ?? null,
    sessionId: input.sessionId?.slice(0, 120) ?? null,
    createdAt: FieldValue.serverTimestamp(),
    expireAt,
  });
}

export type LiveEventRow = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  userId: string;
  userDisplayName: string | null;
  event: string;
  actionLabelCs: string;
  moduleLabelCs: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  createdAt: string | null;
};

function serializeLiveDoc(id: string, d: Record<string, unknown>): LiveEventRow {
  const ts = d.createdAt as Timestamp | undefined;
  return {
    id,
    organizationId: String(d.organizationId ?? ""),
    organizationName: typeof d.organizationName === "string" ? d.organizationName : null,
    userId: String(d.userId ?? ""),
    userDisplayName: typeof d.userDisplayName === "string" ? d.userDisplayName : null,
    event: String(d.event ?? ""),
    actionLabelCs: String(d.actionLabelCs ?? ""),
    moduleLabelCs: String(d.moduleLabelCs ?? ""),
    entityType: typeof d.entityType === "string" ? d.entityType : null,
    entityId: typeof d.entityId === "string" ? d.entityId : null,
    entityName: typeof d.entityName === "string" ? d.entityName : null,
    createdAt: ts?.toDate?.()?.toISOString?.() ?? null,
  };
}

export async function queryPortalLiveEvents(
  db: Firestore,
  opts: {
    limit: number;
    organizationId?: string;
    userId?: string;
    event?: string;
    from?: Date;
    to?: Date;
    cursorCreatedAt?: Date;
  }
): Promise<LiveEventRow[]> {
  let q: Query = db
    .collection(PLATFORM_PORTAL_LIVE_EVENTS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(Math.min(200, Math.max(1, opts.limit)));

  if (opts.organizationId) {
    q = db
      .collection(PLATFORM_PORTAL_LIVE_EVENTS_COLLECTION)
      .where("organizationId", "==", opts.organizationId)
      .orderBy("createdAt", "desc")
      .limit(Math.min(200, Math.max(1, opts.limit)));
  }

  const snap = await q.get();
  let rows = snap.docs.map((doc) => serializeLiveDoc(doc.id, doc.data() as Record<string, unknown>));

  if (opts.userId) rows = rows.filter((r) => r.userId === opts.userId);
  if (opts.event) rows = rows.filter((r) => r.event === opts.event);
  if (opts.from) {
    const f = opts.from.getTime();
    rows = rows.filter((r) => r.createdAt && Date.parse(r.createdAt) >= f);
  }
  if (opts.to) {
    const t = opts.to.getTime();
    rows = rows.filter((r) => r.createdAt && Date.parse(r.createdAt) <= t);
  }
  if (opts.cursorCreatedAt) {
    const c = opts.cursorCreatedAt.getTime();
    rows = rows.filter((r) => r.createdAt && Date.parse(r.createdAt) < c);
  }

  return rows.slice(0, opts.limit);
}
