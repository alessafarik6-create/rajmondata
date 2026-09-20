/**
 * Vozový park — jednotná logika licence (vozovyPark) vs. menu id (fleet).
 * Kanonický licenční klíč: vozovyPark (viz license-modules.ts).
 * Kanonické portal module id: fleet (viz portal-menu-config.ts).
 */

import { normalizeCompanyRole } from "@/lib/company-privilege";
import {
  isCanonicalModuleExplicitInCompany,
  type CanonicalModuleKey,
} from "@/lib/license-modules";
import { licenseKeysSatisfied } from "@/lib/portal-menu-config";
import type { CompanyPlatformFields } from "@/lib/platform-access";

export const FLEET_LICENSE_KEY: CanonicalModuleKey = "vozovyPark";
export const FLEET_PORTAL_MODULE_ID = "fleet" as const;

export function isFleetLicensedForOrganization(
  effectiveModules: Record<string, boolean>
): boolean {
  return licenseKeysSatisfied([FLEET_LICENSE_KEY], effectiveModules);
}

/** Owner/admin vidí Vozový park, pokud modul není výslovně vypnutý v licenci organizace. */
export function isFleetMenuLicensed(
  ctx: {
    role: string;
    globalRoles?: string[] | null;
    company: CompanyPlatformFields | null | undefined;
    effectiveModules: Record<string, boolean>;
  }
): boolean {
  if (isFleetLicensedForOrganization(ctx.effectiveModules)) return true;

  const r = normalizeCompanyRole(ctx.role);
  const superAdmin = Array.isArray(ctx.globalRoles) && ctx.globalRoles.includes("super_admin");
  const elevated = superAdmin || r === "owner" || r === "admin";

  if (!elevated || !ctx.company) return false;

  if (isCanonicalModuleExplicitInCompany(ctx.company, FLEET_LICENSE_KEY)) {
    return Boolean(ctx.effectiveModules[FLEET_LICENSE_KEY]);
  }

  return true;
}

export type FleetMenuHiddenReason =
  | "visible"
  | "role"
  | "no_company"
  | "license_revoked"
  | "license_vozovyPark"
  | "platform_module";

export function explainFleetMenuHiddenReason(ctx: {
  role: string;
  globalRoles?: string[] | null;
  company: CompanyPlatformFields | null | undefined;
  effectiveModules: Record<string, boolean>;
  rolesAllowed: readonly string[];
  licenseRevoked: boolean;
}): FleetMenuHiddenReason {
  if (!ctx.rolesAllowed.includes(ctx.role)) return "role";
  if (!ctx.company) return "no_company";
  if (ctx.licenseRevoked) return "license_revoked";
  if (!isFleetMenuLicensed(ctx)) return "license_vozovyPark";
  return "visible";
}
