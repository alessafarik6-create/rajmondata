/**
 * Role zaměstnance v portálu firmy (ukládá se na employees/{id}.role, sync na users.role).
 */

export type EmployeePortalRoleId =
  | "employee"
  | "orgAdmin"
  | "accountant"
  | "manager";

export const EMPLOYEE_PORTAL_ROLE_OPTIONS: readonly {
  value: EmployeePortalRoleId;
  label: string;
}[] = [
  { value: "employee", label: "Zaměstnanec" },
  { value: "accountant", label: "Účetní" },
  { value: "manager", label: "Manažer" },
  { value: "orgAdmin", label: "Administrátor organizace" },
];

export function parseEmployeePortalRole(raw: unknown): EmployeePortalRoleId {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "orgadmin") return "orgAdmin";
  if (v === "accountant") return "accountant";
  if (v === "manager") return "manager";
  return "employee";
}

/** Validace hodnoty z API formuláře (case-insensitive). */
export function parseEmployeePortalRoleFromRequest(raw: unknown): EmployeePortalRoleId | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  const allowed = new Set(["employee", "accountant", "manager", "orgadmin"]);
  if (!allowed.has(normalized)) return null;
  return parseEmployeePortalRole(trimmed);
}

/** Mapování na users.role (Firebase profil). */
export function userRoleForEmployeePortalRole(
  role: EmployeePortalRoleId
): "admin" | "employee" | "accountant" | "manager" {
  if (role === "orgAdmin") return "admin";
  if (role === "accountant") return "accountant";
  if (role === "manager") return "manager";
  return "employee";
}

export function employeePortalRoleLabel(role: EmployeePortalRoleId): string {
  return EMPLOYEE_PORTAL_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
}
