/**
 * Superadmin organization/company service.
 * Reads from Firestore "společnosti" (organizations) + `company_licenses` + denormalizace do `companies`.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_LICENSE,
  MODULE_KEYS,
  buildCanonicalModulesMapFromEnabled,
  normalizeEnabledModuleIds,
  resolveCanonicalModuleMapForAdmin,
  type CanonicalModuleKey,
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
  companyDocPlatformFields,
  createPendingCompanyLicense,
  platformCodesToCanonicalModuleKeys,
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
import { countBillableCompanyEmployees } from "./platform-invoice-auto";

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
  license: LicenseConfig & {
    licenseExpiresAt?: string | null;
    modules?: Record<string, boolean>;
  };
  /** Top-level mapa na dokumentu organizace (stejná jako po zápisu superadminem). */
  modules?: Record<string, boolean>;
  enabledModuleIds?: string[];
  companyLicense?: CompanyLicenseDoc;
  /** Automatická fakturace (uloženo na dokumentu organizace). */
  billingAutomation?: Record<string, unknown> | null;
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

export function normalizeCompanyFromFirestore(
  data: Record<string, unknown>,
  id: string
): CompanyWithLicense {
  const license = (data.license as Record<string, unknown> | undefined) ?? {};
  const moduleMap = resolveCanonicalModuleMapForAdmin({
    license: {
      enabledModules: license.enabledModules as string[] | undefined,
      modules: license.modules as Record<string, boolean | undefined> | undefined,
    },
    enabledModuleIds: data.enabledModuleIds as string[] | undefined,
    modules: data.modules as Record<string, boolean | undefined> | undefined,
  });
  const enabledModules: CanonicalModuleKey[] = MODULE_KEYS.filter((k) => moduleMap[k]);

  const expirationDate =
    (license.expirationDate as string | null) ?? (license.licenseExpiresAt as string | null) ?? null;
  const rawLicenseType = (license.licenseType as string) ?? (data.licenseId as string) ?? "starter";
  const rawStatus = (license.status as string) ?? (license.licenseStatus as string) ?? "active";
  const licenseType: LicenseConfig["licenseType"] =
    rawLicenseType === "professional" || rawLicenseType === "enterprise" ? rawLicenseType : "starter";
  const status: LicenseConfig["status"] =
    rawStatus === "expired" ||
    rawStatus === "suspended" ||
    rawStatus === "pending" ||
    rawStatus === "inactive"
      ? rawStatus
      : "active";

  const modulesFlat: Record<CanonicalModuleKey, boolean> = { ...moduleMap };
  const licenseConfig: LicenseConfig & {
    licenseExpiresAt?: string | null;
    modules?: Record<string, boolean>;
  } = {
    licenseType,
    status,
    expirationDate,
    licenseExpiresAt: expirationDate,
    maxUsers:
      typeof license.maxUsers === "number" ? license.maxUsers : DEFAULT_LICENSE.maxUsers,
    enabledModules,
    modules: modulesFlat,
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
    /** Sjednocená mapa pro UI — stejná jako zápis `updates.modules` / `license.modules` po uložení z adminu. */
    modules: modulesFlat,
    enabledModuleIds: enabledModules,
  };
}

function buildLicenseForFirestore(update: LicenseUpdate): Record<string, unknown> {
  const expirationDate =
    update.expirationDate ?? update.licenseExpiresAt ?? null;
  const licenseType = update.licenseType ?? "starter";
  const status = update.status ?? update.licenseStatus ?? "active";
  const enabledModules = Array.isArray(update.enabledModules)
    ? normalizeEnabledModuleIds(update.enabledModules.map((k) => String(k)))
    : [];
  const modules = buildCanonicalModulesMapFromEnabled(enabledModules);

  return {
    licenseType,
    status,
    expirationDate,
    maxUsers: update.maxUsers ?? null,
    enabledModules,
    modules,
  };
}

