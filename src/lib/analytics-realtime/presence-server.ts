import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION, PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION } from "@/lib/firestore-collections";
import {
  formatRelativeCs,
  PRESENCE_SESSION_STALE_MS,
  resolvePresenceState,
  timestampToMs,
  type PresenceState,
} from "@/lib/analytics-realtime/presence-eval";
import { moduleLabelCs } from "@/lib/analytics-realtime/module-labels-cs";
import { mapPathToAnalyticsModule } from "@/lib/portal-analytics/event-types";

export type StaffSessionPresenceRow = {
  sessionId: string;
  organizationId: string;
  userId: string;
  employeeId: string | null;
  employeeName: string;
  employeeEmail: string | null;
  loginAt: string | null;
  lastSeenAt: string | null;
  lastInteractionAt: string | null;
  lastRoute: string | null;
  moduleId: string;
  moduleLabelCs: string;
  deviceType: string | null;
  isActive: boolean;
  presence: PresenceState;
  lastActivityRelativeCs: string;
};

export type UserPresenceAggregate = {
  userId: string;
  employeeName: string;
  employeeEmail: string | null;
  presence: PresenceState;
  sessions: StaffSessionPresenceRow[];
  lastSeenAt: string | null;
  lastInteractionAt: string | null;
  moduleLabelCs: string;
  loginAt: string | null;
  lastActivityRelativeCs: string;
};

function isoFromMs(ms: number | null): string | null {
  return ms != null ? new Date(ms).toISOString() : null;
}

export async function loadActiveStaffSessionsForOrg(
  db: Firestore,
  organizationId: string,
  nowMs = Date.now()
): Promise<StaffSessionPresenceRow[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection("staffSessions")
    .where("isActive", "==", true)
    .limit(80)
    .get();

  const rows: StaffSessionPresenceRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const lastSeenMs = timestampToMs(d.lastSeenAt);
    const lastIntMs = timestampToMs(d.lastInteractionAt) ?? lastSeenMs;
    const loginMs = timestampToMs(d.loginAt);
    const presence = resolvePresenceState(lastSeenMs, lastIntMs, nowMs);
    if (presence === "offline" && lastSeenMs && nowMs - lastSeenMs > PRESENCE_SESSION_STALE_MS) {
      continue;
    }
    const route = typeof d.lastRoute === "string" ? d.lastRoute : "";
    const moduleId = mapPathToAnalyticsModule(route || "/portal/dashboard");
    const latestMs = Math.max(lastIntMs ?? 0, lastSeenMs ?? 0);
    rows.push({
      sessionId: doc.id,
      organizationId,
      userId: String(d.userId ?? ""),
      employeeId: typeof d.employeeId === "string" ? d.employeeId : null,
      employeeName: String(d.employeeName ?? "Uživatel"),
      employeeEmail: typeof d.employeeEmail === "string" ? d.employeeEmail : null,
      loginAt: isoFromMs(loginMs),
      lastSeenAt: isoFromMs(lastSeenMs),
      lastInteractionAt: isoFromMs(lastIntMs),
      lastRoute: route || null,
      moduleId,
      moduleLabelCs: moduleLabelCs(moduleId),
      deviceType: typeof d.deviceType === "string" ? d.deviceType : null,
      isActive: d.isActive !== false,
      presence,
      lastActivityRelativeCs: latestMs ? formatRelativeCs(latestMs, nowMs) : "—",
    });
  }
  return rows;
}

export function aggregateUsersByPresence(sessions: StaffSessionPresenceRow[]): UserPresenceAggregate[] {
  const byUser = new Map<string, StaffSessionPresenceRow[]>();
  for (const s of sessions) {
    if (!s.userId) continue;
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }
  const order: PresenceState[] = ["online", "idle", "offline"];
  const rank = (p: PresenceState) => order.indexOf(p);

  return [...byUser.entries()].map(([userId, list]) => {
    const best = list.reduce((a, b) => (rank(a.presence) <= rank(b.presence) ? a : b));
    const latestSeen = list
      .map((x) => timestampToMs(x.lastSeenAt) ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const latestInt = list
      .map((x) => timestampToMs(x.lastInteractionAt) ?? timestampToMs(x.lastSeenAt) ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      userId,
      employeeName: best.employeeName,
      employeeEmail: best.employeeEmail,
      presence: best.presence,
      sessions: list,
      lastSeenAt: latestSeen ? new Date(latestSeen).toISOString() : null,
      lastInteractionAt: latestInt ? new Date(latestInt).toISOString() : null,
      moduleLabelCs: best.moduleLabelCs,
      loginAt: list.map((x) => x.loginAt).filter(Boolean).sort()[0] ?? null,
      lastActivityRelativeCs: latestInt
        ? formatRelativeCs(latestInt, Date.now())
        : latestSeen
          ? formatRelativeCs(latestSeen, Date.now())
          : "—",
    };
  });
}

export async function loadTodayActionCount(db: Firestore): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const snap = await db.collection(PLATFORM_PORTAL_ANALYTICS_GLOBAL_DAILY_COLLECTION).doc(day).get();
  const ev = (snap.data()?.events ?? {}) as Record<string, number>;
  return Object.values(ev).reduce((a, b) => a + (Number(b) || 0), 0);
}

export async function loadGlobalLastLogin(db: Firestore, orgIds: string[]): Promise<string | null> {
  let best: number | null = null;
  for (const orgId of orgIds.slice(0, 40)) {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(orgId)
      .collection("staffSessions")
      .orderBy("loginAt", "desc")
      .limit(1)
      .get()
      .catch(() => null);
    if (!snap || snap.empty) continue;
    const ms = timestampToMs(snap.docs[0].data().loginAt);
    if (ms && (best == null || ms > best)) best = ms;
  }
  return best != null ? new Date(best).toISOString() : null;
}

export async function loadOrgLastLogin(
  db: Firestore,
  organizationId: string
): Promise<string | null> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection("staffSessions")
    .orderBy("loginAt", "desc")
    .limit(1)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return null;
  const ms = timestampToMs(snap.docs[0].data().loginAt);
  return ms != null ? new Date(ms).toISOString() : null;
}
