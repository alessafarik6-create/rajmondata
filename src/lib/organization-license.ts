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

function licenseExpirationIsPast(exp: unknown): boolean {
  if (exp == null) return false;
  if (typeof exp === "string" && exp.trim() === "") return false;
  let ms: number | null = null;
  if (
    typeof exp === "object" &&
    exp !== null &&
    "toMillis" in exp &&
    typeof (exp as { toMillis: () => number }).toMillis === "function"
  ) {
    ms = (exp as { toMillis: () => number }).toMillis();
  } else if (
    typeof exp === "object" &&
    exp !== null &&
    typeof (exp as { seconds?: number }).seconds === "number"
  ) {
    ms = (exp as { seconds: number }).seconds * 1000;
  } else {
    const t = Date.parse(String(exp));
    ms = Number.isNaN(t) ? null : t;
  }
  return ms != null && ms <= Date.now();
}

export type CompanyLicenseEvaluationInput = {
  license?: OrganizationLicenseRecord | null;
  platformLicense?: {
    active?: boolean;
    status?: string;
    expiresAt?: string | null;
  } | null;
};

/**
 * Jednotné „je firma licenčně aktivní“ pro portál:
 * 1) explicitní negace v `license.status`
 * 2) `license.status === active` (+ expirace)
 * 3) fallback na `platformLicense` z denorm (`company_licenses`) — když `license` chybí / je neúplný
 */
export function isCompanyLicenseActive(
  company: CompanyLicenseEvaluationInput | null | undefined
): boolean {
  const lic = company?.license;
  if (lic && typeof lic === "object") {
    const s = String(lic.status ?? lic.licenseStatus ?? "")
      .trim()
      .toLowerCase();
    if (s === "pending" || s === "suspended" || s === "expired" || s === "inactive") {
      return false;
    }
    if (s === "active") {
      return !licenseExpirationIsPast(lic.expirationDate ?? lic.licenseExpiresAt);
    }
  }

  const pl = company?.platformLicense;
  if (pl && typeof pl === "object") {
    const ps = String(pl.status ?? "").trim().toLowerCase();
    if (ps === "pending" || ps === "expired" || ps === "suspended") return false;
    if (pl.active === false) return false;
    if (ps === "active" || pl.active === true) {
      return !licenseExpirationIsPast(pl.expiresAt);
    }
  }

  return false;
}

/** @deprecated Stejné jako isCompanyLicenseActive — ponecháno kvůli importům v kódu. */
export function isOrganizationLicenseRecordActive(
  company: CompanyLicenseEvaluationInput | null | undefined
): boolean {
  return isCompanyLicenseActive(company);
}

/** Moduly z `license.modules` (po merge dokumentů). */
export function getCompanyLicenseModules(
  company: { license?: OrganizationLicenseRecord | null } | null | undefined
): Record<string, boolean> {
  const m = company?.license?.modules;
  if (m && typeof m === "object") return m as Record<string, boolean>;
  return {};
}

/**
 * Banner „čeká na schválení“ jen když licence opravdu není aktivní, ale stav je pending
 * (ne když je firma aktivní podle platformLicense, ale chybí pole license.status).
 */
export function shouldShowLicensePendingNotice(
  company: CompanyLicenseEvaluationInput | null | undefined
): boolean {
  if (!company) return false;
  if (isCompanyLicenseActive(company)) return false;
  const lic = company.license;
  const ls = String(lic?.status ?? lic?.licenseStatus ?? "").toLowerCase();
  if (ls === "pending") return true;
  const hasLicenseStatusField =
    lic &&
    typeof lic === "object" &&
    ((lic.status != null && String(lic.status).trim() !== "") ||
      (lic.licenseStatus != null && String(lic.licenseStatus).trim() !== ""));
  if (!hasLicenseStatusField && company.platformLicense?.status === "pending") {
    return true;
  }
  return false;
}
