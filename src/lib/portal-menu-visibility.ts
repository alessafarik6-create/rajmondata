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
import { normalizeCompanyRole } from "@/lib/company-privilege";
import {
  explainFleetMenuHiddenReason,
  FLEET_PORTAL_MODULE_ID,
  isFleetMenuLicensed,
} from "@/lib/portal-menu-fleet-access";
import { resolveCameraPermissions } from "@/lib/hikvision/camera-access";

function portalMenuRoleAllowed(def: PortalSidebarMenuDef, role: string): boolean {
  const r = normalizeCompanyRole(role);
  return def.roles.some((allowed) => normalizeCompanyRole(allowed) === r);
}

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

  if (!portalMenuRoleAllowed(def, role)) return false;

  const normalizedRole = normalizeCompanyRole(role);

  if (def.id === "activity") {
    const elevated =
      normalizedRole === "owner" ||
      normalizedRole === "admin" ||
      normalizedRole === "accountant" ||
      (Array.isArray(globalRoles) && globalRoles.includes("super_admin"));
    if (!elevated) return false;
  }

  if (def.id === "meetingRecords") {
    if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) {
      // super admin vidí položku bez ohledu na příznak zaměstnance
    } else if (normalizedRole === "employee") {
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

  if (def.id === FLEET_PORTAL_MODULE_ID && def.type === "module") {
    if (!isFleetMenuLicensed({ role, globalRoles, company, effectiveModules })) {
      return false;
    }
  } else if (def.type === "module" || def.type === "child") {
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
    if (def.platformModuleCode === "cameras" || def.id === "cameras") {
      const cam = resolveCameraPermissions({
        role,
        globalRoles,
        employeeDoc: employeeRow,
      });
      if (!cam.view) return false;
    }
  }

  return true;
}

/** Dev diagnostika — proč je položka skrytá (bez citlivých dat). */
export function debugPortalMenuItemHiddenReason(
  def: PortalSidebarMenuDef,
  ctx: PortalMenuVisibilityCtx,
  permissionReadOk: boolean
): string | null {
  if (def.id === FLEET_PORTAL_MODULE_ID) {
    const fleetReason = explainFleetMenuHiddenReason({
      role: ctx.role,
      globalRoles: ctx.globalRoles,
      company: ctx.company,
      effectiveModules: ctx.effectiveModules,
      rolesAllowed: def.roles,
      licenseRevoked: isLicenseExplicitlyRevokedForPortal(ctx.company),
    });
    if (fleetReason !== "visible") return fleetReason;
    if (!permissionReadOk) return "permission_fleet_none";
    return null;
  }
  if (!isPortalMenuItemVisible(def, ctx)) return "visibility_filter";
  if (!permissionReadOk) return "permission_read";
  return null;
}
