import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { callerIsCompanyOwner } from "@/lib/company-owner";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import { parseEmployeeOrgRole, userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";

export type PortalRoleResolutionContext = {
  /** UID z companies.ownerId / ownerUserId — oprávnění vlastníka i při chybném users.role. */
  companyOwnerUid?: string | null;
};

type CallerRoleInput = Pick<VerifiedCompanyCaller, "uid" | "role" | "globalRoles">;

/** Role pro matici portálu — owner/admin z profilu nebo vlastník firmy, jinak employees.role. */
export function effectivePortalRoleForCaller(
  caller: CallerRoleInput,
  employeeDoc: Record<string, unknown> | null,
  ctx?: PortalRoleResolutionContext
): string {
  const globalRoles = Array.isArray(caller.globalRoles) ? caller.globalRoles : [];
  if (globalRoles.includes("super_admin")) {
    return caller.role;
  }
  if (callerIsCompanyOwner(caller.uid, ctx?.companyOwnerUid)) {
    return "owner";
  }
  const userRole = normalizeCompanyRole(caller.role);
  if (userRole === "owner" || userRole === "admin") {
    return caller.role;
  }
  if (employeeDoc) {
    return userPortalRoleForEmployeeDocRole(parseEmployeeOrgRole(employeeDoc));
  }
  return caller.role;
}
