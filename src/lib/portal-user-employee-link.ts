import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import type { EmployeeOrgRole } from "@/lib/employee-organization";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { normalizeCompanyRole } from "@/lib/company-privilege";
/** Vrátí true, pokud volající není privilegovaný správce firmy (sync z employees smí běžet). */
export function callerIsOrgEmployeeSubject(caller: VerifiedCompanyCaller): boolean {
  const r = normalizeCompanyRole(caller.role);
  if (Array.isArray(caller.globalRoles) && caller.globalRoles.includes("super_admin")) return false;
  return r === "employee" || r === "manager" || r === "accountant";
}

/** Po uložení oprávnění sjednotí users/{uid}.employeeId s dokumentem zaměstnance. */
export async function syncUserProfileAfterEmployeePermissionsSave(
  db: Firestore,
  input: {
    companyId: string;
    employeeId: string;
    authUserId: string;
    orgRole: EmployeeOrgRole;
  }
): Promise<void> {
  const authUserId = String(input.authUserId || "").trim();
  if (!authUserId) return;

  const portalRole = userPortalRoleForEmployeeDocRole(input.orgRole);
  await db.collection("users").doc(authUserId).set(
    {
      role: portalRole,
      companyId: input.companyId,
      organizationId: input.companyId,
      employeeId: input.employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
