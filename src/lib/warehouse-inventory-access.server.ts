import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { userCanAccessWarehousePortal, userCanManageWarehouseInventory } from "@/lib/warehouse-production-access";

export async function assertWarehouseInventoryAccess(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const profile = userSnap.data() as Record<string, unknown> | undefined;
  const role = String(profile?.role ?? caller.role ?? "employee");
  const globalRoles = profile?.globalRoles as string[] | undefined;

  let employeeRow: { canAccessWarehouse?: boolean } | null = null;
  const employeeId = profile?.employeeId;
  if (employeeId) {
    const empSnap = await db
      .collection("companies")
      .doc(caller.companyId)
      .collection("employees")
      .doc(String(employeeId))
      .get();
    if (empSnap.exists) employeeRow = empSnap.data() as { canAccessWarehouse?: boolean };
  }

  const ok = userCanAccessWarehousePortal({ role, globalRoles, employeeRow });
  if (!ok) {
    return { ok: false, status: 403, error: "Nemáte přístup ke skladu." };
  }
  return { ok: true };
}

export function assertWarehouseInventoryManage(
  caller: VerifiedCompanyCaller,
  profile?: Record<string, unknown> | null
): { ok: true } | { ok: false; status: number; error: string } {
  const role = String(profile?.role ?? caller.role ?? "employee");
  const globalRoles = profile?.globalRoles as string[] | undefined;
  if (
    !userCanManageWarehouseInventory({
      role,
      globalRoles,
    })
  ) {
    return {
      ok: false,
      status: 403,
      error: "Uzavření inventury a skladové korekce smí provádět pouze manažer nebo administrátor.",
    };
  }
  return { ok: true };
}
