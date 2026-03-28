import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import { COMPANY_LICENSES_COLLECTION } from "@/lib/firestore-collections";
import type { ModuleKey } from "@/lib/license-modules";
import { buildOrganizationLicenseModulesFromModuleKeys } from "@/lib/organization-license";

export { COMPANY_LICENSES_COLLECTION };

/** Mapování kódů platformních modulů na legacy klíče v `license-modules` (menu / starší části). */
export function platformCodesToLegacyModuleKeys(codes: PlatformModuleCode[]): ModuleKey[] {
  const out: ModuleKey[] = [];
  for (const c of codes) {
    if (c === "attendance_payroll") out.push("attendance");
    else if (c === "invoicing") out.push("invoices");
    else if (c === "jobs") out.push("jobs");
    else if (c === "sklad") out.push("sklad");
    else if (c === "vyroba") out.push("vyroba");
  }
  return [...new Set(out)];
}

/** Legacy checkboxy v superadmin „Organizace“ → stav platformních modulů v `company_licenses`. */
const LEGACY_KEYS_FOR_PLATFORM: { [K in PlatformModuleCode]?: readonly ModuleKey[] } = {
  attendance_payroll: ["attendance", "mobile_terminal"],
  invoicing: ["invoices", "finance", "documents"],
  jobs: ["jobs"],
  sklad: ["sklad"],
  vyroba: ["vyroba"],
};

export function buildPlatformModulesSyncFromLegacy(
  enabled: ModuleKey[]
): Partial<Record<PlatformModuleCode, { active: boolean }>> {
  const set = new Set(enabled);
  const out: Partial<Record<PlatformModuleCode, { active: boolean }>> = {};
  for (const code of PLATFORM_MODULE_CODES) {
    const keys = LEGACY_KEYS_FOR_PLATFORM[code];
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
  const legacyEnabled = platformCodesToLegacyModuleKeys(license.enabledModules);
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
  return {
    platformLicense: {
      active: license.active,
      status: license.status,
      expiresAt: license.expiresAt,
      activatedAt: license.activatedAt,
      activatedBy: license.activatedBy,
    },
    moduleEntitlements: entitlements,
    enabledModuleIds: legacyEnabled,
    license: {
      licenseType: "starter",
      status: licenseStatusForPortal,
      expirationDate: license.expiresAt,
      maxUsers: null,
      enabledModules: legacyEnabled,
      modules: buildOrganizationLicenseModulesFromModuleKeys(legacyEnabled),
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
