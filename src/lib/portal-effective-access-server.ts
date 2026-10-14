/**
 * Jednotný serverový výpočet efektivních oprávnění (admin, portál, API).
 */
import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { parseEmployeeOrgRole, userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import { parseEmployeePortalRole } from "@/lib/employee-portal-role";
import { effectivePortalRoleForCaller } from "@/lib/portal-caller-role";
import { resolveEmployeeRecordForCaller } from "@/lib/portal-employee-doc-resolve";
import {
  resolveEffectivePortalPermissions,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";

export type EmployeePermissionsState = {
  employeeId: string;
  employeeDocSource: string;
  companyId: string;
  /** Organizační role v employees.role (autorita). */
  orgRole: ReturnType<typeof parseEmployeePortalRole>;
  usersRole: string;
  portalRoleForMatrix: string;
  materialized: boolean;
  portalModulePermissions: Record<string, string> | null;
  portalPermissionsRevision: number | null;
  effectivePermissions: Record<PortalModuleId, PortalAccessLevel>;
  authUserId: string | null;
};

export async function loadEmployeePermissionsState(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  targetEmployeeId: string,
  opts?: { reconcileUserLink?: boolean }
): Promise<EmployeePermissionsState | null> {
  const companyId = caller.companyId;
  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(targetEmployeeId)
    .get();
  if (!empSnap.exists) return null;
  const employeeDoc = empSnap.data() as Record<string, unknown>;

  const orgRole = parseEmployeePortalRole(employeeDoc.role);
  const portalRoleForMatrix = userPortalRoleForEmployeeDocRole(orgRole);
  const effectivePermissions = resolveEffectivePortalPermissions({
    role: portalRoleForMatrix,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });

  let employeeDocSource = "admin.employeeId";
  const authUserId = String(employeeDoc.authUserId ?? "").trim() || null;
  if (authUserId && caller.uid === authUserId) {
    const resolved = await resolveEmployeeRecordForCaller(db, caller, {
      reconcileUserLink: opts?.reconcileUserLink ?? false,
    });
    if (resolved && resolved.employeeId !== targetEmployeeId) {
      employeeDocSource = `mismatch:auth→${resolved.employeeId}`;
    } else if (resolved) {
      employeeDocSource = resolved.source;
    }
  }

  const raw = employeeDoc.portalModulePermissions;
  const portalModulePermissions =
    raw && typeof raw === "object" ? (raw as Record<string, string>) : null;

  return {
    employeeId: targetEmployeeId,
    employeeDocSource,
    companyId,
    orgRole,
    usersRole: caller.role,
    portalRoleForMatrix,
    materialized: employeeDoc.portalModulePermissionsMaterialized === true,
    portalModulePermissions,
    portalPermissionsRevision:
      typeof employeeDoc.portalPermissionsRevision === "number"
        ? employeeDoc.portalPermissionsRevision
        : null,
    effectivePermissions,
    authUserId,
  };
}

export async function computeEffectivePortalAccessForCaller(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<{
  permissions: Record<PortalModuleId, PortalAccessLevel>;
  portalRole: string;
  employeeId: string | null;
  orgRole: ReturnType<typeof parseEmployeeOrgRole>;
}> {
  const resolved = await resolveEmployeeRecordForCaller(db, caller);
  const employeeDoc = resolved?.employeeDoc ?? null;
  const portalRole = effectivePortalRoleForCaller(caller, employeeDoc);
  const orgRole = employeeDoc ? parseEmployeeOrgRole(employeeDoc) : parseEmployeeOrgRole(null);
  const permissions = resolveEffectivePortalPermissions({
    role: portalRole,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });
  return {
    permissions,
    portalRole,
    employeeId: resolved?.employeeId ?? null,
    orgRole,
  };
}
