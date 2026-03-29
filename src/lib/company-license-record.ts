import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import { COMPANY_LICENSES_COLLECTION } from "@/lib/firestore-collections";
import {
  buildCanonicalModulesMapFromEnabled,
  type CanonicalModuleKey,
  type ModuleKey,
} from "@/lib/license-modules";

export { COMPANY_LICENSES_COLLECTION };

/** Mapování platformních modulů na kanonické klíče ve Firestore. */
export function platformCodesToCanonicalModuleKeys(
  codes: PlatformModuleCode[]
): CanonicalModuleKey[] {
  const out: CanonicalModuleKey[] = [];
  for (const c of codes) {
    if (c === "jobs") out.push("zakazky");
    else if (c === "attendance_payroll")
      out.push("dochazka", "terminal", "reporty");
    else if (c === "invoicing") out.push("faktury", "doklady", "finance");
    else if (c === "sklad") out.push("sklad");
    else if (c === "vyroba") out.push("vyroba");
  }
  return [...new Set(out)];
}

/** @deprecated Použij platformCodesToCanonicalModuleKeys. */
export const platformCodesToLegacyModuleKeys = platformCodesToCanonicalModuleKeys;

const CANONICAL_KEYS_FOR_PLATFORM: {
  [K in PlatformModuleCode]?: readonly CanonicalModuleKey[];
} = {
  attendance_payroll: ["dochazka", "terminal", "reporty"],
  invoicing: ["faktury", "finance", "doklady"],
  jobs: ["zakazky"],
  sklad: ["sklad"],
  vyroba: ["vyroba"],
};

export function buildPlatformModulesSyncFromLegacy(
  enabled: ModuleKey[]
): Partial<Record<PlatformModuleCode, { active: boolean }>> {
  const set = new Set(enabled);
  const out: Partial<Record<PlatformModuleCode, { active: boolean }>> = {};
  for (const code of PLATFORM_MODULE_CODES) {
    const keys = CANONICAL_KEYS_FOR_PLATFORM[code];
    if (!keys) continue;
    out[code] = { active: keys.some((k) => set.has(k)) };
  }
  return out;
}

export function createPendingCompanyLicense(companyId: string): CompanyLicenseDoc {
  return {
    companyId,
    active: false,
    status: "pending",
    activatedAt: null,
    expiresAt: null,
    activatedBy: null,
    notes: "",
    enabledModules: [],
    modules: {},
    pricingSnapshot: {},
    employeePricing: {
      perEmployeeCzk: 49,
      moduleCode: "attendance_payroll",
      lastEmployeeCount: 0,
      monthlyModuleCzk: 0,
    },
  };
}

export function companyDocPlatformFields(license: CompanyLicenseDoc) {
  const entitlements: Record<
    string,
    { active: boolean; expiresAt: string | null; activatedAt: string | null }
  > = {};
  for (const [k, v] of Object.entries(license.modules)) {
    entitlements[k] = {
      active: v.active,
      expiresAt: v.expiresAt,
      activatedAt: v.activatedAt,
    };
  }
  const canonicalEnabled = platformCodesToCanonicalModuleKeys(license.enabledModules);
  const licenseStatusForPortal =
    license.status === "pending"
      ? "pending"
      : license.status === "expired"
        ? "expired"
        : license.status === "suspended"
          ? "suspended"
          : license.active
            ? "active"
            : "inactive";
  const modulesFlat = buildCanonicalModulesMapFromEnabled(canonicalEnabled);
  return {
    platformLicense: {
      active: license.active,
      status: license.status,
      expiresAt: license.expiresAt,
      activatedAt: license.activatedAt,
      activatedBy: license.activatedBy,
    },
    moduleEntitlements: entitlements,
    enabledModuleIds: canonicalEnabled,
    modules: modulesFlat,
    license: {
      licenseType: "starter",
      status: licenseStatusForPortal,
      expirationDate: license.expiresAt,
      maxUsers: null,
      enabledModules: canonicalEnabled,
      modules: modulesFlat,
    },
  };
}

export function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function emptyModuleEntitlement(
  code: PlatformModuleCode
): CompanyLicenseDoc["modules"][string] {
  return {
    moduleCode: code,
    active: false,
    activatedAt: null,
    expiresAt: null,
    customPriceCzk: null,
  };
}
