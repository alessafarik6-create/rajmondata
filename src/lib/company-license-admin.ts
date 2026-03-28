import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type {
  CompanyLicenseDoc,
  CompanyLicenseStatus,
  PlatformModuleCode,
} from "@/lib/platform-config";
import {
  DEFAULT_PLATFORM_MODULES,
  PLATFORM_MODULE_CODES,
  isModuleEntitlementActiveNow,
} from "@/lib/platform-config";
import {
  addDaysIso,
  companyDocPlatformFields,
  createPendingCompanyLicense,
  emptyModuleEntitlement,
} from "@/lib/company-license-record";
import { COMPANY_LICENSES_COLLECTION } from "@/lib/firestore-collections";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";

function isPlatformModuleCode(s: string): s is PlatformModuleCode {
  return (PLATFORM_MODULE_CODES as readonly string[]).includes(s);
}

export type PlatformLicensePatchPayload = {
  active?: boolean;
  status?: CompanyLicenseStatus;
  expiresAt?: string | null;
  /** Prodlouží platnost o N dní od max(dnes, aktuální konec). */
  extendDays?: number;
  notes?: string;
  activatedBy?: string | null;
};

export type ModulePatchPayload = {
  active?: boolean;
  /** Aktivace modulu na N dní od teď (přepíše expiresAt). */
  days?: number;
  customPriceCzk?: number | null;
};

export type CompanyLicenseUpdatePayload = {
  platformLicense?: PlatformLicensePatchPayload;
  modules?: Partial<Record<string, ModulePatchPayload>>;
  employeePricing?: { perEmployeeCzk?: number };
};

function recalcAttendancePricing(license: CompanyLicenseDoc): CompanyLicenseDoc {
  const n = license.employeePricing.lastEmployeeCount;
  const per = license.employeePricing.perEmployeeCzk;
  return {
    ...license,
    employeePricing: {
      ...license.employeePricing,
      monthlyModuleCzk: Math.max(0, n) * Math.max(0, per),
    },
  };
}

export function mergeCompanyLicenseUpdate(
  existing: CompanyLicenseDoc,
  patch: CompanyLicenseUpdatePayload,
  nowIso: string
): CompanyLicenseDoc {
  let next: CompanyLicenseDoc = { ...existing, modules: { ...existing.modules } };

  if (patch.employeePricing?.perEmployeeCzk !== undefined) {
    next = {
      ...next,
      employeePricing: {
        ...next.employeePricing,
        perEmployeeCzk: patch.employeePricing.perEmployeeCzk,
      },
    };
    next = recalcAttendancePricing(next);
  }

  if (patch.platformLicense) {
    const p = patch.platformLicense;
    if (p.notes !== undefined) next = { ...next, notes: p.notes };
    if (p.activatedBy !== undefined) next = { ...next, activatedBy: p.activatedBy };
    if (p.active !== undefined) {
      next = { ...next, active: p.active };
      if (p.active && p.status === undefined) {
        next = { ...next, status: "active" };
      }
    }
    if (p.status !== undefined) next = { ...next, status: p.status };

    if (p.expiresAt !== undefined) {
      next = { ...next, expiresAt: p.expiresAt };
    }
    if (typeof p.extendDays === "number" && p.extendDays > 0) {
      const base = next.expiresAt
        ? new Date(Math.max(Date.parse(next.expiresAt), Date.now()))
        : new Date();
      const d = new Date(base);
      d.setDate(d.getDate() + p.extendDays);
      next = { ...next, expiresAt: d.toISOString() };
    }

    if (p.active === true && !next.activatedAt) {
      next = { ...next, activatedAt: nowIso };
    }
  }

  if (patch.modules) {
    for (const [codeRaw, m] of Object.entries(patch.modules)) {
      if (!m) continue;
      if (!isPlatformModuleCode(codeRaw)) continue;
      const code = codeRaw;
      const prev = next.modules[code] ?? emptyModuleEntitlement(code);
      let ent = { ...prev };

      if (m.customPriceCzk !== undefined) ent.customPriceCzk = m.customPriceCzk;

      if (m.active === false) {
        ent = { ...ent, active: false };
      } else if (m.active === true || typeof m.days === "number") {
        ent.active = true;
        if (!ent.activatedAt) ent.activatedAt = nowIso;
        if (typeof m.days === "number" && m.days > 0) {
          ent.expiresAt = addDaysIso(m.days);
        } else if (m.active === true && !ent.expiresAt) {
          ent.expiresAt = null;
        }
      }

      next.modules[code] = ent;
    }
  }

  const enabled = new Set<PlatformModuleCode>();
  for (const code of PLATFORM_MODULE_CODES) {
    const ent = next.modules[code];
    if (ent && isModuleEntitlementActiveNow(ent)) enabled.add(code);
  }
  next.enabledModules = Array.from(enabled);

  next.pricingSnapshot = {
    ...next.pricingSnapshot,
    updatedAt: nowIso,
  };

  return next;
}

