/**
 * Superadmin organization/company service.
 * Reads from Firestore collection "společnosti" (organizations).
 * Normalizes license and enabledModules from existing docs (e.g. enabledModuleIds from register).
 */
import type { Firestore } from "firebase-admin/firestore";
import {
  DEFAULT_LICENSE,
  MODULE_KEYS,
  type LicenseConfig,
  type ModuleKey,
} from "./license-modules";
import { ORGANIZATIONS_COLLECTION } from "./firestore-collections";

/** @deprecated Use ORGANIZATIONS_COLLECTION from firestore-collections */
export const COMPANIES_COLLECTION = ORGANIZATIONS_COLLECTION;

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

/**
 * Normalize raw Firestore company document to CompanyWithLicense.
 * Reads from: data.license, data.enabledModuleIds (register flow), data.licenseId.
 */
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

/**
 * Fetch all companies, sorted by name (in memory to avoid index requirement).
 */
export async function getCompanies(db: Firestore): Promise<CompanyWithLicense[]> {
  const snapshot = await db.collection(ORGANIZATIONS_COLLECTION).get();
  const list = snapshot.docs.map((doc) => normalizeCompanyFromFirestore(doc.data(), doc.id));
  list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "cs"));
  return list;
}

/**
 * Fetch one company by id.
 */
export async function getCompany(
  db: Firestore,
  id: string
): Promise<CompanyWithLicense | null> {
  const snap = await db.collection(ORGANIZATIONS_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return normalizeCompanyFromFirestore(snap.data()!, snap.id);
}

/**
 * Build Firestore-updatable license object from API input.
 */
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

/**
 * Update company: isActive and/or license. Merges license with existing; sets updatedAt.
 */
export async function updateCompany(
  db: Firestore,
  id: string,
  payload: { isActive?: boolean; license?: LicenseUpdate }
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof payload.isActive === "boolean") {
    updates.isActive = payload.isActive;
  }

  if (payload.license && typeof payload.license === "object") {
    const license = buildLicenseForFirestore(payload.license);
    updates.license = license;
    updates.licenseId = license.licenseType as string;
    updates.enabledModuleIds = license.enabledModules;
  }

  if (Object.keys(updates).length <= 1) return;
  await db.collection(ORGANIZATIONS_COLLECTION).doc(id).update(updates);
}
