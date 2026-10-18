/**
 * Sloučení globálního katalogu `platform_modules` s výchozími hodnotami z kódu.
 * Menu a licence firmy musí vycházet z org. dokumentu; při chybějícím explicitním
 * oprávnění se použije globální katalog (superadmin / Moduly).
 */

import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { DEFAULT_PLATFORM_MODULES, PLATFORM_MODULE_CODES } from "@/lib/platform-config";
import { createPendingCompanyLicense } from "@/lib/company-license-record";

export type PlatformModuleCatalogRow = {
  activeGlobally: boolean;
  defaultEnabled: boolean;
  name: string;
  description: string;
  basePriceCzk: number;
  priceMonthly: number;
  currency: string;
  billingPeriod: "monthly" | "yearly";
  isPaid: boolean;
  billingType: "per_company" | "per_employee" | "flat";
  configurableBySuperadmin: boolean;
  employeePriceCzk?: number;
  moduleKind?: "internal" | "external";
  externalId?: string;
  appUrl?: string;
  apiUrl?: string;
  iconKey?: string;
  navOrder?: number;
  category?: string;
  licenseModel?: "organization" | "per_user" | "org_seats" | "custom";
  priceYearly?: number;
  yearlyDiscountPercent?: number;
  trialDays?: number;
  maxUserLicenses?: number;
  defaultSeatCount?: number;
  vatRate?: number;
  integrationStatus?: string;
};

function defRow(code: PlatformModuleCode): PlatformModuleCatalogRow {
  const def = DEFAULT_PLATFORM_MODULES.find((m) => m.code === code);
  return {
    activeGlobally: Boolean(def?.activeGlobally),
    defaultEnabled: Boolean(def?.defaultEnabled),
    name: def?.name ?? code,
    description: def?.description ?? "",
    basePriceCzk: def?.basePriceCzk ?? 0,
    priceMonthly: def?.priceMonthly ?? def?.basePriceCzk ?? 0,
    currency: def?.currency ?? "CZK",
    billingPeriod: def?.billingPeriod ?? "monthly",
    isPaid: def?.isPaid ?? true,
    billingType: def?.billingType ?? "per_company",
    configurableBySuperadmin: def?.configurableBySuperadmin ?? true,
    employeePriceCzk: def?.employeePriceCzk,
    moduleKind: def?.moduleKind ?? "internal",
    externalId: def?.externalId,
    appUrl: def?.appUrl,
    apiUrl: def?.apiUrl,
    iconKey: def?.iconKey,
    navOrder: def?.navOrder,
    category: def?.category,
    licenseModel: def?.licenseModel ?? "organization",
    priceYearly: def?.priceYearly,
    yearlyDiscountPercent: def?.yearlyDiscountPercent,
    trialDays: def?.trialDays,
    maxUserLicenses: def?.maxUserLicenses,
    defaultSeatCount: def?.defaultSeatCount,
    vatRate: def?.vatRate,
    integrationStatus: def?.integrationStatus,
  };
}

/** Výchozí mapa z kódu — když Firestore ještě nic nemá nebo provider chybí. */
export function defaultPlatformCatalogMap(): Record<PlatformModuleCode, PlatformModuleCatalogRow> {
  const out = {} as Record<PlatformModuleCode, PlatformModuleCatalogRow>;
  for (const code of PLATFORM_MODULE_CODES) {
    out[code] = defRow(code);
  }
  return out;
}

function numOr(
  v: unknown,
  fallback: number
): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function billingPeriodOr(
  v: unknown,
  fallback: "monthly" | "yearly"
): "monthly" | "yearly" {
  return v === "yearly" ? "yearly" : fallback;
}

