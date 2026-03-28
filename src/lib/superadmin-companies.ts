/**
 * Superadmin organization/company service.
 * Reads from Firestore "společnosti" (organizations) + `company_licenses` + denormalizace do `companies`.
 */
import type { Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_LICENSE,
  MODULE_KEYS,
  type LicenseConfig,
  type ModuleKey,
} from "./license-modules";
import {
  ORGANIZATIONS_COLLECTION,
  COMPANIES_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
} from "./firestore-collections";
import type { CompanyLicenseDoc } from "./platform-config";
import {
  buildPlatformModulesSyncFromLegacy,
  createPendingCompanyLicense,
} from "./company-license-record";
import {
  applyExpiredLicenseStatus,
  ensureCompanyLicenseDoc,
  estimateMonthlyLicenseCzk,
  mergeCompanyLicenseUpdate,
  normalizeLegacyWarehouseModule,
  platformLicensePatchFromLegacyDialog,
  writeCompanyLicenseAndDenorm,
  type CompanyLicenseUpdatePayload,
} from "./company-license-admin";

/** @deprecated Use ORGANIZATIONS_COLLECTION from firestore-collections */
export const COMPANIES_COLLECTION_LEGACY = ORGANIZATIONS_COLLECTION;

export interface CompanyWithLicense {
  id: string;
  name: string;
  email: string;
  ico: string;
  address?: string;
  ownerUserId: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  licenseId: string;
  license: LicenseConfig & { licenseExpiresAt?: string | null };
  companyLicense?: CompanyLicenseDoc;
}

export interface LicenseUpdate {
  licenseType?: string;
  licenseStatus?: string;
  status?: string;
  expirationDate?: string | null;
  licenseExpiresAt?: string | null;
  maxUsers?: number | null;
  enabledModules?: string[];
}

function toModuleKey(s: string): ModuleKey | null {
  return MODULE_KEYS.includes(s as ModuleKey) ? (s as ModuleKey) : null;
}

export function normalizeCompanyFromFirestore(
  data: Record<string, unknown>,
  id: string
): CompanyWithLicense {
  const license = (data.license as Record<string, unknown> | undefined) ?? {};
  const enabledModuleIds = data.enabledModuleIds as string[] | undefined;
  const rawModules = (license.enabledModules as string[] | undefined) ?? enabledModuleIds ?? [];
  const enabledModules = Array.isArray(rawModules)
    ? rawModules.map(toModuleKey).filter((k): k is ModuleKey => k !== null)
    : [];

  const expirationDate =
    (license.expirationDate as string | null) ?? (license.licenseExpiresAt as string | null) ?? null;
  const rawLicenseType = (license.licenseType as string) ?? (data.licenseId as string) ?? "starter";
  const rawStatus = (license.status as string) ?? (license.licenseStatus as string) ?? "active";
  const licenseType: LicenseConfig["licenseType"] =
    rawLicenseType === "professional" || rawLicenseType === "enterprise" ? rawLicenseType : "starter";
  const status: LicenseConfig["status"] =
    rawStatus === "expired" || rawStatus === "suspended" ? rawStatus : "active";

  const licenseConfig: LicenseConfig & { licenseExpiresAt?: string | null } = {
    licenseType,
    status,
    expirationDate,
    licenseExpiresAt: expirationDate,
    maxUsers:
      typeof license.maxUsers === "number" ? license.maxUsers : DEFAULT_LICENSE.maxUsers,
    enabledModules,
  };

  const createdAt = data.createdAt as { toDate?: () => Date } | undefined;
  const updatedAt = data.updatedAt as { toDate?: () => Date } | undefined;

  return {
    id,
    name: (data.name as string) ?? "",
    email: (data.email as string) ?? "",
    ico: (data.ico as string) ?? "",
    address: data.address as string | undefined,
    ownerUserId: (data.ownerUserId as string) ?? "",
    isActive: data.isActive !== false && data.active !== false,
    createdAt: createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: updatedAt?.toDate?.()?.toISOString() ?? null,
    licenseId: (data.licenseId as string) ?? licenseType,
    license: licenseConfig,
  };
}

function buildLicenseForFirestore(update: LicenseUpdate): Record<string, unknown> {
  const expirationDate =
    update.expirationDate ?? update.licenseExpiresAt ?? null;
  const licenseType = update.licenseType ?? "starter";
  const status = update.status ?? update.licenseStatus ?? "active";
  const enabledModules = Array.isArray(update.enabledModules)
    ? update.enabledModules.filter((k) => toModuleKey(k) !== null)
    : [];

  return {
    licenseType,
    status,
    expirationDate,
    maxUsers: update.maxUsers ?? null,
    enabledModules,
  };
}

