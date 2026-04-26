/**
 * Globální licence, moduly a ceny platformy (spravuje superadmin).
 */

export const PLATFORM_SEO_DOC = "home";
export const PLATFORM_SETTINGS_DOC = "default";
/** Fakturační údaje provozovatele platformy (superadmin). */
export const PLATFORM_BILLING_PROVIDER_DOC = "billingProvider";
/** Ceník platformy (základní licence, DPH, výchozí automatická fakturace). */
export const PLATFORM_PRICING_DOC = "pricing";

/**
 * Stabilní ID dokumentů v `platform_modules/{code}` a v licenci (`enabledModules`).
 * Kanonické klíče menu (`zakazky`, `dochazka`, `faktury`, …) jsou mapované v
 * `company-license-record` / `platform-access` — dokumenty ve Firestore se nemění.
 */
export const PLATFORM_MODULE_CODES = [
  "attendance_payroll",
  "invoicing",
  "jobs",
  "sklad",
  "vyroba",
] as const;

export type PlatformModuleCode = (typeof PLATFORM_MODULE_CODES)[number];

export type CompanyLicenseStatus = "pending" | "active" | "suspended" | "expired";

export type PlatformModuleDef = {
  code: PlatformModuleCode;
  name: string;
  description: string;
  activeGlobally: boolean;
  defaultEnabled: boolean;
  /** Základní cena firmy / měsíc (Kč) — zarovnáno s priceMonthly při měně CZK. */
  basePriceCzk: number;
  /** Cena za měsíc (zobrazování a předplatné); výchozí = basePriceCzk. */
  priceMonthly: number;
  currency: string;
  billingPeriod: "monthly" | "yearly";
  /** Zda se modul účtuje jako placený (false = zdarma v přehledu předplatného). */
  isPaid: boolean;
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
    priceMonthly: 0,
    currency: "CZK",
    billingPeriod: "monthly",
    isPaid: true,
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
    priceMonthly: 299,
    currency: "CZK",
    billingPeriod: "monthly",
    isPaid: true,
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
    priceMonthly: 199,
    currency: "CZK",
    billingPeriod: "monthly",
    isPaid: true,
    billingType: "per_company",
    configurableBySuperadmin: true,
  },
  {
    code: "sklad",
    name: "Sklad",
    description: "Skladové položky, naskladnění, vyskladnění a historie pohybů.",
    activeGlobally: true,
    defaultEnabled: false,
    basePriceCzk: 399,
    priceMonthly: 399,
    currency: "CZK",
    billingPeriod: "monthly",
    isPaid: true,
    billingType: "per_company",
    configurableBySuperadmin: true,
  },
  {
    code: "vyroba",
    name: "Výroba",
    description: "Výrobní záznamy, zakázky, materiál ze skladu a podklady.",
    activeGlobally: true,
    defaultEnabled: false,
    basePriceCzk: 399,
    priceMonthly: 399,
    currency: "CZK",
    billingPeriod: "monthly",
    isPaid: true,
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
      return ["/portal/documents", "/portal/invoices", "/portal/finance"];
    case "jobs":
      return ["/portal/jobs", "/portal/leads"];
    case "sklad":
      return ["/portal/sklad"];
    case "vyroba":
      return ["/portal/vyroba"];
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
