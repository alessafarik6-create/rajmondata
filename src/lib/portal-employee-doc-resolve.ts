import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";

export type ResolvedEmployeeRecord = {
  employeeId: string;
  employeeDoc: Record<string, unknown>;
  /** Odkud byl záznam načten — pro diagnostiku. */
  source: "users.employeeId" | "employees.authUserId" | "employees.docIdEqualsUid";
};

/**
 * Najde dokument zaměstnance pro přihlášeného uživatele.
 * Priorita: users.employeeId → employees.authUserId → employees/{uid}.
 */
export async function resolveEmployeeRecordForCaller(
  db: Firestore,
  caller: VerifiedCompanyCaller
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
    const docCompany = String(data.companyId ?? data.organizationId ?? "").trim();
    if (docCompany && docCompany !== companyId) return null;
    return { employeeId: snap.id, employeeDoc: data, source };
  };

  const fromUsersId = String(caller.employeeId ?? "").trim();
  if (fromUsersId) {
    const hit = await tryDoc(fromUsersId, "users.employeeId");
    if (hit) return hit;
  }

  const byAuth = await employeesCol.where("authUserId", "==", caller.uid).limit(1).get();
  if (!byAuth.empty) {
    const doc = byAuth.docs[0]!;
    return {
      employeeId: doc.id,
      employeeDoc: doc.data() as Record<string, unknown>,
      source: "employees.authUserId",
    };
  }

  const byUidDoc = await tryDoc(caller.uid, "employees.docIdEqualsUid");
  if (byUidDoc) return byUidDoc;

  return null;
}