export async function getCompanyLicenseDoc(
  db: Firestore,
  companyId: string
): Promise<CompanyLicenseDoc | null> {
  const snap = await db.collection(COMPANY_LICENSES_COLLECTION).doc(companyId).get();
  if (!snap.exists) return null;
  return snap.data() as CompanyLicenseDoc;
}

/** Starší dokumenty měly modul `warehouse`; nahrazeno kódem `sklad`. */
export function normalizeLegacyWarehouseModule(license: CompanyLicenseDoc): CompanyLicenseDoc {
  const w = license.modules["warehouse"];
  if (!w || license.modules["sklad"]) return license;
  const { warehouse: _drop, ...restMods } = license.modules;
  return {
    ...license,
    modules: {
      ...restMods,
      sklad: { ...w, moduleCode: "sklad" },
    },
  };
}

export async function ensureCompanyLicenseDoc(
  db: Firestore,
  companyId: string
): Promise<CompanyLicenseDoc> {
  const existing = await getCompanyLicenseDoc(db, companyId);
  if (existing) return normalizeLegacyWarehouseModule(existing);
  return createPendingCompanyLicense(companyId);
}

export async function writeCompanyLicenseAndDenorm(
  db: Firestore,
  id: string,
  license: CompanyLicenseDoc
): Promise<void> {
  const denorm = companyDocPlatformFields(license);
  const batch = db.batch();
  const licRef = db.collection(COMPANY_LICENSES_COLLECTION).doc(id);
  batch.set(
    licRef,
    {
      ...license,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    db.collection(ORGANIZATIONS_COLLECTION).doc(id),
    {
      ...denorm,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(
    db.collection(COMPANIES_COLLECTION).doc(id),
    {
      ...denorm,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}

export async function setEmployeeCountOnLicense(
  db: Firestore,
  companyId: string,
  employeeCount: number
): Promise<CompanyLicenseDoc | null> {
  const lic = await ensureCompanyLicenseDoc(db, companyId);
  if (lic.employeePricing.lastEmployeeCount === employeeCount) return null;
  let next: CompanyLicenseDoc = {
    ...lic,
    employeePricing: {
      ...lic.employeePricing,
      lastEmployeeCount: employeeCount,
    },
  };
  next = recalcAttendancePricing(next);
  await writeCompanyLicenseAndDenorm(db, companyId, next);
  return next;
}

export function applyExpiredLicenseStatus(license: CompanyLicenseDoc): CompanyLicenseDoc {
  if (!license.expiresAt) return license;
  const t = Date.parse(license.expiresAt);
  if (Number.isNaN(t) || t > Date.now()) return license;
  if (license.status === "expired") return license;
  return { ...license, status: "expired", active: false };
}

/** Odhad měsíčního poplatku podle aktivních modulů a docházky (základ z DEFAULT_PLATFORM_MODULES). */
export function estimateMonthlyLicenseCzk(license: CompanyLicenseDoc): number {
  let t = 0;
  const att = license.modules["attendance_payroll"];
  if (att && isModuleEntitlementActiveNow(att)) {
    t += license.employeePricing.monthlyModuleCzk || 0;
  }
  for (const code of PLATFORM_MODULE_CODES) {
    if (code === "attendance_payroll") continue;
    const ent = license.modules[code];
    if (!ent || !isModuleEntitlementActiveNow(ent)) continue;
    const base = DEFAULT_PLATFORM_MODULES.find((m) => m.code === code);
    t += ent.customPriceCzk ?? base?.basePriceCzk ?? 0;
  }
  return t;
}
