import {
  canAccessCompanyModule,
  isLicenseExplicitlyRevokedForPortal,
  type CompanyPlatformFields,
} from "@/lib/platform-access";
import {
  userCanAccessProductionPortal,
  userCanAccessWarehousePortal,
} from "@/lib/warehouse-production-access";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import type { PlatformModuleCode } from "@/lib/platform-config";
import {
  licenseKeysSatisfied,
  parentLicenseKeysSatisfied,
  type PortalSidebarMenuDef,
} from "@/lib/portal-menu-config";

export type PortalMenuVisibilityCtx = {
  role: string;
  globalRoles: string[] | undefined;
  company: CompanyPlatformFields | null | undefined;
  effectiveModules: Record<string, boolean>;
  platformCatalog: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null | undefined;
  employeeRow: Record<string, unknown> | null;
};

export function isPortalMenuItemVisible(
  def: PortalSidebarMenuDef,
  ctx: PortalMenuVisibilityCtx
): boolean {
  const { role, globalRoles, company, effectiveModules, platformCatalog, employeeRow } = ctx;

  if (!def.roles.includes(role)) return false;

  if (def.id === "activity") {
    const elevated =
      role === "owner" ||
      role === "admin" ||
      role === "accountant" ||
      (Array.isArray(globalRoles) && globalRoles.includes("super_admin"));
    if (!elevated) return false;
  }

  if (def.id === "meetingRecords") {
    if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) {
      // super admin vidí položku bez ohledu na příznak zaměstnance
    } else if (role === "employee") {
      const row = employeeRow as { canAccessMeetingNotes?: boolean } | null;
      if (row?.canAccessMeetingNotes !== true) return false;
    }
  }

  if (def.type === "system") return true;

  if (!company) return false;

  if (isLicenseExplicitlyRevokedForPortal(company)) return false;

  if (def.type === "child") {
    if (!parentLicenseKeysSatisfied(def.parentLicenseKeys, effectiveModules)) return false;
  }

  if (def.type === "module" || def.type === "child") {
    if (def.type === "module" && !licenseKeysSatisfied(def.licenseKeys, effectiveModules)) {
      return false;
    }
    if (
      def.type === "child" &&
      def.licenseKeys?.length &&
      !licenseKeysSatisfied(def.licenseKeys, effectiveModules)
    ) {
      return false;
    }
  }

  if (def.platformModuleCode) {
    if (!canAccessCompanyModule(company, def.platformModuleCode, platformCatalog ?? undefined)) {
      return false;
    }
    if (def.platformModuleCode === "sklad") {
      return userCanAccessWarehousePortal({
        role,
        globalRoles,
        employeeRow: employeeRow as { canAccessWarehouse?: boolean } | null,
      });
    }
    if (def.platformModuleCode === "vyroba") {
      return userCanAccessProductionPortal({
        role,
        globalRoles,
        employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
      });
    }
  }

  return true;
}
