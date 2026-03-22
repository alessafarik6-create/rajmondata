import type { PlatformModuleCode } from "@/lib/platform-config";
import { isModuleEntitlementActiveNow } from "@/lib/platform-config";

/** Firestore dokument firmy (část) — platformLicense / moduleEntitlements z denormalizace. */
export type CompanyPlatformFields = {
  active?: boolean;
  isActive?: boolean;
  platformLicense?: {
    active?: boolean;
    status?: string;
    expiresAt?: string | null;
  };
  moduleEntitlements?: Record<
    string,
    { active?: boolean; expiresAt?: string | null; activatedAt?: string | null }
  >;
};

export function isCompanyLicenseBlocking(company: CompanyPlatformFields | null | undefined): boolean {
  if (!company) return true;
  const pl = company.platformLicense;
  if (!pl) {
    return company.isActive === false || company.active === false;
  }
  if (pl.status === "pending") return true;
  if (pl.status === "expired") return true;
  if (!pl.active) return true;
  if (pl.expiresAt) {
    const t = Date.parse(pl.expiresAt);
    if (!Number.isNaN(t) && t <= Date.now()) return true;
  }
  return false;
}

export function hasActiveModuleAccess(
  company: CompanyPlatformFields | null | undefined,
  moduleCode: PlatformModuleCode
): boolean {
  if (!company) return false;
  /** Staré dokumenty bez platformLicense — zachovat přístup, pokud je účet aktivní. */
  if (!company.platformLicense) {
    return company.isActive !== false && company.active !== false;
  }
  if (isCompanyLicenseBlocking(company)) return false;
  const ent = company.moduleEntitlements?.[moduleCode];
  return isModuleEntitlementActiveNow(
    ent
      ? {
          moduleCode,
          active: Boolean(ent.active),
          activatedAt: ent.activatedAt ?? null,
          expiresAt: ent.expiresAt ?? null,
          customPriceCzk: null,
        }
      : undefined
  );
}
