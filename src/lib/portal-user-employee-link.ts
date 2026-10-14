import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { userPortalRoleForEmployeeDocRole } from "@/lib/employee-organization";
import type { EmployeeOrgRole } from "@/lib/employee-organization";

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
