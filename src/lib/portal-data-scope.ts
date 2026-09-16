/**
 * Data scope (ALL vs ASSIGNED_ONLY) — odděleně od úrovně NONE / READ / WRITE.
 * ALL = všechny záznamy aktuální organizace (tenant); nikdy cross-tenant.
 */

import { normalizeCompanyRole } from "@/lib/company-privilege";
import type { PortalModuleId } from "@/lib/portal-permissions";

export type PortalDataScope = "ALL" | "ASSIGNED_ONLY";

export type PortalDataScopeInput = {
  role?: string | null;
  globalRoles?: unknown;
  /** Effective permission modulu je alespoň READ. */
  moduleAccessAtLeastRead?: boolean;
};

/** Kdo vidí celou organizaci u modulu (při READ+). */
export function getPortalModuleDataScope(
  _moduleId: PortalModuleId,
  input: PortalDataScopeInput
): PortalDataScope {
  if (!input.moduleAccessAtLeastRead) return "ASSIGNED_ONLY";

  const globalRoles = Array.isArray(input.globalRoles) ? input.globalRoles : [];
  if (globalRoles.includes("super_admin")) return "ALL";

  const role = normalizeCompanyRole(String(input.role ?? ""));
  if (role === "owner" || role === "admin" || role === "manager") return "ALL";
  if (role === "accountant") return "ALL";

  return "ASSIGNED_ONLY";
}

export function seeAllOrganizationRecordsForModule(
  moduleId: PortalModuleId,
  input: PortalDataScopeInput
): boolean {
  return getPortalModuleDataScope(moduleId, input) === "ALL";
}

export type JobListRow = {
  assignedEmployeeIds?: string[] | string;
};

export function jobAssignsToUser(
  j: JobListRow,
  userUid: string,
  employeeDocId?: string | undefined
): boolean {
  const raw = j?.assignedEmployeeIds;
  if (Array.isArray(raw)) {
    if (raw.includes(userUid)) return true;
    if (employeeDocId && raw.includes(employeeDocId)) return true;
    return false;
  }
  if (typeof raw === "string") {
    return raw === userUid || (!!employeeDocId && raw === employeeDocId);
  }
  return false;
}

export function filterJobsListByDataScope<T extends JobListRow>(
  allJobs: T[] | null | undefined,
  seeAllOrgJobs: boolean,
  userUid: string | undefined,
  employeeDocId?: string | undefined
): T[] {
  const list = Array.isArray(allJobs) ? allJobs : [];
  if (seeAllOrgJobs) return list;
  const uid = userUid ?? "";
  return list.filter((j) => jobAssignsToUser(j, uid, employeeDocId));
}
