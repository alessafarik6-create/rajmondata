/**
 * Role zaměstnance v portálu firmy (ukládá se na employees/{id}.role, sync na users.role).
 */

export type EmployeePortalRoleId = "employee" | "orgAdmin" | "accountant";

export const EMPLOYEE_PORTAL_ROLE_OPTIONS: readonly {
  value: EmployeePortalRoleId;
  label: string;
}[] = [
  { value: "employee", label: "Zaměstnanec" },
  { value: "accountant", label: "Účetní" },
  { value: "orgAdmin", label: "Administrátor organizace" },
];

export function parseEmployeePortalRole(raw: unknown): EmployeePortalRoleId {
  const v = String(raw ?? "").trim();
  if (v === "orgAdmin") return "orgAdmin";
  if (v === "accountant") return "accountant";
  return "employee";
}

/** Mapování na users.role (Firebase profil). */
export function userRoleForEmployeePortalRole(
  role: EmployeePortalRoleId
): "admin" | "employee" | "accountant" {
  if (role === "orgAdmin") return "admin";
  if (role === "accountant") return "accountant";
  return "employee";
}

export function employeePortalRoleLabel(role: EmployeePortalRoleId): string {
  return EMPLOYEE_PORTAL_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
}
