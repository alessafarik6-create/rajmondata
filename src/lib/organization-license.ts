import type { ModuleKey } from "@/lib/license-modules";
import type { PlatformModuleCode } from "@/lib/platform-config";

/**
 * Jednotný model licence na dokumentu organizace / firmy (`license` ve Firestore).
 * Superadmin ukládá `status` + `modules`; portál z toho primárně čte.
 */
export type OrganizationLicenseModules = {
  jobs: boolean;
  attendance: boolean;
  finance: boolean;
  sklad: boolean;
  vyroba: boolean;
};

export type OrganizationLicenseRecord = {
  status?: string;
  licenseStatus?: string;
  expirationDate?: string | null;
  licenseExpiresAt?: string | null;
  enabledModules?: string[];
  modules?: Partial<OrganizationLicenseModules> | Record<string, boolean>;
};

export function buildOrganizationLicenseModulesFromModuleKeys(
  enabled: readonly ModuleKey[]
): OrganizationLicenseModules {
  const set = new Set(enabled);
  return {
    jobs: set.has("jobs"),
    attendance: set.has("attendance") || set.has("mobile_terminal"),
    finance: set.has("finance") || set.has("invoices") || set.has("documents"),
    sklad: set.has("sklad"),
    vyroba: set.has("vyroba"),
  };
}

export function platformModuleCodeToOrgLicenseModuleKey(
  code: PlatformModuleCode
): keyof OrganizationLicenseModules | null {
  if (code === "jobs") return "jobs";
  if (code === "attendance_payroll") return "attendance";
  if (code === "invoicing") return "finance";
  if (code === "sklad") return "sklad";
  if (code === "vyroba") return "vyroba";
  return null;
}

export function isModuleEnabledForPlatformFromLegacyKeys(
  enabledModules: string[] | undefined,
  moduleCode: PlatformModuleCode
): boolean {
  const set = new Set(enabledModules ?? []);
  switch (moduleCode) {
    case "jobs":
      return set.has("jobs");
    case "attendance_payroll":
      return set.has("attendance") || set.has("mobile_terminal");
    case "invoicing":
      return set.has("invoices") || set.has("finance") || set.has("documents");
    case "sklad":
      return set.has("sklad");
    case "vyroba":
      return set.has("vyroba");
    default:
      return false;
  }
}

/** Portál: licence je aktivní podle záznamu `organization.license` / `companies.license`. */
export function isOrganizationLicenseRecordActive(
  company: { license?: OrganizationLicenseRecord | null } | null | undefined
): boolean {
  const lic = company?.license;
  if (!lic || typeof lic !== "object") return false;
  const s = String(lic.status ?? lic.licenseStatus ?? "")
    .trim()
    .toLowerCase();
  if (s !== "active") return false;
  const exp = lic.expirationDate ?? lic.licenseExpiresAt;
  if (exp != null && String(exp).trim() !== "") {
    const t = Date.parse(String(exp));
    if (!Number.isNaN(t) && t <= Date.now()) return false;
  }
  return true;
}
