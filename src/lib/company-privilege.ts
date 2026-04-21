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
