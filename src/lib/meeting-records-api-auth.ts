import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
import { callerCanAccessCompany } from "@/lib/api-verify-company-user";

/**
 * Stejná logika jako `staffCanViewMeetingRecords` / edit — PDF a e-mail jen pro oprávněné.
 */
export async function assertCallerCanMeetingRecordsStaffActions(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!callerCanAccessCompany(caller, companyId)) {
    return { ok: false, status: 403, error: "Nemáte přístup k této organizaci." };
  }
  if (caller.role === "customer") {
    return { ok: false, status: 403, error: "Zákaznický účet nemůže odesílat záznamy." };
  }
  if (caller.isSuperAdmin) {
    return { ok: true };
  }
  const role = caller.role;
  if (role === "owner" || role === "admin" || role === "manager" || role === "accountant") {
    return { ok: true };
  }
  if (role !== "employee") {
    return { ok: false, status: 403, error: "Nemáte oprávnění." };
  }
  const userSnap = await db.collection("users").doc(caller.uid).get();
  const eid = String((userSnap.data() as Record<string, unknown> | undefined)?.employeeId ?? "").trim();
  if (!eid) {
    return { ok: false, status: 403, error: "Chybí vazba na zaměstnance." };
  }
  const empSnap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("employees")
    .doc(eid)
    .get();
  if (!empSnap.exists || (empSnap.data() as { canAccessMeetingNotes?: boolean })?.canAccessMeetingNotes !== true) {
    return { ok: false, status: 403, error: "Nemáte oprávnění k záznamům ze schůzek." };
  }
  return { ok: true };
}
