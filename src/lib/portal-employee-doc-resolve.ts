import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { parseEmployeeOrgRole, userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import {
  callerIsOrgEmployeeSubject,
  syncUserProfileAfterEmployeePermissionsSave,
} from "@/lib/portal-user-employee-link";

export type ResolvedEmployeeRecord = {
  employeeId: string;
  employeeDoc: Record<string, unknown>;
  /** Odkud byl záznam načten — pro diagnostiku. */
  source: "users.employeeId" | "employees.authUserId" | "employees.docIdEqualsUid";
};

function docBelongsToCompany(data: Record<string, unknown>, companyId: string): boolean {
  const docCompany = String(data.companyId ?? data.organizationId ?? "").trim();
  return !docCompany || docCompany === companyId;
}

function authUserIdOnDoc(data: Record<string, unknown>, uid: string): boolean {
  const auth = String(data.authUserId ?? "").trim();
  return !auth || auth === uid;
}

/**
 * Najde dokument zaměstnance pro přihlášeného uživatele.
 * Priorita: employees.authUserId (autoritativní) → users.employeeId (jen pokud sedí authUserId) → employees/{uid}.
 */
export async function resolveEmployeeRecordForCaller(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  opts?: { reconcileUserLink?: boolean }
): Promise<ResolvedEmployeeRecord | null> {
  const companyId = caller.companyId;
  const employeesCol = db.collection("companies").doc(companyId).collection("employees");

  const tryDoc = async (
    employeeId: string,
    source: ResolvedEmployeeRecord["source"]
  ): Promise<ResolvedEmployeeRecord | null> => {
    const snap = await employeesCol.doc(employeeId).get();
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    if (!docBelongsToCompany(data, companyId)) return null;
    return { employeeId: snap.id, employeeDoc: data, source };
  };

  const byAuth = await employeesCol.where("authUserId", "==", caller.uid).limit(2).get();
  if (!byAuth.empty) {
    if (byAuth.size > 1) {
      console.warn("[resolveEmployeeRecordForCaller] více dokumentů se stejným authUserId", {
        companyId,
        uid: caller.uid,
        ids: byAuth.docs.map((d) => d.id),
      });
    }
    const doc = byAuth.docs[0]!;
    const resolved: ResolvedEmployeeRecord = {
      employeeId: doc.id,
      employeeDoc: doc.data() as Record<string, unknown>,
      source: "employees.authUserId",
    };
    if (opts?.reconcileUserLink !== false) {
      await reconcileUserEmployeeLinkFromResolvedDoc(db, caller, resolved).catch((e) => {
        console.warn("[resolveEmployeeRecordForCaller] reconcile link", e);
      });
    }
    return resolved;
  }

  const fromUsersId = String(caller.employeeId ?? "").trim();
  if (fromUsersId) {
    const hit = await tryDoc(fromUsersId, "users.employeeId");
    if (hit && authUserIdOnDoc(hit.employeeDoc, caller.uid)) {
      return hit;
    }
  }

  const byUidDoc = await tryDoc(caller.uid, "employees.docIdEqualsUid");
  if (byUidDoc) return byUidDoc;

  return null;
}

export { callerIsOrgEmployeeSubject } from "@/lib/portal-user-employee-link";

async function reconcileUserEmployeeLinkFromResolvedDoc(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  resolved: ResolvedEmployeeRecord
): Promise<void> {
  if (!callerIsOrgEmployeeSubject(caller)) return;

  const empAuth = String(resolved.employeeDoc.authUserId ?? "").trim();
  if (empAuth && empAuth !== caller.uid) return;

  const orgRole = parseEmployeeOrgRole(resolved.employeeDoc);
  const expectedUserRole = userPortalRoleForEmployeeDocRole(orgRole);
  const currentUserRole = normalizeCompanyRole(caller.role);
  const expectedNorm = normalizeCompanyRole(expectedUserRole);

  const needsEmployeeId = String(caller.employeeId ?? "").trim() !== resolved.employeeId;
  const needsRole = currentUserRole !== expectedNorm;

  if (!needsEmployeeId && !needsRole) return;

  await syncUserProfileAfterEmployeePermissionsSave(db, {
    companyId: caller.companyId,
    employeeId: resolved.employeeId,
    authUserId: caller.uid,
    orgRole,
  });
}
