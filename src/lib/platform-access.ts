import type { PlatformModuleCode } from "@/lib/platform-config";
import { isModuleEntitlementActiveNow } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import { defaultPlatformCatalogMap } from "@/lib/platform-module-catalog";
import type { OrganizationLicenseRecord } from "@/lib/organization-license";
import {
  getCompanyLicenseModules,
  isCompanyLicenseActive,
  isModuleEnabledForPlatformFromLegacyKeys,
  platformModuleCodeToOrgLicenseModuleKey,
  shouldShowLicensePendingNotice,
} from "@/lib/organization-license";

/** Firestore dokument firmy — primárně `license`; doplňkově denorm z `company_licenses`. */
export type CompanyPlatformFields = {
  active?: boolean;
  isActive?: boolean;
  license?: OrganizationLicenseRecord;
  platformLicense?: {
    active?: boolean;
    status?: string;
    expiresAt?: string | null;
  };
  moduleEntitlements?: Record<
    string,
    { active?: boolean; expiresAt?: string | null; activatedAt?: string | null }
  >;
};

/**
 * Fallback: legacy `license.status === active` při `platformLicense.status === pending`
 * (starší nesync mezi zápisy).
 */
export function getEffectivePlatformLicense(
  company: CompanyPlatformFields | null | undefined
): CompanyPlatformFields["platformLicense"] | undefined {
  if (!company) return undefined;
  const pl = company.platformLicense;
  const leg = company.license;
  const raw = leg?.status ?? leg?.licenseStatus;
  const legacy = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (pl && pl.status === "pending" && legacy === "active") {
    return {
      ...pl,
      active: true,
      status: "active",
    };
  }
  return pl;
}

export function isCompanyLicenseBlocking(company: CompanyPlatformFields | null | undefined): boolean {
  if (!company) return true;

  if (isCompanyLicenseActive(company)) return false;

  const lic = company.license;
  const raw = lic?.status ?? lic?.licenseStatus;
  if (lic && typeof lic === "object" && raw != null && String(raw).trim() !== "") {
    return true;
  }

  const pl = getEffectivePlatformLicense(company);
  if (!pl) {
    return company.isActive === false || company.active === false;
  }
  if (pl.status === "pending") return true;
  if (pl.status === "expired") return true;
  if (!pl.active) return true;
  if (pl.expiresAt) {
    const t = Date.parse(pl.expiresAt);
    if (!Number.isNaN(t) && t <= Date.now()) return true;
  }
  return false;
}

function orgHasExplicitModuleEntitlement(
  company: CompanyPlatformFields,
  moduleCode: PlatformModuleCode
): boolean {
  const m = company.moduleEntitlements;
  if (!m || typeof m !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(m, moduleCode)) return true;
  if (moduleCode === "sklad" && Object.prototype.hasOwnProperty.call(m, "warehouse")) return true;
  return false;
}

function getOrgModuleEntitlementRecord(
  company: CompanyPlatformFields,
  moduleCode: PlatformModuleCode
):
  | { active?: boolean; expiresAt?: string | null; activatedAt?: string | null }
  | undefined {
  const m = company.moduleEntitlements;
  if (!m) return undefined;
  if (moduleCode in m) return m[moduleCode];
  if (moduleCode === "sklad" && "warehouse" in m) return m["warehouse"];
  return undefined;
}

/**
 * Přístup k modulu: nejdřív `license.modules` / `license.enabledModules`,
 * pak `moduleEntitlements` + katalog.
 */
export function hasActiveModuleAccess(
  company: CompanyPlatformFields | null | undefined,
  moduleCode: PlatformModuleCode,
  globalCatalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  if (!company) return false;
  if (isCompanyLicenseBlocking(company)) return false;

  if (!company.platformLicense) {
    if (!isCompanyLicenseActive(company)) {
      return company.isActive !== false && company.active !== false;
    }
  }

  const orgKey = platformModuleCodeToOrgLicenseModuleKey(moduleCode);
  const lic = company.license;
  const mods = getCompanyLicenseModules(company);
  if (orgKey) {
    if (mods && Object.prototype.hasOwnProperty.call(mods, orgKey)) {
      return Boolean(mods[orgKey]);
    }
    if (Array.isArray(lic?.enabledModules)) {
      return isModuleEnabledForPlatformFromLegacyKeys(lic.enabledModules, moduleCode);
    }
    if (isCompanyLicenseActive(company)) {
      return false;
    }
  }

  const catalog =
    globalCatalog != null && Object.keys(globalCatalog).length > 0
      ? { ...defaultPlatformCatalogMap(), ...globalCatalog }
      : defaultPlatformCatalogMap();

  const explicit = orgHasExplicitModuleEntitlement(company, moduleCode);
  const entRaw = getOrgModuleEntitlementRecord(company, moduleCode);
  const globalRow = catalog[moduleCode];

  let result: boolean;
  if (explicit && entRaw) {
    result = isModuleEntitlementActiveNow({
      moduleCode,
      active: Boolean(entRaw.active),
      activatedAt: entRaw.activatedAt ?? null,
      expiresAt: entRaw.expiresAt ?? null,
      customPriceCzk: null,
    });
  } else if (explicit) {
    result = false;
  } else {
    result = Boolean(globalRow?.activeGlobally);
  }

  return result;
}

/** `isActive && moduleEnabled` — jednotné pro sidebar / guard. */
export function canAccessOrganizationModule(
  company: CompanyPlatformFields | null | undefined,
  moduleCode: PlatformModuleCode,
  globalCatalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  return !isCompanyLicenseBlocking(company) && hasActiveModuleAccess(company, moduleCode, globalCatalog);
}

export { getCompanyLicenseModules, isCompanyLicenseActive, shouldShowLicensePendingNotice };

/** Alias podle názvosloví „company“ v portálu. */
export const canAccessCompanyModule = canAccessOrganizationModule;
