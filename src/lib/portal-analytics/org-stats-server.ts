import type { CollectionReference, Firestore, Query } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
  USERS_COLLECTION,
} from "@/lib/firestore-collections";
import { countBillableCompanyEmployees } from "@/lib/platform-invoice-auto";

export type OrganizationEntityCounts = {
  userAccounts: number;
  employees: number;
  jobs: number;
  leads: number;
  offers: number;
  invoices: number;
  documents: number;
  jobsCompleted: number;
};

async function collectionCount(ref: CollectionReference | Query): Promise<number> {
  try {
    const snap = await ref.count().get();
    return snap.data().count ?? 0;
  } catch {
    const snap = await ref.limit(5000).get();
    return snap.size;
  }
};

export async function loadOrganizationEntityCounts(
  db: Firestore,
  organizationId: string
): Promise<OrganizationEntityCounts> {
  const cid = String(organizationId).trim();
  const companyRef = db.collection(COMPANIES_COLLECTION).doc(cid);

  const [
    userAccounts,
    employees,
    jobs,
    leads,
    offers,
    invoices,
    documents,
    jobsCompletedSnap,
  ] = await Promise.all([
    collectionCount(db.collection(USERS_COLLECTION).where("companyId", "==", cid)),
    countBillableCompanyEmployees(db, cid),
    collectionCount(companyRef.collection("jobs")),
    collectionCount(companyRef.collection("import_lead_overlays")),
    collectionCount(companyRef.collection("inquiry_offers")),
    collectionCount(companyRef.collection("invoices")),
    collectionCount(companyRef.collection("documents")),
    companyRef.collection("jobs").where("status", "==", "dokončená").count().get().catch(() => null),
  ]);

  let jobsCompleted = 0;
  if (jobsCompletedSnap && "data" in jobsCompletedSnap) {
    jobsCompleted = jobsCompletedSnap.data().count ?? 0;
  }

  return {
    userAccounts,
    employees,
    jobs,
    leads,
    offers,
    invoices,
    documents,
    jobsCompleted,
  };
}

export async function loadOrganizationRegistrationDate(
  db: Firestore,
  organizationId: string
): Promise<string | null> {
  const snap = await db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId).get();
  if (!snap.exists) return null;
  const createdAt = snap.data()?.createdAt as { toDate?: () => Date } | undefined;
  return createdAt?.toDate?.()?.toISOString() ?? null;
}

export async function loadLastStaffSessionActivity(
  db: Firestore,
  organizationId: string
): Promise<string | null> {
  try {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(organizationId)
      .collection("staffSessions")
      .orderBy("lastSeenAt", "desc")
      .limit(1)
      .get();
    if (snap.empty) return null;
    const ts = snap.docs[0].data().lastSeenAt as { toDate?: () => Date } | undefined;
    return ts?.toDate?.()?.toISOString() ?? null;
  } catch {
    return null;
  }
}
