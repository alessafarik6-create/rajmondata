import type { PlatformModuleCode } from "@/lib/platform-config";
import { isModuleEntitlementActiveNow } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import { defaultPlatformCatalogMap } from "@/lib/platform-module-catalog";
import {
  MODULE_KEYS,
  ORG_MENU_MODULE_KEYS,
  buildMergedFirestoreModulesMap,
  expandModuleRecordAliases,
  orMergeModuleRecords,
  type ModuleKey,
} from "@/lib/license-modules";
import type { OrganizationLicenseRecord } from "@/lib/organization-license";
import {
  getCompanyLicenseModules,
  isCompanyLicenseActive,
  isModuleEnabledForPlatformFromLegacyKeys,
  platformModuleCodeToOrgLicenseModuleKey,
  shouldShowLicensePendingNotice,
} from "@/lib/organization-license";

/** Firestore dokument firmy — `modules` (top-level) z superadmina; doplňkově `license` / `company_licenses`. */
export type CompanyPlatformFields = {
  active?: boolean;
  isActive?: boolean;
  /** Top-level mapa modulů na `companies` / `společnosti` (klíče jako v superadmin Organizace). */
  modules?: Record<string, boolean>;
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

/** Menu: české klíče (`zakazky`, …) nebo anglické z licence / superadminu (včetně aliasů po expand). */
function isPlatformModuleEnabledFromModuleMap(
  m: Record<string, boolean>,
  moduleCode: PlatformModuleCode
): boolean {
  switch (moduleCode) {
    case "jobs":
      return Boolean(m.zakazky ?? m.jobs);
    case "attendance_payroll":
      return Boolean(
        m.dochazka ||
          m.terminal ||
          m.attendance ||
          m.mobile_terminal ||
          m.reporty ||
          m.reports
      );
    case "invoicing":
      return Boolean(
        m.faktury || m.doklady || m.finance || m.invoices || m.documents
      );
    case "sklad":
      return Boolean(m.sklad);
    case "vyroba":
      return Boolean(m.vyroba);
    default:
      return false;
  }
}

function moduleKeysFromNestedLicenseMods(mods: Record<string, boolean>): ModuleKey[] {
  const out: ModuleKey[] = [];
  if (mods.jobs) out.push("jobs");
  if (mods.attendance) out.push("attendance", "mobile_terminal");
  if (mods.finance) out.push("finance", "invoices", "documents");
  if (mods.sklad) out.push("sklad");
  if (mods.vyroba) out.push("vyroba");
  return out;
}

/**
 * Vrstva z licence: `license.modules` (včetně cizích klíčů) + `enabledModules` + odvozené z nested polí (OR).
 */
function buildLicenseDerivedModuleLayer(company: CompanyPlatformFields): Record<string, boolean> {
  const nested = getCompanyLicenseModules(company);
  const rawFlat: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(nested)) {
    if (typeof v === "boolean") rawFlat[k] = v;
  }
  const parts: Record<string, boolean>[] = [rawFlat];
  const en = company.license?.enabledModules;
  if (Array.isArray(en) && en.length > 0) {
    const valid = en.filter((x): x is ModuleKey =>
      (MODULE_KEYS as readonly string[]).includes(x)
    );
    if (valid.length > 0) {
      parts.push(buildMergedFirestoreModulesMap(valid));
    }
  }
  const keysFromNested = moduleKeysFromNestedLicenseMods(nested);
  if (keysFromNested.length > 0) {
    parts.push(buildMergedFirestoreModulesMap(keysFromNested));
  }
  return orMergeModuleRecords(...parts);
}

/**
 * Jednotná mapa: `{ ...licenseVrstva, ...organization.modules }` + aliasy.
 * Organizace (`companies` / `společnosti` top-level `modules`) přepisuje shodné klíče z licence.
 */
export function getEffectiveModulesMerged(
  company: CompanyPlatformFields | null | undefined
): Record<string, boolean> {
  if (!company) return {};
  const fromLicense = buildLicenseDerivedModuleLayer(company);
  const org =
    company.modules && typeof company.modules === "object"
      ? (company.modules as Record<string, boolean>)
      : {};
  return expandModuleRecordAliases({ ...fromLicense, ...org });
}

/** Licence výslovně neplatná pro moduly portálu (ne „pending“ — ten nesmí schovat zapnuté moduly z admina). */
export function isLicenseExplicitlyRevokedForPortal(
  company: CompanyPlatformFields | null | undefined
): boolean {
  if (!company) return false;
  const s = String(company.license?.status ?? company.license?.licenseStatus ?? "")
    .trim()
    .toLowerCase();
  return s === "expired" || s === "suspended" || s === "inactive";
}

/** Pro sidebar / debug: `effectiveModules` + výchozí false u známých klíčů. */
export function getResolvedMenuModules(
  company: CompanyPlatformFields | null | undefined
): Record<string, boolean> {
  const empty: Record<string, boolean> = {};
  for (const k of MODULE_KEYS) empty[k] = false;
  for (const k of ORG_MENU_MODULE_KEYS) empty[k] = false;
  if (!company) return empty;
  const r = getEffectiveModulesMerged(company);
  return { ...empty, ...r };
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
 * Přístup k modulu: sloučené `license` + top-level `modules` organizace;
 * při zapnutém modulu neblokuje jen kvůli `platformLicense.pending` (moduly ze superadmina zůstanou vidět).
 */
export function hasActiveModuleAccess(
  company: CompanyPlatformFields | null | undefined,
  moduleCode: PlatformModuleCode,
  globalCatalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  if (!company) return false;

  const effective = getEffectiveModulesMerged(company);
  if (isPlatformModuleEnabledFromModuleMap(effective, moduleCode)) {
    return !isLicenseExplicitlyRevokedForPortal(company);
  }

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

/** Jednotné pro sidebar / guard — blokace licence se uplatní až ve `hasActiveModuleAccess` (po kontrole effective modulů). */
export function canAccessOrganizationModule(
  company: CompanyPlatformFields | null | undefined,
  moduleCode: PlatformModuleCode,
  globalCatalog?: Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>> | null
): boolean {
  return hasActiveModuleAccess(company, moduleCode, globalCatalog);
}

export { getCompanyLicenseModules, isCompanyLicenseActive, shouldShowLicensePendingNotice };

/** Alias podle názvosloví „company“ v portálu. */
export const canAccessCompanyModule = canAccessOrganizationModule;