export async function getCompanies(db: Firestore, options?: { light?: boolean }) {
  const light = options?.light === true;
  const snapshot = await db.collection(ORGANIZATIONS_COLLECTION).get();
  const docs = snapshot.docs;

  const licenseSnaps = await Promise.all(
    docs.map((d) => db.collection(COMPANY_LICENSES_COLLECTION).doc(d.id).get())
  );

  const employeeCounts = light
    ? docs.map(() => 0)
    : await Promise.all(docs.map((d) => countBillableCompanyEmployees(db, d.id)));

  return docs.map((doc, i) => {
    const data = doc.data() as Record<string, unknown>;
    /** Jednotný přehled modulů z license + enabledModuleIds + license.modules (stejný výstup jako po uložení z dialogu). */
    const normalized = normalizeCompanyFromFirestore(data, doc.id);
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
      name: (data.name as string) ?? (data.companyName as string) ?? normalized.name,
      email: (data.email as string) ?? normalized.email,
      ico: (data.ico as string) ?? normalized.ico,
      ownerUserId: (data.ownerUserId as string) ?? normalized.ownerUserId,
      isActive: normalized.isActive,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      licenseId: normalized.licenseId,
      license: normalized.license,
      modules: normalized.modules,
      enabledModuleIds: normalized.enabledModuleIds,
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

  const raw = doc.data() as Record<string, unknown>;
  const base = normalizeCompanyFromFirestore(raw, doc.id);
  const licSnap = await db.collection(COMPANY_LICENSES_COLLECTION).doc(id).get();
  const companyLicense = licSnap.exists
    ? applyExpiredLicenseStatus(
        normalizeLegacyWarehouseModule(licSnap.data() as CompanyLicenseDoc)
      )
    : createPendingCompanyLicense(id);

  return {
    ...base,
    companyLicense,
    billingAutomation:
      raw.billingAutomation != null && typeof raw.billingAutomation === "object"
        ? (raw.billingAutomation as Record<string, unknown>)
        : undefined,
  };
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
    if (payload.isActive === true) {
      updates.platformBillingSuspension = FieldValue.delete();
    }
  }

  if (payload.license && typeof payload.license === "object") {
    const licenseFs = buildLicenseForFirestore(payload.license);
    updates.license = licenseFs;
    updates.licenseId = licenseFs.licenseType as string;
    updates.enabledModuleIds = licenseFs.enabledModules;
    const enabledKeys = normalizeEnabledModuleIds(
      (licenseFs.enabledModules as string[]).map((k) => String(k))
    );
    updates.modules = buildCanonicalModulesMapFromEnabled(enabledKeys);
    const nowIso = new Date().toISOString();
    const existingLic = await ensureCompanyLicenseDoc(db, id);
    const syncModules = buildPlatformModulesSyncFromLegacy(enabledKeys);
    const platformFromDialog = platformLicensePatchFromLegacyDialog(licenseFs, payload.license);
    let mergedFromLegacy = mergeCompanyLicenseUpdate(existingLic, {
      ...platformFromDialog,
      modules: syncModules,
    }, nowIso);
    mergedFromLegacy = applyExpiredLicenseStatus(mergedFromLegacy);
    const baseDenorm = companyDocPlatformFields(mergedFromLegacy);
    const legacyAlignsWithDialog: Record<string, unknown> = {
      modules: licenseFs.modules,
      enabledModuleIds: licenseFs.enabledModules,
      license: {
        ...(baseDenorm.license as Record<string, unknown>),
        licenseType: licenseFs.licenseType,
        status: licenseFs.status,
        expirationDate: licenseFs.expirationDate,
        maxUsers: licenseFs.maxUsers,
        enabledModules: licenseFs.enabledModules,
        modules: licenseFs.modules,
      },
    };
    await writeCompanyLicenseAndDenorm(db, id, mergedFromLegacy, {
      organizationDenormPatch: legacyAlignsWithDialog,
    });
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

    const canonicalFromPlatform = platformCodesToCanonicalModuleKeys(merged.enabledModules);
    const modulesSync = buildCanonicalModulesMapFromEnabled(canonicalFromPlatform);
    const modulesPatch = { modules: modulesSync, updatedAt: new Date() };
    await db.collection(ORGANIZATIONS_COLLECTION).doc(id).set(modulesPatch, { merge: true });
    await db.collection(COMPANIES_COLLECTION).doc(id).set(modulesPatch, { merge: true });

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
    /** `set` + merge: vytvoří `companies/{id}` pokud chybí; `update` by po prvním úspěšném zápisu do společnosti mohl nechat portál bez pole `license`. */
    await db.collection(ORGANIZATIONS_COLLECTION).doc(id).set(updates, { merge: true });
    await db.collection(COMPANIES_COLLECTION).doc(id).set(updates, { merge: true });
  }
}
