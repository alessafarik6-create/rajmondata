import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import { parseEmployeeOrgRole, userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";

/** Role pro matici portálu — priorita dokumentu zaměstnance před `users.role`. */
export function effectivePortalRoleForCaller(
  caller: VerifiedCompanyCaller,
  employeeDoc: Record<string, unknown> | null
): string {
  const userRole = normalizeCompanyRole(caller.role);
  const globalRoles = Array.isArray(caller.globalRoles) ? caller.globalRoles : [];
  if (globalRoles.includes("super_admin") || userRole === "owner" || userRole === "admin") {
    return caller.role;
  }
  if (employeeDoc) {
    return userPortalRoleForEmployeeDocRole(parseEmployeeOrgRole(employeeDoc));
  }
  return caller.role;
}
