/**
 * Oprávnění pro CRM vyhledávání (server-only).
 */

import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import type { SearchEntityType, SearchIndexDoc } from "@/lib/search/types";

const PRIVILEGED_ROLES = new Set(["owner", "admin", "manager", "accountant"]);
const FINANCE_ENTITY_TYPES = new Set<SearchEntityType>(["document", "invoice"]);

export function isPrivilegedSearchRole(role: string): boolean {
  return PRIVILEGED_ROLES.has(role);
}

export function callerCanUseSearch(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  if (!caller.companyId) return false;
  return caller.role !== "customer";
}

export function callerCanRunSearchBackfill(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  return caller.role === "owner" || caller.role === "admin";
}

async function loadEmployeeAccessibleJobIds(
  db: Firestore,
  companyId: string,
  employeeDocId: string
): Promise<Set<string>> {
  const ids = new Set<string>();
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .where("assignedEmployeeIds", "array-contains", employeeDocId)
    .limit(200)
    .get()
    .catch(() => null);

  if (snap) {
    for (const doc of snap.docs) ids.add(doc.id);
  }

  const membersSnap = await db
    .collectionGroup("jobMembers")
    .where("employeeId", "==", employeeDocId)
    .limit(300)
    .get()
    .catch(() => null);

  if (membersSnap) {
    for (const doc of membersSnap.docs) {
      const jobRef = doc.ref.parent.parent;
      if (!jobRef) continue;
      const parts = jobRef.path.split("/");
      if (parts[1] === companyId && parts[2] === "jobs" && parts[3]) {
        ids.add(parts[3]);
      }
    }
  }

  return ids;
}

async function loadCustomerJobIds(
  db: Firestore,
  companyId: string,
  customerUserId: string
): Promise<Set<string>> {
  const ids = new Set<string>();
  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .where("customerUserId", "==", customerUserId)
    .limit(100)
    .get()
    .catch(() => null);
  if (snap) {
    for (const doc of snap.docs) ids.add(doc.id);
  }
  return ids;
}

export type SearchAccessContext = {
  isPrivileged: boolean;
  role: string;
  accessibleJobIds: Set<string> | null;
};

export async function buildSearchAccessContext(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<SearchAccessContext> {
  if (caller.isSuperAdmin || isPrivilegedSearchRole(caller.role)) {
    return { isPrivileged: true, role: caller.role, accessibleJobIds: null };
  }

  if (caller.role === "customer") {
    const jobIds = await loadCustomerJobIds(db, caller.companyId, caller.uid);
    return { isPrivileged: false, role: caller.role, accessibleJobIds: jobIds };
  }

  const userSnap = await db.collection("users").doc(caller.uid).get();
  const employeeId = String(userSnap.data()?.employeeId ?? "").trim();
  if (!employeeId) {
    return { isPrivileged: false, role: caller.role, accessibleJobIds: new Set() };
  }

  const jobIds = await loadEmployeeAccessibleJobIds(db, caller.companyId, employeeId);
  return { isPrivileged: false, role: caller.role, accessibleJobIds: jobIds };
}

export function canViewSearchIndexEntry(
  entry: SearchIndexDoc,
  access: SearchAccessContext
): boolean {
  if (access.isPrivileged) return true;

  if (access.role === "customer") {
    if (entry.entityType === "job") {
      return access.accessibleJobIds?.has(entry.entityId) ?? false;
    }
    const jobId = entry.metadata.jobId;
    if (jobId && access.accessibleJobIds?.has(jobId)) {
      return ["document", "file", "offer"].includes(entry.entityType);
    }
    return false;
  }

  if (FINANCE_ENTITY_TYPES.has(entry.entityType)) {
    const jobId = entry.metadata.jobId;
    if (!jobId) return false;
    return access.accessibleJobIds?.has(jobId) ?? false;
  }

  return ["job", "customer", "inquiry", "offer", "product"].includes(entry.entityType);
}
