import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyCompanyBearerFromRequest } from "@/lib/api-company-auth";
import { loadEmployeePermissionsState } from "@/lib/portal-effective-access-server";
import { employeeRecordBelongsToCompany } from "@/lib/employee-record-company";
import { portalPermissionLevelsForAdminEditor } from "@/lib/portal-permissions-admin";
export const dynamic = "force-dynamic";

/**
 * Autoritativní stav oprávnění zaměstnance (Admin SDK) — pro admin UI po uložení / F5.
 */
export async function GET(request: NextRequest) {
  try {
    const base = await verifyCompanyBearerFromRequest(request);
    if (!base.ok) {
      return NextResponse.json({ ok: false, error: base.error }, { status: base.status });
    }

    const callerRole = String(base.caller.role || "");
    if (!["owner", "admin"].includes(callerRole)) {
      return NextResponse.json(
        { ok: false, error: "Pouze vlastník nebo administrátor může načítat stav oprávnění." },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const employeeId = String(url.searchParams.get("employeeId") ?? "").trim();
    if (!employeeId) {
      return NextResponse.json({ ok: false, error: "Chybí employeeId." }, { status: 400 });
    }

    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json(
        { ok: false, error: "Firebase Admin není nakonfigurován." },
        { status: 503 }
      );
    }

    const empSnap = await db
      .collection("companies")
      .doc(base.caller.companyId)
      .collection("employees")
      .doc(employeeId)
      .get();
    if (!empSnap.exists) {
      return NextResponse.json({ ok: false, error: "Zaměstnanec neexistuje." }, { status: 404 });
    }
    const emp = empSnap.data() as Record<string, unknown>;
    if (!employeeRecordBelongsToCompany(emp, base.caller.companyId)) {
      return NextResponse.json({ ok: false, error: "Neplatná firma." }, { status: 403 });
    }

    const state = await loadEmployeePermissionsState(db, base.caller, employeeId, {
      reconcileUserLink: false,
    });
    if (!state) {
      return NextResponse.json({ ok: false, error: "Stav oprávnění nelze načíst." }, { status: 404 });
    }

    const editorLevels = portalPermissionLevelsForAdminEditor(emp, state.orgRole);

    return NextResponse.json({
      ok: true,
      employeeId: state.employeeId,
      companyId: state.companyId,
      orgRole: state.orgRole,
      usersRole: state.usersRole,
      portalRoleForMatrix: state.portalRoleForMatrix,
      materialized: state.materialized,
      portalModulePermissions: state.portalModulePermissions,
      portalPermissionsRevision: state.portalPermissionsRevision,
      effectivePermissions: state.effectivePermissions,
      editorModulePermissions: editorLevels,
      authUserId: state.authUserId,
      employeeDocSource: state.employeeDocSource,
      productCatalogsEffective: state.effectivePermissions.productCatalogs ?? "none",
      productCatalogsStored: state.portalModulePermissions?.productCatalogs ?? null,
    });
  } catch (e) {
    console.error("[permissions-state GET]", e);
    return NextResponse.json(
      { ok: false, error: "Načtení stavu oprávnění selhalo kvůli chybě serveru." },
      { status: 500 }
    );
  }
}