export async function getCompanies(db: Firestore) {
  const snapshot = await db.collection(ORGANIZATIONS_COLLECTION).get();
  const docs = snapshot.docs;

  const licenseSnaps = await Promise.all(
    docs.map((d) => db.collection(COMPANY_LICENSES_COLLECTION).doc(d.id).get())
  );

  const employeeCounts = await Promise.all(
    docs.map((d) =>
      db
        .collection(COMPANIES_COLLECTION)
        .doc(d.id)
        .collection("employees")
        .count()
        .get()
        .then((c) => c.data().count)
        .catch(() => 0)
    )
  );

  return docs.map((doc, i) => {
    const data = doc.data() as Record<string, unknown>;
    let companyLicense: CompanyLicenseDoc = licenseSnaps[i]?.exists
      ? applyExpiredLicenseStatus(
          normalizeLegacyWarehouseModule(licenseSnaps[i].data() as CompanyLicenseDoc)
        )
      : createPendingCompanyLicense(doc.id);

    const ec = employeeCounts[i] ?? 0;
    if (companyLicense.employeePricing.lastEmployeeCount !== ec) {
      const per = companyLicense.employeePricing.perEmployeeCzk;
      companyLicense = {
        ...companyLicense,
        employeePricing: {
          ...companyLicense.employeePricing,
          lastEmployeeCount: ec,
          monthlyModuleCzk: ec * per,
        },
      };
    }

    const estimatedMonthlyCzk = estimateMonthlyLicenseCzk(companyLicense);

    return {
      id: doc.id,
      ...data,
      name: (data.name as string) ?? (data.companyName as string) ?? "",
      companyLicense,
      employeeCount: ec,
      estimatedMonthlyCzk,
    };
  });
}

export async function getCompany(db: Firestore, id: string): Promise<CompanyWithLicense | null> {
  const doc = await db.collection(ORGANIZATIONS_COLLECTION).doc(id).get();

  if (!doc.exists) {
    return null;
  }

  const base = normalizeCompanyFromFirestore(doc.data() as Record<string, unknown>, doc.id);
  const licSnap = await db.collection(COMPANY_LICENSES_COLLECTION).doc(id).get();
  const companyLicense = licSnap.exists
    ? applyExpiredLicenseStatus(
        normalizeLegacyWarehouseModule(licSnap.data() as CompanyLicenseDoc)
      )
    : createPendingCompanyLicense(id);

  return { ...base, companyLicense };
}

/**
 * Update company: isActive, legacy license, nebo platformní `companyLicense` patch.
 */
export async function updateCompany(
  db: Firestore,
  id: string,
  payload: {
    isActive?: boolean;
    license?: LicenseUpdate;
    companyLicense?: CompanyLicenseUpdatePayload;
  },
  options?: { actorLabel?: string }
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof payload.isActive === "boolean") {
    updates.isActive = payload.isActive;
    updates.active = payload.isActive;
  }

  if (payload.license && typeof payload.license === "object") {
    const licenseFs = buildLicenseForFirestore(payload.license);
    updates.license = licenseFs;
    updates.licenseId = licenseFs.licenseType as string;
    updates.enabledModuleIds = licenseFs.enabledModules;

    const enabledKeys = (licenseFs.enabledModules as string[]).filter((k): k is ModuleKey =>
      MODULE_KEYS.includes(k as ModuleKey)
    );
    const nowIso = new Date().toISOString();
    const existingLic = await ensureCompanyLicenseDoc(db, id);
    const syncModules = buildPlatformModulesSyncFromLegacy(enabledKeys);
    const platformFromDialog = platformLicensePatchFromLegacyDialog(licenseFs, payload.license);
    let mergedFromLegacy = mergeCompanyLicenseUpdate(existingLic, {
      ...platformFromDialog,
      modules: syncModules,
    }, nowIso);
    mergedFromLegacy = applyExpiredLicenseStatus(mergedFromLegacy);
    await writeCompanyLicenseAndDenorm(db, id, mergedFromLegacy);
  }

  if (payload.companyLicense && typeof payload.companyLicense === "object") {
    const nowIso = new Date().toISOString();
    const existing = await ensureCompanyLicenseDoc(db, id);
    let merged = mergeCompanyLicenseUpdate(existing, payload.companyLicense, nowIso);
    merged = applyExpiredLicenseStatus(merged);
    if (options?.actorLabel) {
      merged = { ...merged, activatedBy: merged.activatedBy ?? options.actorLabel };
    }
    await writeCompanyLicenseAndDenorm(db, id, merged);

    if (merged.active && existing.status === "pending" && merged.status === "active") {
      console.info("[Platform]", "Superadmin activated company license", { companyId: id });
    }
    if (payload.companyLicense.modules) {
      for (const code of Object.keys(payload.companyLicense.modules)) {
        const m = payload.companyLicense.modules[code];
        if (m?.active || typeof m?.days === "number") {
          console.info("[Platform]", "Module enabled for company", { companyId: id, moduleCode: code });
        }
      }
    }
    if (payload.companyLicense.employeePricing?.perEmployeeCzk !== undefined) {
      console.info("[Platform]", "Employee-based pricing calculated", {
        companyId: id,
        perEmployeeCzk: merged.employeePricing.perEmployeeCzk,
        employees: merged.employeePricing.lastEmployeeCount,
      });
    }
  }

  const hasOrgUpdates = Object.keys(updates).length > 1;
  if (hasOrgUpdates) {
    await db.collection(ORGANIZATIONS_COLLECTION).doc(id).update(updates);
    await db.collection(COMPANIES_COLLECTION).doc(id).update(updates);
  }
}
