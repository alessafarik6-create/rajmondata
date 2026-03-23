/**
 * Role zaměstnance v dokumentu companies/.../employees/{id}.
 * Hodnoty: employee | orgAdmin (odlišné od users.role na účtu).
 */
export type EmployeeOrgRole = "employee" | "orgAdmin";

export function parseEmployeeOrgRole(
  emp: { role?: unknown } | null | undefined
): EmployeeOrgRole {
  return emp?.role === "orgAdmin" ? "orgAdmin" : "employee";
}

/** Odpovídající role v users/{uid} pro přístup do portálu firmy. */
export function userPortalRoleForEmployeeDocRole(org: EmployeeOrgRole): "admin" | "employee" {
  return org === "orgAdmin" ? "admin" : "employee";
}

/** Výchozí = viditelný v terminálu (zpětná kompatibilita). */
export function isVisibleInAttendanceTerminal(
  emp: { visibleInAttendanceTerminal?: boolean } | null | undefined
): boolean {
  return emp?.visibleInAttendanceTerminal !== false;
}
