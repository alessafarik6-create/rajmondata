/** Kdo smí volat notifikaci po registraci (API). */
export function canTriggerNewOrganizationNotify(params: {
  role: string;
  globalRoles: string[];
  callerUid: string;
  callerCompanyId: string;
  organizationId: string;
  organizationOwnerId: string | null;
}): boolean {
  if (params.callerCompanyId !== params.organizationId) return false;
  if (params.globalRoles.includes("super_admin")) return true;
  if (params.role !== "owner") return false;
  if (params.organizationOwnerId && params.organizationOwnerId !== params.callerUid) {
    return false;
  }
  return true;
}

/** Superadmin session — notifikace platformy. */
export function isSuperadminSessionRole(role: string): boolean {
  return String(role || "").trim().length > 0;
}
