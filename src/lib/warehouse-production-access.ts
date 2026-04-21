/**
 * Přístup ke skladu a výrobě: vlastník / admin / manažer, nebo zaměstnanec s příznakem na záznamu employees/{id}.
 */

import { normalizeCompanyRole } from "@/lib/company-privilege";

export type EmployeeModuleFlags = {
  canAccessWarehouse?: boolean;
  canAccessProduction?: boolean;
};

export function userCanAccessWarehousePortal(params: {
  role: string;
  globalRoles?: string[] | null;
  employeeRow?: EmployeeModuleFlags | null;
}): boolean {
  if (Array.isArray(params.globalRoles) && params.globalRoles.includes("super_admin")) {
    return true;
  }
  const r = normalizeCompanyRole(params.role);
  if (["owner", "admin", "manager"].includes(r)) return true;
  if (r === "employee" && params.employeeRow?.canAccessWarehouse === true) {
    return true;
  }
  return false;
}

export function userCanAccessProductionPortal(params: {
  role: string;
  globalRoles?: string[] | null;
  employeeRow?: EmployeeModuleFlags | null;
}): boolean {
  if (Array.isArray(params.globalRoles) && params.globalRoles.includes("super_admin")) {
    return true;
  }
  const r = normalizeCompanyRole(params.role);
  if (["owner", "admin", "manager"].includes(r)) return true;
  if (r === "employee" && params.employeeRow?.canAccessProduction === true) {
    return true;
  }
  return false;
}

/**
 * Úprava / měkké smazání skladových položek — pouze vlastník, admin nebo manažer (ne běžný zaměstnanec se skladem).
 */
export function userCanManageWarehouseInventory(params: {
  role: string;
  globalRoles?: string[] | null;
}): boolean {
  if (Array.isArray(params.globalRoles) && params.globalRoles.includes("super_admin")) {
    return true;
  }
  const r = normalizeCompanyRole(params.role);
  return ["owner", "admin", "manager"].includes(r);
}
