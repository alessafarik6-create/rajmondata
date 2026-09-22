import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  parseEmployeeOrgRole,
  userPortalRoleForEmployeeDocRole,
} from "@/lib/employee-organization";
import { parseEmployeePortalRole } from "@/lib/employee-portal-role";
import {
  legacyAccessFlagsFromPortalPermissions,
  parsePortalModulePermissionsFromEmployee,
  portalPermissionsToLegacyEmployeeModules,
  type PortalAccessLevel,
  type PortalModuleId,
  ALL_PORTAL_MODULE_IDS,
} from "@/lib/portal-permissions";
import {
  aggregateScheduleModuleLevel,
  normalizeCalendarPermissionsForFirestore,
  type CalendarPermissionsDoc,
} from "@/lib/calendar/calendar-access";

type Body = {
  employeeId?: string;
  /** Role v organizaci — přepíše companies/.../employees.role a users.role. */
  role?: string;
  visibleInAttendanceTerminal?: boolean;
  /** Přístup k modulu Sklad (jen běžný zaměstnanec; owner/admin/manager mají vždy). */
  canAccessWarehouse?: boolean;
  /** Přístup k modulu Výroba. */
  canAccessProduction?: boolean;
  /** Záznamy ze schůzek u zakázek — čtení a úpravy (běžný zaměstnanec). */
  canAccessMeetingNotes?: boolean;
  /** Moduly zaměstnaneckého portálu — merge přes `set(..., { merge: true })`. */
  employeePortalModules?: {
    zakazky?: boolean;
    penize?: boolean;
    zpravy?: boolean;
    dochazka?: boolean;
  };
  /** NONE / READ / WRITE po modulech sidebaru — merge na employees.portalModulePermissions. */
  portalModulePermissions?: Record<string, string>;
  /** Schůzky / montáže v kalendáři — `employees.calendarPermissions`. */
  calendarPermissions?: CalendarPermissionsDoc | null;
  /** Widget RAJMONDATA AI na /portal/dashboard (user-scoped). */
  dashboardAiAssistantEnabled?: boolean;
};

/**
 * Úprava role v organizaci a viditelnosti v terminálu.
 * Aktualizuje companies/.../employees a users/{authUserId}.role (Admin SDK).
 */
