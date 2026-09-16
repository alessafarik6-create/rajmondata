import {
  parseEmployeePortalRole,
  userRoleForEmployeePortalRole,
  type EmployeePortalRoleId,
} from "@/lib/employee-portal-role";

/**
 * Role zaměstnance v dokumentu companies/.../employees/{id}.
 */
export type EmployeeOrgRole = EmployeePortalRoleId;

export function parseEmployeeOrgRole(
  emp: { role?: unknown } | null | undefined
): EmployeeOrgRole {
  return parseEmployeePortalRole(emp?.role);
}

/** Odpovídající role v users/{uid} pro přístup do portálu firmy. */
export function userPortalRoleForEmployeeDocRole(
  org: EmployeeOrgRole
): "admin" | "employee" | "accountant" {
  return userRoleForEmployeePortalRole(org);
}

/** Výchozí = viditelný v terminálu (zpětná kompatibilita). */
export function isVisibleInAttendanceTerminal(
  emp: { visibleInAttendanceTerminal?: boolean } | null | undefined
): boolean {
  return emp?.visibleInAttendanceTerminal !== false;
}
