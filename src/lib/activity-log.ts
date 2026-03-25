/**
 * Centrální audit aktivit: Firestore companies/{companyId}/activityLogs/{logId}
 * Pole organizationId = companyId (alias pro konzistenci s požadavkem na „organizationId“).
 */

import type { Firestore } from "firebase/firestore";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import type { User } from "firebase/auth";

export type ActivityActorProfile = {
  displayName?: string;
  employeeId?: string;
  role?: string;
  companyId?: string;
};

export type ActivityLogPayload = {
  actionType: string;
  actionLabel: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  details?: string | null;
  sourceModule?: string | null;
  route?: string | null;
  metadata?: Record<string, unknown>;
};

const MAX_DETAILS = 4000;
const MAX_META_JSON = 12000;

function safeString(s: string | null | undefined, max: number): string | null {
  if (s == null || !String(s).trim()) return null;
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function safeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") return null;
  try {
    const json = JSON.stringify(meta);
    if (json.length > MAX_META_JSON) {
      return { _truncated: true, preview: json.slice(0, MAX_META_JSON) + "…" };
    }
    return meta;
  } catch {
    return { _error: "metadata_not_serializable" };
  }
}

/**
 * Zapíše auditní událost. Při chybě hodí — pro „bezpečné“ volání použij logActivitySafe.
 */
export async function logActivity(
  firestore: Firestore,
  companyId: string,
  user: User,
  profile: ActivityActorProfile | null | undefined,
  payload: ActivityLogPayload
): Promise<void> {
  if (!firestore || !companyId?.trim() || !user?.uid) return;

  const orgId = companyId.trim();
  const employeeId =
    typeof profile?.employeeId === "string" && profile.employeeId.trim()
      ? profile.employeeId.trim()
      : null;
  const employeeName =
    safeString(
      profile?.displayName?.trim() || user.displayName || user.email?.split("@")[0],
      200
    ) || "Uživatel";
  const employeeEmail = user.email?.trim() ? user.email.trim() : null;

  await addDoc(collection(firestore, "companies", orgId, "activityLogs"), {
    organizationId: orgId,
    companyId: orgId,
    userId: user.uid,
    employeeId,
    employeeName,
    employeeEmail,
    actionType: payload.actionType.slice(0, 120),
    actionLabel: payload.actionLabel.slice(0, 500),
    entityType: payload.entityType.slice(0, 80),
    entityId: payload.entityId?.trim()?.slice(0, 200) ?? null,
    entityName: safeString(payload.entityName, 500),
    details: safeString(payload.details, MAX_DETAILS),
    sourceModule: safeString(payload.sourceModule, 80),
    route: safeString(payload.route, 500),
    metadata: safeMetadata(payload.metadata),
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });
}

export function logActivitySafe(
  firestore: Firestore | null,
  companyId: string | undefined,
  user: User | null | undefined,
  profile: ActivityActorProfile | null | undefined,
  payload: ActivityLogPayload
): void {
  if (!firestore || !companyId?.trim() || !user?.uid) return;
  void logActivity(firestore, companyId.trim(), user, profile, payload).catch((e) => {
    console.warn("[activity-log] zapis se nezdařil", e);
  });
}

export type DeviceKind = "desktop" | "mobile" | "tablet" | "unknown";

export function detectDeviceType(): DeviceKind {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/tablet|ipad/i.test(ua)) return "tablet";
  if (/mobile|android|iphone/i.test(ua)) return "mobile";
  return "desktop";
}

export function staffSessionStorageKey(companyId: string, uid: string): string {
  return `bf_staff_session_v1_${companyId}_${uid}`;
}

export async function createOrResumeStaffSession(params: {
  firestore: Firestore;
  companyId: string;
  user: User;
  profile: ActivityActorProfile | null | undefined;
  route: string;
}): Promise<string | null> {
  const { firestore, companyId, user, profile, route } = params;
  if (!companyId?.trim() || !user.uid) return null;
  const cid = companyId.trim();
  const key = staffSessionStorageKey(cid, user.uid);
  const existingId =
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null;

  if (existingId) {
    const ref = doc(firestore, "companies", cid, "staffSessions", existingId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data() as { isActive?: boolean };
      if (d.isActive !== false) {
        await updateDoc(ref, {
          lastSeenAt: serverTimestamp(),
          ...(route
            ? { lastRoute: route.slice(0, 500) }
            : {}),
        }).catch(() => {});
        return existingId;
      }
    }
  }

  const col = collection(firestore, "companies", cid, "staffSessions");
  const sessionRef = doc(col);
  const sessionId = sessionRef.id;
  const employeeId =
    typeof profile?.employeeId === "string" && profile.employeeId.trim()
      ? profile.employeeId.trim()
      : null;
  const employeeName =
    profile?.displayName?.trim() ||
    user.displayName ||
    user.email?.split("@")[0] ||
    "Uživatel";

  await setDoc(sessionRef, {
    sessionId,
    userId: user.uid,
    organizationId: cid,
    companyId: cid,
    employeeId,
    employeeName,
    employeeEmail: user.email?.trim() || null,
    loginAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    logoutAt: null,
    durationSeconds: null,
    durationMinutes: null,
    isActive: true,
    deviceType: detectDeviceType(),
    source: "web",
    lastRoute: route.slice(0, 500),
  });

  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(key, sessionId);
  }

  logActivitySafe(firestore, cid, user, profile, {
    actionType: "auth.login",
    actionLabel: "Přihlášení",
    entityType: "session",
    entityId: sessionId,
    entityName: "Relace",
    details: `Začátek relace (${detectDeviceType()})`,
    sourceModule: "auth",
    route,
    metadata: { sessionId, deviceType: detectDeviceType(), source: "web" },
  });

  return sessionId;
}

export async function closeStaffSessionAndLog(params: {
  firestore: Firestore;
  companyId: string;
  user: User;
  profile: ActivityActorProfile | null | undefined;
  sessionId: string;
  route?: string | null;
}): Promise<void> {
  const { firestore, companyId, user, profile, sessionId, route } = params;
  if (!companyId?.trim() || !sessionId || !user.uid) return;
  const cid = companyId.trim();
  const ref = doc(firestore, "companies", cid, "staffSessions", sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as {
    loginAt?: Timestamp;
    userId?: string;
  };
  if (data.userId && data.userId !== user.uid) return;

  const logoutAt = new Date();
  let durationSeconds = 0;
  const loginAt = data.loginAt;
  if (loginAt && typeof loginAt.toMillis === "function") {
    durationSeconds = Math.max(
      0,
      Math.round((logoutAt.getTime() - loginAt.toMillis()) / 1000)
    );
  }

  await updateDoc(ref, {
    isActive: false,
    logoutAt: serverTimestamp(),
    durationSeconds,
    durationMinutes: Math.round((durationSeconds / 60) * 100) / 100,
    lastSeenAt: serverTimestamp(),
    ...(route ? { lastRoute: route.slice(0, 500) } : {}),
  }).catch(() => {});

  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(staffSessionStorageKey(cid, user.uid));
  }

  logActivitySafe(firestore, cid, user, profile, {
    actionType: "auth.logout",
    actionLabel: "Odhlášení",
    entityType: "session",
    entityId: sessionId,
    entityName: "Relace",
    details: `Konec relace, délka ${Math.round(durationSeconds / 60)} min`,
    sourceModule: "auth",
    route: route ?? null,
    metadata: {
      sessionId,
      durationSeconds,
      durationMinutes: Math.round((durationSeconds / 60) * 100) / 100,
    },
  });
}
