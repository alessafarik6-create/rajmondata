/**
 * Globální licence, moduly a ceny platformy (spravuje superadmin).
 */

export const PLATFORM_SEO_DOC = "home";
export const PLATFORM_SETTINGS_DOC = "default";

export const PLATFORM_MODULE_CODES = [
  "attendance_payroll",
  "invoicing",
  "jobs",
  "warehouse",
] as const;

export type PlatformModuleCode = (typeof PLATFORM_MODULE_CODES)[number];

export type CompanyLicenseStatus = "pending" | "active" | "suspended" | "expired";

export type PlatformModuleDef = {
  code: PlatformModuleCode;
  name: string;
  description: string;
  activeGlobally: boolean;
  defaultEnabled: boolean;
  basePriceCzk: number;
  billingType: "per_company" | "per_employee" | "flat";
  configurableBySuperadmin: boolean;
  /** Pouze u attendance_payroll — cena za zaměstnance / měsíc */
  employeePriceCzk?: number;
};

export const DEFAULT_PLATFORM_MODULES: PlatformModuleDef[] = [
  {
    code: "attendance_payroll",
    name: "Docházka, práce a mzdy",
    description: "Docházka, výkazy, výplaty a tarify.",
    activeGlobally: true,
    defaultEnabled: false,
    basePriceCzk: 0,
    billingType: "per_employee",
    configurableBySuperadmin: true,
    employeePriceCzk: 49,
  },
  {
    code: "invoicing",
    name: "Fakturace",
    description: "Vystavování a správa faktur.",
    activeGlobally: true,
    defaultEnabled: false,
    basePriceCzk: 299,
    billingType: "per_company",
    configurableBySuperadmin: true,
  },
  {
    code: "jobs",
    name: "Zakázky",
    description: "Správa zakázek a projektů.",
    activeGlobally: true,
    defaultEnabled: false,
    basePriceCzk: 199,
    billingType: "per_company",
    configurableBySuperadmin: true,
  },
  {
    code: "warehouse",
    name: "Sklady",
    description: "Skladové hospodářství.",
    activeGlobally: true,
    defaultEnabled: false,
    basePriceCzk: 399,
    billingType: "per_company",
    configurableBySuperadmin: true,
  },
];

export type ModuleEntitlement = {
  moduleCode: PlatformModuleCode;
  active: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  customPriceCzk: number | null;
};

export type CompanyLicenseDoc = {
  companyId: string;
  active: boolean;
  status: CompanyLicenseStatus;
  activatedAt: string | null;
  expiresAt: string | null;
  activatedBy: string | null;
  notes: string;
  enabledModules: PlatformModuleCode[];
  modules: Record<string, ModuleEntitlement>;
  pricingSnapshot: Record<string, unknown>;
  employeePricing: {
    perEmployeeCzk: number;
    moduleCode: PlatformModuleCode;
    lastEmployeeCount: number;
    monthlyModuleCzk: number;
  };
  updatedAt?: unknown;
  createdAt?: unknown;
};

export type PlatformSettingsDoc = {
  defaultEmployeePriceCzk: number;
  landingHeadline: string;
  landingSubline: string;
  promoNote: string;
  updatedAt?: unknown;
};

export type SeoSettingsDoc = {
  pageKey: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  ogTitle: string;
  ogDescription: string;
  canonicalUrl: string;
  landingLead: string;
  updatedAt?: unknown;
};

/** Mapování modulu platformy na cesty portálu (pro skrytí menu). */
export function portalPathsForModule(code: PlatformModuleCode): string[] {
  switch (code) {
    case "attendance_payroll":
      return ["/portal/labor", "/portal/attendance"];
    case "invoicing":
      return ["/portal/invoices"];
    case "jobs":
      return ["/portal/jobs"];
    case "warehouse":
      return ["/portal/warehouse"];
    default:
      return [];
  }
}

export function isModuleEntitlementActiveNow(m: ModuleEntitlement | undefined): boolean {
  if (!m || !m.active) return false;
  if (!m.expiresAt) return true;
  const t = Date.parse(m.expiresAt);
  if (Number.isNaN(t)) return true;
  return t > Date.now();
}
