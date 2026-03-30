import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  parseEmployeeOrgRole,
  userPortalRoleForEmployeeDocRole,
} from "@/lib/employee-organization";

type Body = {
  employeeId?: string;
  /** Role v organizaci — přepíše companies/.../employees.role a users.role. */
  role?: string;
  visibleInAttendanceTerminal?: boolean;
  /** Přístup k modulu Sklad (jen běžný zaměstnanec; owner/admin/manager mají vždy). */
  canAccessWarehouse?: boolean;
  /** Přístup k modulu Výroba. */
  canAccessProduction?: boolean;
  /** Moduly zaměstnaneckého portálu — merge přes `set(..., { merge: true })`. */
  employeePortalModules?: {
    zakazky?: boolean;
    penize?: boolean;
    zpravy?: boolean;
    dochazka?: boolean;
  };
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
  const hasPortalMods =
    body.employeePortalModules != null &&
    typeof body.employeePortalModules === "object";

  if (!hasOrgRole && !hasVisible && !hasWh && !hasPr && !hasPortalMods) {
    return NextResponse.json(
      {
        error:
          "Pošlete role, visibleInAttendanceTerminal, canAccessWarehouse / canAccessProduction a/nebo employeePortalModules.",
      },
      { status: 400 }
    );
  }

  let orgRole = parseEmployeeOrgRole(emp as { role?: unknown });
  if (hasOrgRole) {
    const raw = String(body.role || "").trim();
    if (raw !== "employee" && raw !== "orgAdmin") {
      return NextResponse.json(
        { error: "role musí být employee nebo orgAdmin." },
        { status: 400 }
      );
    }
    orgRole = raw as "employee" | "orgAdmin";
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
  if (hasPortalMods && body.employeePortalModules) {
    const pm = body.employeePortalModules;
    patch.employeePortalModules = {
      zakazky: pm.zakazky !== false,
      penize: pm.penize !== false,
      zpravy: pm.zpravy !== false,
      dochazka: pm.dochazka !== false,
    };
  }

  await empRef.set(patch, { merge: true });

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
