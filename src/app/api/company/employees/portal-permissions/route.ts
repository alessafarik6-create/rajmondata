import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { ALL_PORTAL_MODULE_IDS, type PortalAccessLevel } from "@/lib/portal-permissions";
import { normalizeCameraPermissionsForFirestore } from "@/lib/hikvision/camera-access";
import {
  aggregateScheduleModuleLevel,
  normalizeCalendarPermissionsForFirestore,
  type CalendarPermissionsDoc,
} from "@/lib/calendar/calendar-access";

type Body = {
  employeeId?: string;
  permissions?: Record<string, string>;
  cameraPermissions?: {
    view?: boolean;
    live?: boolean;
    playback?: boolean;
    admin?: boolean;
  } | null;
  calendarPermissions?: CalendarPermissionsDoc | null;
};

function normalizeLevel(raw: unknown): PortalAccessLevel | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "none" || v === "read" || v === "write") return v;
  return null;
}

export async function PATCH(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let callerUid: string;
  try {
    callerUid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  const companyId = String(caller.companyId || "").trim();
  const callerRole = String(caller.role || "");
  if (!companyId || !["owner", "admin"].includes(callerRole)) {
    return NextResponse.json(
      { error: "Pouze vlastník nebo administrátor může měnit oprávnění." },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId ?? "").trim();
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
  }

  const raw = body.permissions ?? {};
  const portalModulePermissions: Record<string, string> = {};
  for (const id of ALL_PORTAL_MODULE_IDS) {
    const level = normalizeLevel(raw[id]);
    if (level && level !== "none") portalModulePermissions[id] = level;
  }

  const empRef = db.collection("companies").doc(companyId).collection("employees").doc(employeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    return NextResponse.json({ error: "Zaměstnanec neexistuje." }, { status: 404 });
  }

  const before = (empSnap.data()?.portalModulePermissions ?? {}) as Record<string, string>;

  const patch: Record<string, unknown> = {
    portalModulePermissions,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (body.cameraPermissions !== undefined) {
    const normalized = normalizeCameraPermissionsForFirestore(body.cameraPermissions ?? {});
    if (normalized) patch.cameraPermissions = normalized;
    else patch.cameraPermissions = FieldValue.delete();
  }
  if (body.calendarPermissions !== undefined) {
    const normalized = normalizeCalendarPermissionsForFirestore(body.calendarPermissions ?? {});
    if (normalized) {
      patch.calendarPermissions = normalized;
      portalModulePermissions.schedule = aggregateScheduleModuleLevel(
        body.calendarPermissions ?? {}
      );
      if (portalModulePermissions.schedule === "none") {
        delete portalModulePermissions.schedule;
      }
      patch.portalModulePermissions = portalModulePermissions;
    } else {
      patch.calendarPermissions = FieldValue.delete();
    }
  }

  await empRef.set(patch, { merge: true });

  try {
    await db.collection("companies").doc(companyId).collection("activity_log").add({
      actionType: "employee.portal_permissions_updated",
      actionLabel: "Změna oprávnění portálu",
      entityType: "employee",
      entityId: employeeId,
      details: JSON.stringify({ before, after: portalModulePermissions }),
      createdBy: callerUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit volitelný */
  }

  return NextResponse.json({ ok: true, portalModulePermissions });
}
