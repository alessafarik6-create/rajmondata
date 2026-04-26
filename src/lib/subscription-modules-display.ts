/**
 * Přehled aktivních modulů organizace pro sekci Předplatné (ceny z katalogu platform_modules).
 */

import type {
  CompanyLicenseDoc,
  ModuleEntitlement,
  PlatformModuleCode,
} from "@/lib/platform-config";
import { PLATFORM_MODULE_CODES, isModuleEntitlementActiveNow } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";
import type { CompanyPlatformFields } from "@/lib/platform-access";
import { isPlatformModuleEnabledForOrganization } from "@/lib/platform-access";
export type SubscriptionModuleLine = {
  moduleCode: PlatformModuleCode;
  name: string;
  statusLabel: string;
  priceLabel: string;
  currency: string;
  /** Měsíční částka v měně modulu, pokud ji lze spočítat (jinak null). */
  monthlyAmount: number | null;
  isPaid: boolean;
};

export type BuildSubscriptionModuleLinesOptions = {
  /** Počet zaměstnanců bez `isActive === false` — pro moduly typu per_employee. */
  billableEmployeeCount?: number | null;
};

function fmtMoney(n: number, currency: string): string {
  if (!Number.isFinite(n)) return "—";
  if (currency === "CZK") {
    return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
  }
  return `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} ${currency}`;
}

export function buildSubscriptionModuleLines(
  company: CompanyPlatformFields,
  catalog: Record<PlatformModuleCode, PlatformModuleCatalogRow>,
  licenseDoc: CompanyLicenseDoc | null | undefined,
  opts?: BuildSubscriptionModuleLinesOptions
): SubscriptionModuleLine[] {
  const lines: SubscriptionModuleLine[] = [];
  for (const code of PLATFORM_MODULE_CODES) {
    if (!isPlatformModuleEnabledForOrganization(company, code)) continue;
    const row = catalog[code];
    const ent = licenseDoc?.modules?.[code];
    const entitlementOk =
      !ent || isModuleEntitlementActiveNow(ent as Parameters<typeof isModuleEntitlementActiveNow>[0]);

    const custom =
      ent && ent.customPriceCzk != null && Number.isFinite(Number(ent.customPriceCzk))
        ? Number(ent.customPriceCzk)
        : null;

    if (!row) continue;

    if (!row.isPaid) {
      lines.push({
        moduleCode: code,
        name: row.name,
        statusLabel: "Aktivní",
        priceLabel: "Zdarma",
        currency: row.currency,
        monthlyAmount: 0,
        isPaid: false,
      });
      continue;
    }

    if (row.billingType === "per_employee") {
      const per = row.employeePriceCzk ?? 0;
      const cnt =
        opts?.billableEmployeeCount != null && Number.isFinite(opts.billableEmployeeCount)
          ? Math.max(0, Math.round(Number(opts.billableEmployeeCount)))
          : null;
      const monthlyFromLicense =
        code === "attendance_payroll"
          ? licenseDoc?.employeePricing?.monthlyModuleCzk ?? null
          : null;
      const monthlyFromCount =
        cnt != null && row.currency === "CZK" && Number.isFinite(per) ? Math.round(per * cnt * 100) / 100 : null;
      const monthly =
        monthlyFromCount != null
          ? monthlyFromCount
          : monthlyFromLicense != null && Number.isFinite(monthlyFromLicense)
            ? monthlyFromLicense
            : null;
      const priceLabel =
        cnt != null && row.currency === "CZK"
          ? `${fmtMoney(per, row.currency)} × ${cnt} = ${fmtMoney(monthlyFromCount ?? per * cnt, row.currency)} / měsíc`
          : `${fmtMoney(per, row.currency)} / zaměstnanec / měsíc`;
      lines.push({
        moduleCode: code,
        name: row.name,
        statusLabel: "Aktivní",
        priceLabel,
        currency: row.currency,
        monthlyAmount: monthly,
        isPaid: true,
      });
      continue;
    }

    const unit = custom != null ? custom : row.priceMonthly;
    const missing =
      custom == null &&
      (row.priceMonthly === undefined ||
        row.priceMonthly === null ||
        !Number.isFinite(Number(row.priceMonthly)));

    lines.push({
      moduleCode: code,
      name: row.name,
      statusLabel: "Aktivní",
      priceLabel: missing
        ? "Cena není nastavena"
        : `${fmtMoney(unit, row.currency)} / měsíc`,
      currency: row.currency,
      monthlyAmount: missing ? null : Number(unit),
      isPaid: true,
    });
  }
  return lines;
}

export function sumSubscriptionMonthlyCzk(lines: SubscriptionModuleLine[]): {
  total: number | null;
  partial: boolean;
} {
  let total = 0;
  let partial = false;
  let counted = 0;
  for (const l of lines) {
    if (!l.isPaid) continue;
    if (l.monthlyAmount == null || l.currency !== "CZK") {
      partial = true;
      continue;
    }
    total += l.monthlyAmount;
    counted += 1;
  }
  if (counted === 0 && partial) return { total: null, partial: true };
  return { total, partial };
}
