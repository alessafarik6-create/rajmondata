import type { CompanyLicenseDoc, ModuleEntitlement, PlatformModuleCode } from "@/lib/platform-config";
import { isModuleEntitlementActiveNow } from "@/lib/platform-config";
import type { PlatformModuleCatalogRow } from "@/lib/platform-module-catalog";

export type ModuleAccessDecision =
  | { ok: true; reason: "active" | "trial" | "grace" }
  | { ok: false; reason: "inactive" | "expired" | "suspended" | "no_seat" | "not_assigned" };

export function resolveModuleEntitlement(
  license: CompanyLicenseDoc | null | undefined,
  moduleCode: PlatformModuleCode
): ModuleEntitlement | undefined {
  return license?.modules?.[moduleCode];
}

export function canOrganizationUseModule(
  license: CompanyLicenseDoc | null | undefined,
  moduleCode: PlatformModuleCode
): ModuleAccessDecision {
  const ent = resolveModuleEntitlement(license, moduleCode);
  if (!ent) return { ok: false, reason: "inactive" };
  if (ent.tenantModuleStatus === "suspended") return { ok: false, reason: "suspended" };
  if (!isModuleEntitlementActiveNow(ent)) {
    if (ent.expiresAt && Date.parse(ent.expiresAt) <= Date.now()) return { ok: false, reason: "expired" };
    return { ok: false, reason: "inactive" };
  }
  if (ent.isTrial) return { ok: true, reason: "trial" };
  if (ent.tenantModuleStatus === "pendingConfirmation") return { ok: true, reason: "grace" };
  return { ok: true, reason: "active" };
}

export function canUserUseModuleWithSeats(input: {
  orgDecision: ModuleAccessDecision;
  licenseModel: PlatformModuleCatalogRow["licenseModel"];
  assignedUserIds: string[];
  userId: string;
  seatCount: number;
}): ModuleAccessDecision {
  if (!input.orgDecision.ok) return input.orgDecision;
  if (input.licenseModel === "organization") return input.orgDecision;
  if (input.licenseModel === "per_user" || input.licenseModel === "org_seats") {
    if (!input.assignedUserIds.includes(input.userId)) {
      return { ok: false, reason: "not_assigned" };
    }
    if (input.licenseModel === "org_seats" && input.assignedUserIds.length > input.seatCount) {
      return { ok: false, reason: "no_seat" };
    }
  }
  return input.orgDecision;
}

export function effectiveModulePriceCzk(
  ent: ModuleEntitlement | undefined,
  catalog: PlatformModuleCatalogRow,
  billingPeriod: "monthly" | "yearly" = "monthly"
): number {
  if (ent?.customPriceCzk != null && Number.isFinite(ent.customPriceCzk)) {
    return ent.customPriceCzk;
  }
  if (billingPeriod === "yearly" && catalog.priceYearly && catalog.priceYearly > 0) {
    return catalog.priceYearly;
  }
  return catalog.priceMonthly ?? catalog.basePriceCzk ?? 0;
}
