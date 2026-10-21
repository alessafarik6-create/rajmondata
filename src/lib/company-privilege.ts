/**
 * Čistá logika rolí — bez firebase-admin (bezpečné pro import z "use client" komponent).
 */

export function normalizeCompanyRole(role: string): string {
  return String(role || "").trim().toLowerCase();
}

export function isCompanyEmployeeRole(role: string): boolean {
  return normalizeCompanyRole(role) === "employee";
}

export function isCompanyPrivileged(role: string, globalRoles: string[]): boolean {
  if (globalRoles.includes("super_admin")) return true;
  const r = normalizeCompanyRole(role);
  return ["owner", "admin", "manager"].includes(r);
}

/** Správa organizace (šablony, mazání, nastavení) — ne zaměstnanecká matice modulů. */
export function isCompanyOrgOwnerOrAdmin(
  role: string,
  globalRoles?: string[] | null
): boolean {
  const globals = Array.isArray(globalRoles) ? globalRoles : [];
  if (globals.includes("super_admin")) return true;
  const r = normalizeCompanyRole(role);
  return r === "owner" || r === "admin";
}
