import type { PlatformModuleCode } from "@/lib/platform-config";
import { isModuleEntitlementActiveNow } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import { defaultPlatformCatalogMap } from "@/lib/platform-module-catalog";

/** Firestore dokument firmy (část) — platformLicense / moduleEntitlements z denormalizace. */
export type CompanyPlatformFields = {
  active?: boolean;
  isActive?: boolean;
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

export function isCompanyLicenseBlocking(company: CompanyPlatformFields | null | undefined): boolean {
  if (!company) return true;
  const pl = company.platformLicense;
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
 * Přístup k modulu v portálu.
 * Primárně z dokumentu organizace (`moduleEntitlements` z `company_licenses`).
 * Pokud u daného kódu chybí explicitní záznam → fallback na globální katalog (`platform_modules` + výchozí z kódu).
 */
export function hasActiveModuleAccess(
  company: CompanyPlatformFields | null | undefined,
  moduleCode: PlatformModuleCode,
  globalCatalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  if (!company) return false;
  /** Staré dokumenty bez platformLicense — zachovat přístup, pokud je účet aktivní. */
  if (!company.platformLicense) {
    return company.isActive !== false && company.active !== false;
  }
  if (isCompanyLicenseBlocking(company)) return false;

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
