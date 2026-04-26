import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from "@/lib/firestore-collections";

const SOFT_DELETE_RETENTION_DAYS = 30;

function scheduledDeletionTimestamp(): Timestamp {
  return Timestamp.fromMillis(Date.now() + SOFT_DELETE_RETENTION_DAYS * 86400000);
}

/** Označí organizaci jako smazanou (obnovitelná ~30 dní). Zapisuje `společnosti` + `companies` + zákaz licence. */
export async function softDeleteOrganizationAdmin(db: Firestore, organizationId: string): Promise<void> {
  const id = String(organizationId || "").trim();
  if (!id) throw new Error("Chybí ID organizace.");
  const deletionScheduledAt = scheduledDeletionTimestamp();
  const patch = {
    isDeleted: true,
    deletedAt: FieldValue.serverTimestamp(),
    deletionScheduledAt,
    status: "deleted",
    licenseActive: false,
    isActive: false,
    active: false,
    "platformLicense.active": false,
    updatedAt: FieldValue.serverTimestamp(),
  } as Record<string, unknown>;

  await db.collection(ORGANIZATIONS_COLLECTION).doc(id).set(patch, { merge: true });
  await db.collection(COMPANIES_COLLECTION).doc(id).set(patch, { merge: true });
  await db
    .collection(COMPANY_LICENSES_COLLECTION)
    .doc(id)
    .set(
      {
        active: false,
        status: "suspended",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/** Obnova po soft delete. */
export async function restoreOrganizationAdmin(db: Firestore, organizationId: string): Promise<void> {
  const id = String(organizationId || "").trim();
  if (!id) throw new Error("Chybí ID organizace.");
  const patch = {
    isDeleted: false,
    deletedAt: FieldValue.delete(),
    deletionScheduledAt: FieldValue.delete(),
    status: "active",
    licenseActive: true,
    isActive: true,
    active: true,
    "platformLicense.active": true,
    permanentlyDeleted: FieldValue.delete(),
    permanentlyDeletedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  } as Record<string, unknown>;

  await db.collection(ORGANIZATIONS_COLLECTION).doc(id).set(patch, { merge: true });
  await db.collection(COMPANIES_COLLECTION).doc(id).set(patch, { merge: true });
  await db
    .collection(COMPANY_LICENSES_COLLECTION)
    .doc(id)
    .set(
      {
        active: true,
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Trvalé odstranění kořenových dokumentů tenantu (bez rekurzivního mazání podkolekcí).
 * Uživatelé s `companyId` mohou odkazovat na neexistující firmu — řešte samostatně.
 */
export async function hardDeleteOrganizationTenantAdmin(db: Firestore, organizationId: string): Promise<void> {
  const id = String(organizationId || "").trim();
  if (!id) throw new Error("Chybí ID organizace.");
  const batch = db.batch();
  batch.delete(db.collection(ORGANIZATIONS_COLLECTION).doc(id));
  batch.delete(db.collection(COMPANIES_COLLECTION).doc(id));
  batch.delete(db.collection(COMPANY_LICENSES_COLLECTION).doc(id));
  await batch.commit();
}

export type OrganizationCleanupResult = { purgedIds: string[]; errors: string[] };

/** Organizace se `isDeleted` a `deletionScheduledAt` v minulosti. */
export async function purgeExpiredSoftDeletedOrganizationsAdmin(
  db: Firestore
): Promise<OrganizationCleanupResult> {
  const now = Date.now();
  const snap = await db.collection(ORGANIZATIONS_COLLECTION).where("isDeleted", "==", true).limit(200).get();
  const purgedIds: string[] = [];
  const errors: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const sched = data.deletionScheduledAt as Timestamp | undefined;
    if (!sched || typeof sched.toMillis !== "function") continue;
    if (sched.toMillis() > now) continue;
    try {
      await hardDeleteOrganizationTenantAdmin(db, doc.id);
      purgedIds.push(doc.id);
    } catch (e) {
      errors.push(`${doc.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { purgedIds, errors };
}
