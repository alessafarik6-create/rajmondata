/**
 * Přístup ke skladu a výrobě: vlastník / admin / manažer, nebo zaměstnanec s příznakem na záznamu employees/{id}.
 */

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
  if (["owner", "admin", "manager"].includes(params.role)) return true;
  if (params.role === "employee" && params.employeeRow?.canAccessWarehouse === true) {
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
  if (["owner", "admin", "manager"].includes(params.role)) return true;
  if (params.role === "employee" && params.employeeRow?.canAccessProduction === true) {
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
  return ["owner", "admin", "manager"].includes(params.role);
}
