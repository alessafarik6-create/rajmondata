import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import { parseEmailMailboxManageEnabled } from "@/lib/portal-permissions";

export function callerIsOrgMailboxAdmin(caller: {
  role: string;
  globalRoles?: string[];
}): boolean {
  const role = normalizeCompanyRole(caller.role);
  const globalRoles = Array.isArray(caller.globalRoles) ? caller.globalRoles : [];
  return globalRoles.includes("super_admin") || role === "owner" || role === "admin";
}

/** Přidání, odpojení a úprava schránek v povoleném rozsahu. */
export function callerCanManageEmailMailboxes(
  caller: VerifiedCompanyCaller,
  employeeDoc: Record<string, unknown> | null
): boolean {
  if (callerIsOrgMailboxAdmin(caller)) return true;
  return parseEmailMailboxManageEnabled(employeeDoc);
}
