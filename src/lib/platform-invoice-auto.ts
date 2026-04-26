/**
 * Automatické řádky faktury provozovatele z licence organizace a ceníku v platform_settings + platform_modules.
 */
import type { Firestore } from "firebase-admin/firestore";
import {
  COMPANY_LICENSES_COLLECTION,
  COMPANIES_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
  PLATFORM_INVOICES_COLLECTION,
  PLATFORM_SETTINGS_COLLECTION,
} from "@/lib/firestore-collections";
import { PLATFORM_PRICING_DOC, PLATFORM_SETTINGS_DOC } from "@/lib/platform-config";
import type { CompanyLicenseDoc, PlatformModuleCode } from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES, isModuleEntitlementActiveNow } from "@/lib/platform-config";
import { companyDocPlatformFields } from "@/lib/company-license-record";
import {
  applyExpiredLicenseStatus,
  ensureCompanyLicenseDoc,
  normalizeLegacyWarehouseModule,
} from "@/lib/company-license-admin";
import type { CompanyPlatformFields } from "@/lib/platform-access";
import { isPlatformModuleEnabledForOrganization } from "@/lib/platform-access";
import { buildMergedPlatformCatalogMap } from "@/lib/platform-module-catalog";
import type { PlatformInvoiceLineInput } from "@/lib/platform-billing";

export type PlatformPricingDoc = {
  baseLicenseMonthlyCzk: number;
  defaultVatPercent: number;
  automationDefaultIntervalDays: number;
  automationDefaultDueDays: number;
};

const DEFAULT_PRICING: PlatformPricingDoc = {
  baseLicenseMonthlyCzk: 0,
  defaultVatPercent: 21,
  automationDefaultIntervalDays: 30,
  automationDefaultDueDays: 14,
};

export async function loadPlatformPricingDoc(db: Firestore): Promise<PlatformPricingDoc> {
  const snap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_PRICING_DOC).get();
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  return {
    baseLicenseMonthlyCzk: Math.max(0, num(d.baseLicenseMonthlyCzk, DEFAULT_PRICING.baseLicenseMonthlyCzk)),
    defaultVatPercent: Math.max(0, num(d.defaultVatPercent, DEFAULT_PRICING.defaultVatPercent)),
    automationDefaultIntervalDays: Math.max(
      1,
      Math.round(num(d.automationDefaultIntervalDays, DEFAULT_PRICING.automationDefaultIntervalDays))
    ),
    automationDefaultDueDays: Math.max(
      1,
      Math.round(num(d.automationDefaultDueDays, DEFAULT_PRICING.automationDefaultDueDays))
    ),
  };
}

export async function loadDefaultEmployeePriceCzk(db: Firestore): Promise<number> {
  const snap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_SETTINGS_DOC).get();
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const n = Number(d.defaultEmployeePriceCzk);
  return Number.isFinite(n) && n >= 0 ? n : 49;
}

export async function loadMergedCatalogFromFirestore(db: Firestore) {
  const snap = await db.collection(PLATFORM_MODULES_COLLECTION).get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return buildMergedPlatformCatalogMap(docs);
}

/** Zaměstnanci s `isActive === false` se nezapočítávají; chybějící pole považujeme za aktivní. */
export async function countBillableCompanyEmployees(db: Firestore, companyId: string): Promise<number> {
  const coll = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("employees");
  try {
    const [totalAgg, inactiveAgg] = await Promise.all([
      coll.count().get(),
      coll.where("isActive", "==", false).count().get(),
    ]);
    const total = totalAgg.data().count ?? 0;
    const inactive = inactiveAgg.data().count ?? 0;
    return Math.max(0, total - inactive);
  } catch {
    return 0;
  }
}

/** @deprecated Prefer `countBillableCompanyEmployees` (bez neaktivních profilů). */
export async function countCompanyEmployees(db: Firestore, companyId: string): Promise<number> {
  return countBillableCompanyEmployees(db, companyId);
}

export function mergeCompanyWithLicenseDenorm(
  companyRow: Record<string, unknown>,
  license: CompanyLicenseDoc
): CompanyPlatformFields {
  const denorm = companyDocPlatformFields(license);
  return { ...(companyRow as CompanyPlatformFields), ...denorm };
}

/**
 * Položky faktury podle aktivních modulů a ceníku (bez natvrdo vypočtených cen mimo pricing + platform_modules).
 */