/** Sloučení dokumentů `platform_modules/{code}` s DEFAULT_PLATFORM_MODULES. */
export function buildMergedPlatformCatalogMap(
  firestoreDocs: Array<{ id: string } & Record<string, unknown>>
): Record<PlatformModuleCode, PlatformModuleCatalogRow> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const d of firestoreDocs) {
    byId.set(d.id, d);
  }
  const out = {} as Record<PlatformModuleCode, PlatformModuleCatalogRow>;
  for (const code of PLATFORM_MODULE_CODES) {
    const doc = byId.get(code);
    const base = defRow(code);
    const basePrice = doc ? numOr(doc.basePriceCzk, base.basePriceCzk) : base.basePriceCzk;
    const priceMonthly = doc
      ? numOr(
          doc.priceMonthly !== undefined && doc.priceMonthly !== null
            ? doc.priceMonthly
            : doc.basePriceCzk,
          base.priceMonthly
        )
      : base.priceMonthly;
    out[code] = {
      activeGlobally:
        doc && typeof doc.activeGlobally === "boolean"
          ? doc.activeGlobally
          : base.activeGlobally,
      defaultEnabled:
        doc && typeof doc.defaultEnabled === "boolean"
          ? doc.defaultEnabled
          : base.defaultEnabled,
      name: doc ? strOr(doc.name, base.name) : base.name,
      description: doc ? strOr(doc.description, base.description) : base.description,
      basePriceCzk: basePrice,
      priceMonthly: priceMonthly !== undefined && Number.isFinite(priceMonthly) ? priceMonthly : basePrice,
      currency: doc ? strOr(doc.currency, base.currency) : base.currency,
      billingPeriod: doc ? billingPeriodOr(doc.billingPeriod, base.billingPeriod) : base.billingPeriod,
      isPaid:
        doc && typeof doc.isPaid === "boolean"
          ? doc.isPaid
          : base.isPaid,
      billingType:
        doc &&
        (doc.billingType === "per_company" ||
          doc.billingType === "per_employee" ||
          doc.billingType === "flat")
          ? doc.billingType
          : base.billingType,
      configurableBySuperadmin:
        doc && typeof doc.configurableBySuperadmin === "boolean"
          ? doc.configurableBySuperadmin
          : base.configurableBySuperadmin,
      employeePriceCzk:
        doc && doc.employeePriceCzk !== undefined && doc.employeePriceCzk !== null
          ? numOr(doc.employeePriceCzk, base.employeePriceCzk ?? 0)
          : base.employeePriceCzk,
      moduleKind:
        doc && (doc.moduleKind === "external" || doc.moduleKind === "internal")
          ? doc.moduleKind
          : base.moduleKind,
      externalId: doc ? strOr(doc.externalId, base.externalId ?? "") || undefined : base.externalId,
      appUrl: doc ? strOr(doc.appUrl, base.appUrl ?? "") || undefined : base.appUrl,
      apiUrl: doc ? strOr(doc.apiUrl, base.apiUrl ?? "") || undefined : base.apiUrl,
      iconKey: doc ? strOr(doc.iconKey, base.iconKey ?? "") || undefined : base.iconKey,
      navOrder: doc ? numOr(doc.navOrder, base.navOrder ?? 0) : base.navOrder,
      category: doc ? strOr(doc.category, base.category ?? "") || undefined : base.category,
      licenseModel:
        doc &&
        (doc.licenseModel === "organization" ||
          doc.licenseModel === "per_user" ||
          doc.licenseModel === "org_seats" ||
          doc.licenseModel === "custom")
          ? doc.licenseModel
          : base.licenseModel,
      priceYearly: doc ? numOr(doc.priceYearly, base.priceYearly ?? 0) : base.priceYearly,
      yearlyDiscountPercent: doc
        ? numOr(doc.yearlyDiscountPercent, base.yearlyDiscountPercent ?? 0)
        : base.yearlyDiscountPercent,
      trialDays: doc ? numOr(doc.trialDays, base.trialDays ?? 0) : base.trialDays,
      maxUserLicenses: doc
        ? numOr(doc.maxUserLicenses, base.maxUserLicenses ?? 0)
        : base.maxUserLicenses,
      defaultSeatCount: doc
        ? numOr(doc.defaultSeatCount, base.defaultSeatCount ?? 0)
        : base.defaultSeatCount,
      vatRate: doc ? numOr(doc.vatRate, base.vatRate ?? 21) : base.vatRate,
      integrationStatus: doc
        ? strOr(doc.integrationStatus, base.integrationStatus ?? "unknown")
        : base.integrationStatus,
    };
  }
  return out;
}

/**
 * Počáteční licence při registraci firmy — explicitní `modules` podle globálního katalogu.
 * Varianta A: výchozí stav z globálního admina; superadmin u organizace může později přepsat.
 */
export function companyLicenseFromCatalogForNewOrg(
  companyId: string,
  catalog: Record<PlatformModuleCode, PlatformModuleCatalogRow>
): CompanyLicenseDoc {
  const base = createPendingCompanyLicense(companyId);
  const modules: CompanyLicenseDoc["modules"] = { ...base.modules };
  const enabledModules: PlatformModuleCode[] = [];
  for (const code of PLATFORM_MODULE_CODES) {
    const row = catalog[code];
    const active = Boolean(row.activeGlobally && row.defaultEnabled);
    modules[code] = {
      moduleCode: code,
      active,
      activatedAt: null,
      expiresAt: null,
      customPriceCzk: null,
    };
    if (active) enabledModules.push(code);
  }
  return { ...base, modules, enabledModules };
}
