import { normalizeCompanyRole } from "@/lib/company-privilege";

export function callerCanReadOrganizationBackups(role: string, globalRoles: string[]): boolean {
  if (globalRoles.includes("super_admin")) return true;
  const r = normalizeCompanyRole(role);
  return r === "owner" || r === "admin";
}

export function callerCanCreateOrganizationBackup(role: string, globalRoles: string[]): boolean {
  return callerCanReadOrganizationBackups(role, globalRoles);
}

/** Obnova pouze majitel organizace (superadmin výjimka). */
export function callerCanRestoreOrganizationBackup(role: string, globalRoles: string[]): boolean {
  if (globalRoles.includes("super_admin")) return true;
  return normalizeCompanyRole(role) === "owner";
}

export function buildRestoreConfirmationPhrase(organizationName: string): string {
  const slug = String(organizationName || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return `OBNOVIT ${slug}`;
}