export async function PATCH(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json(
      { error: "Firebase Admin není nakonfigurován." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Chybí Authorization Bearer token." }, { status: 401 });
  }

  let callerUid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil volajícího neexistuje." }, { status: 403 });
  }

  const globalRoles = caller.globalRoles as string[] | undefined;
  if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) {
    return NextResponse.json(
      { error: "Superadministrátor použije jiné nástroje — tato akce je jen pro správu firmy." },
      { status: 403 }
    );
  }

  const companyId = String(caller.companyId || "").trim();
  const callerRole = String(caller.role || "");
  if (!companyId || !["owner", "admin"].includes(callerRole)) {
    return NextResponse.json(
      { error: "Pouze vlastník nebo administrátor organizace může měnit tyto údaje." },
      { status: 403 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const employeeId = String(body.employeeId || "").trim();
  if (!employeeId) {
    return NextResponse.json({ error: "Chybí employeeId." }, { status: 400 });
  }

  const empRef = db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(employeeId);
  const empSnap = await empRef.get();
  if (!empSnap.exists) {
    return NextResponse.json({ error: "Zaměstnanec neexistuje." }, { status: 404 });
  }
  const emp = empSnap.data() as Record<string, unknown>;
  if (String(emp.companyId || "") !== companyId) {
    return NextResponse.json({ error: "Neplatná firma." }, { status: 403 });
  }

  const hasOrgRole = typeof body.role === "string";
  const hasVisible = typeof body.visibleInAttendanceTerminal === "boolean";
  const hasWh = typeof body.canAccessWarehouse === "boolean";
  const hasPr = typeof body.canAccessProduction === "boolean";
  const hasMn = typeof body.canAccessMeetingNotes === "boolean";
  const hasPortalMods =
    body.employeePortalModules != null &&
    typeof body.employeePortalModules === "object";
  const hasPortalMatrix =
    body.portalModulePermissions != null &&
    typeof body.portalModulePermissions === "object";
  const hasAiToggle = typeof body.dashboardAiAssistantEnabled === "boolean";

  if (
    !hasOrgRole &&
    !hasVisible &&
    !hasWh &&
    !hasPr &&
    !hasMn &&
    !hasPortalMods &&
    !hasPortalMatrix &&
    !hasAiToggle
  ) {
    return NextResponse.json(
      {
        error:
          "Pošlete role, visibleInAttendanceTerminal, canAccessWarehouse / canAccessProduction, canAccessMeetingNotes, employeePortalModules a/nebo portalModulePermissions.",
      },
      { status: 400 }
    );
  }

  let orgRole = parseEmployeeOrgRole(emp as { role?: unknown });
  if (hasOrgRole) {
    const raw = String(body.role || "").trim();
    const parsed = parseEmployeePortalRole(raw);
    if (raw !== parsed) {
      return NextResponse.json(
        { error: "role musí být employee, accountant nebo orgAdmin." },
        { status: 400 }
      );
    }
    orgRole = parsed;
  }

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (hasOrgRole) {
    patch.role = orgRole;
  }
  if (hasVisible) {
    patch.visibleInAttendanceTerminal = body.visibleInAttendanceTerminal;
  }
  if (hasWh) {
    patch.canAccessWarehouse = body.canAccessWarehouse;
  }
  if (hasPr) {
    patch.canAccessProduction = body.canAccessProduction;
  }
  if (hasMn) {
    patch.canAccessMeetingNotes = body.canAccessMeetingNotes;
  }
  if (hasPortalMods && body.employeePortalModules) {
    const pm = body.employeePortalModules;
    /** Explicitní booleany — `false` se nesmí změnit na true přes `!== false`. */
    patch.employeePortalModules = {
      zakazky: pm.zakazky === true,
      penize: pm.penize === true,
      zpravy: pm.zpravy === true,
      dochazka: pm.dochazka === true,
    };
  }

  if (hasPortalMatrix && body.portalModulePermissions) {
    const incoming = body.portalModulePermissions;
    const existing = parsePortalModulePermissionsFromEmployee(emp);
    const merged: Record<string, string> = {};
    for (const id of ALL_PORTAL_MODULE_IDS) {
      const fromBody = incoming[id];
      const v =
        typeof fromBody === "string"
          ? fromBody.trim().toLowerCase()
          : String(existing[id] ?? "none").trim().toLowerCase();
      if (v === "read" || v === "write" || v === "none") {
        merged[id] = v;
      }
    }
    patch.portalModulePermissions = merged;

    const levelMap = {} as Record<PortalModuleId, PortalAccessLevel>;
    for (const id of ALL_PORTAL_MODULE_IDS) {
      const v = String(merged[id] ?? "none").trim().toLowerCase();
      levelMap[id] =
        v === "read" || v === "write" || v === "none" ? v : "none";
    }
    patch.employeePortalModules = portalPermissionsToLegacyEmployeeModules(levelMap);
    const flags = legacyAccessFlagsFromPortalPermissions(levelMap);
    patch.canAccessWarehouse = flags.canAccessWarehouse;
    patch.canAccessProduction = flags.canAccessProduction;
    patch.canAccessMeetingNotes = flags.canAccessMeetingNotes;
  }

  if (body.calendarPermissions !== undefined) {
    const normalized = normalizeCalendarPermissionsForFirestore(body.calendarPermissions ?? {});
    if (normalized) patch.calendarPermissions = normalized;
    else patch.calendarPermissions = FieldValue.delete();
    if (hasPortalMatrix && patch.portalModulePermissions) {
      const merged = patch.portalModulePermissions as Record<string, string>;
      merged.schedule = aggregateScheduleModuleLevel(body.calendarPermissions ?? {});
      patch.portalModulePermissions = merged;
    }
  }

  if (typeof body.dashboardAiAssistantEnabled === "boolean") {
    patch.dashboardAiAssistantEnabled = body.dashboardAiAssistantEnabled;
  }

  const beforePermissions = (emp.portalModulePermissions ?? {}) as Record<string, string>;
  const beforeAi = emp.dashboardAiAssistantEnabled;

  await empRef.set(patch, { merge: true });

  if (hasPortalMatrix || typeof body.dashboardAiAssistantEnabled === "boolean") {
    try {
      await db.collection("companies").doc(companyId).collection("activity_log").add({
        actionType: "USER_PERMISSIONS_UPDATED",
        actionLabel: "Změna oprávnění portálu",
        entityType: "employee",
        entityId: employeeId,
        details: JSON.stringify({
          oldPermissions: beforePermissions,
          newPermissions: patch.portalModulePermissions ?? beforePermissions,
          oldDashboardAiAssistant: beforeAi,
          newDashboardAiAssistant: patch.dashboardAiAssistantEnabled ?? beforeAi,
        }),
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch {
      /* audit volitelný */
    }
  }

  const authUserId = String(emp.authUserId || "").trim();
  if (authUserId && hasOrgRole) {
    const portalRole = userPortalRoleForEmployeeDocRole(orgRole);
    await db.collection("users").doc(authUserId).set(
      {
        role: portalRole,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return NextResponse.json({ ok: true });
}
