/**
 * Individuální moduly zaměstnaneckého portálu (merge: licence organizace ∩ příznaky na employees/{id}).
 */

import type { PlatformModuleCode } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import {
  canAccessCompanyModule,
  getEffectiveModulesMerged,
  type CompanyPlatformFields,
} from "@/lib/platform-access";
import { isModuleKeyEnabled } from "@/lib/license-modules";
import { isCompanyLicenseActive } from "@/lib/organization-license";

export type EmployeePortalModuleKey =
  | "zakazky"
  | "penize"
  | "zpravy"
  | "dochazka";

export type EmployeePortalModules = Record<EmployeePortalModuleKey, boolean>;

/** Výchozí při chybějícím dokumentu — chování jako dosud (vše povoleno, pak se zužuje org + přepínači). */
export const DEFAULT_EMPLOYEE_PORTAL_MODULES: EmployeePortalModules = {
  zakazky: true,
  penize: true,
  zpravy: true,
  dochazka: true,
};

const PORTAL_MODULE_KEYS: readonly EmployeePortalModuleKey[] = [
  "zakazky",
  "penize",
  "zpravy",
  "dochazka",
];

/**
 * Čte `employeePortalModules` z companies/.../employees/{id}.
 * `undefined` (klíč v dokumentu chybí) → výchozí z DEFAULT_EMPLOYEE_PORTAL_MODULES.
 * explicitní `false` / `true` v dokumentu → zachováno.
 */
export function parseEmployeePortalModules(
  employeeDoc: Record<string, unknown> | null | undefined
): EmployeePortalModules {
  const raw = employeeDoc?.employeePortalModules;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_EMPLOYEE_PORTAL_MODULES };
  }
  const o = raw as Record<string, unknown>;
  const out: EmployeePortalModules = { ...DEFAULT_EMPLOYEE_PORTAL_MODULES };
  for (const k of PORTAL_MODULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      out[k] = o[k] === true;
    }
  }
  return out;
}

export type OrgEmployeePortalModuleFlags = EmployeePortalModules;

/**
 * Co organizace může v zaměstnaneckém portálu nabídnout (licence + platformní modul).
 * - zakazky: platformní `jobs` + klíč licence `zakazky`
 * - penize: platformní `invoicing` + finance / faktury / doklady
 * - zpravy: aktivní licence firmy (interně není samostatný klíč v licence-modules)
 * - dochazka: platformní `attendance_payroll` + klíč `dochazka`
 */
export function getOrgEmployeePortalModuleFlags(
  company: CompanyPlatformFields | null | undefined,
  platformCatalog:
    | Partial<Record<PlatformModuleCode, PlatformModuleCatalogRow>>
    | null
    | undefined
): OrgEmployeePortalModuleFlags {
  if (!company) {
    return {
      zakazky: false,
      penize: false,
      zpravy: false,
      dochazka: false,
    };
  }
  const effective = getEffectiveModulesMerged(company);
  const zakazky =
    canAccessCompanyModule(company, "jobs", platformCatalog) &&
    isModuleKeyEnabled(effective, "zakazky");
  const penize =
    canAccessCompanyModule(company, "invoicing", platformCatalog) &&
    (isModuleKeyEnabled(effective, "finance") ||
      isModuleKeyEnabled(effective, "faktury") ||
      isModuleKeyEnabled(effective, "doklady"));
  const zpravy = isCompanyLicenseActive(company);
  const dochazka =
    canAccessCompanyModule(company, "attendance_payroll", platformCatalog) &&
    isModuleKeyEnabled(effective, "dochazka");

  return { zakazky, penize, zpravy, dochazka };
}

export function computeVisibleEmployeePortalModules(
  org: OrgEmployeePortalModuleFlags,
  employee: EmployeePortalModules
): EmployeePortalModules {
  return {
    zakazky: org.zakazky && employee.zakazky,
    penize: org.penize && employee.penize,
    zpravy: org.zpravy && employee.zpravy,
    dochazka: org.dochazka && employee.dochazka,
  };
}