export function buildAutomaticPlatformInvoiceLineInputs(input: {
  platformCompany: CompanyPlatformFields;
  license: CompanyLicenseDoc;
  catalog: ReturnType<typeof buildMergedPlatformCatalogMap>;
  pricing: PlatformPricingDoc;
  defaultEmployeePriceCzk: number;
  employeeCount: number;
  periodFrom: string;
  periodTo: string;
  extraItems?: PlatformInvoiceLineInput[];
}): PlatformInvoiceLineInput[] {
  const { platformCompany, license, catalog, pricing, defaultEmployeePriceCzk, employeeCount } = input;
  const vat = pricing.defaultVatPercent;
  const lines: PlatformInvoiceLineInput[] = [];

  const base = pricing.baseLicenseMonthlyCzk;
  if (base > 0) {
    lines.push({
      kind: "platform_license",
      description: `Základní licence platformy (${input.periodFrom} – ${input.periodTo})`,
      quantity: 1,
      unit: "měs.",
      unitPriceNet: Math.round(base * 100) / 100,
      vatRate: vat,
    });
  }

  for (const code of PLATFORM_MODULE_CODES) {
    if (!isPlatformModuleEnabledForOrganization(platformCompany, code)) continue;
    const ent = license.modules[code];
    if (ent && !isModuleEntitlementActiveNow(ent)) continue;
    const row = catalog[code];
    if (!row || !row.isPaid) continue;

    const custom =
      ent && ent.customPriceCzk != null && Number.isFinite(Number(ent.customPriceCzk))
        ? Number(ent.customPriceCzk)
        : null;

    if (row.billingType === "per_employee") {
      const per =
        Number(row.employeePriceCzk) >= 0 && Number.isFinite(Number(row.employeePriceCzk))
          ? Number(row.employeePriceCzk)
          : defaultEmployeePriceCzk;
      const qty = Math.max(0, employeeCount);
      if (qty <= 0 || per <= 0) continue;
      lines.push({
        kind: "employees",
        description: `${row.name} — příplatek za uživatele (${qty} × ${per} Kč bez DPH / měs.)`,
        quantity: qty,
        unit: "osoba",
        unitPriceNet: Math.round(per * 100) / 100,
        vatRate: vat,
      });
      continue;
    }

    const unit = custom != null ? custom : Number(row.priceMonthly);
    if (!Number.isFinite(unit) || unit <= 0) continue;
    lines.push({
      kind: "modules",
      description: `${row.name} (${input.periodFrom} – ${input.periodTo})`,
      quantity: 1,
      unit: "měs.",
      unitPriceNet: Math.round(unit * 100) / 100,
      vatRate: vat,
    });
  }

  const extra = Array.isArray(input.extraItems) ? input.extraItems : [];
  for (const x of extra) {
    if (!x || typeof x.description !== "string") continue;
    lines.push({ ...x, kind: x.kind || "custom" });
  }

  return lines;
}

export async function loadLicenseAndCompanyForAutoInvoice(
  db: Firestore,
  organizationId: string
): Promise<{
  companyRow: Record<string, unknown>;
  license: CompanyLicenseDoc;
  platformCompany: CompanyPlatformFields;
  employeeCount: number;
}> {
  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
  if (!companySnap.exists) throw new Error("Organizace (companies) neexistuje.");
  const companyRow = companySnap.data() as Record<string, unknown>;
  let license = await ensureCompanyLicenseDoc(db, organizationId);
  license = applyExpiredLicenseStatus(normalizeLegacyWarehouseModule(license));
  const employeeCount = await countBillableCompanyEmployees(db, organizationId);
  const platformCompany = mergeCompanyWithLicenseDenorm(companyRow, license);
  return { companyRow, license, platformCompany, employeeCount };
}

export async function platformInvoiceExistsForPeriod(
  db: Firestore,
  organizationId: string,
  periodFrom: string,
  periodTo: string
): Promise<boolean> {
  const snap = await db
    .collection(PLATFORM_INVOICES_COLLECTION)
    .where("organizationId", "==", organizationId)
    .limit(120)
    .get();
  return snap.docs.some((d) => {
    const data = d.data() as { status?: string; periodFrom?: string; periodTo?: string };
    if (String(data.periodFrom || "") !== periodFrom || String(data.periodTo || "") !== periodTo) {
      return false;
    }
    const st = String(data.status || "unpaid");
    return st !== "cancelled" && st !== "canceled";
  });
}

export type BillingAutomationState = {
  enabled: boolean;
  intervalDays: number;
  nextIssueDate: string | null;
  dueDays: number;
  lastIssuedAt: string | null;
  sendEmail: boolean;
};

export function normalizeBillingAutomation(
  raw: unknown,
  defaults: { intervalDays: number; dueDays: number }
): BillingAutomationState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const intervalDays = Math.max(
    1,
    Math.round(Number(o.intervalDays ?? defaults.intervalDays) || defaults.intervalDays)
  );
  const dueDays = Math.max(1, Math.round(Number(o.dueDays ?? defaults.dueDays) || defaults.dueDays));
  const next =
    typeof o.nextIssueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.nextIssueDate)
      ? o.nextIssueDate.slice(0, 10)
      : null;
  const last =
    typeof o.lastIssuedAt === "string" && o.lastIssuedAt ? o.lastIssuedAt.slice(0, 10) : null;
  return {
    enabled: o.enabled === true,
    intervalDays,
    nextIssueDate: next,
    dueDays,
    lastIssuedAt: last,
    sendEmail: o.sendEmail === true,
  };
}

export function addCalendarDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate.slice(0, 10) + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function billingAutomationFirestorePayload(
  state: BillingAutomationState
): Record<string, unknown> {
  return {
    billingAutomation: {
      enabled: state.enabled,
      intervalDays: state.intervalDays,
      nextIssueDate: state.nextIssueDate,
      dueDays: state.dueDays,
      lastIssuedAt: state.lastIssuedAt,
      sendEmail: state.sendEmail,
    },
    billingAutomationEnabled: state.enabled === true,
    billingAutomationNextIssueDate: state.enabled && state.nextIssueDate ? state.nextIssueDate : "",
  };
}
