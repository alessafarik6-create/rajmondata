/**
 * Čistá logika rolí — bez firebase-admin (bezpečné pro import z "use client" komponent).
 */

export function isCompanyPrivileged(role: string, globalRoles: string[]): boolean {
  if (globalRoles.includes("super_admin")) return true;
  return ["owner", "admin", "manager"].includes(role);
}
