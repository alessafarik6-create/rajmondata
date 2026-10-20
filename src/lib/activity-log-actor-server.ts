import type { Firestore } from "firebase-admin/firestore";
import { getAdminAuth } from "@/lib/firebase-admin";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { companyOwnerUidFromRecord } from "@/lib/company-owner";
import { effectivePortalRoleForCaller } from "@/lib/portal-caller-role";
import { resolveEmployeeRecordForCaller } from "@/lib/portal-employee-doc-resolve";

export type ServerActivityActor = {
  userId: string;
  employeeId: string | null;
  employeeName: string;
  employeeEmail: string | null;
  role: string;
  roleLabelCs: string;
  /** Jméno s rolí pro tabulku aktivit, např. „Aleš Novák · Vlastník“. */
  displayWithRole: string;
};

export function portalRoleLabelCs(role: string | null | undefined): string {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return "";
  if (r === "owner") return "Vlastník";
  if (r === "admin") return "Administrátor";
  if (r === "accountant") return "Účetní";
  if (r === "employee") return "Zaměstnanec";
  if (r === "manager") return "Manažer";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/**
 * Identita aktéra pro server-side audit — pouze z ověřeného callera, Firebase Auth a Firestore.
 */
export async function resolveServerActivityActor(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  companyData?: Record<string, unknown> | null
): Promise<ServerActivityActor> {
  const auth = getAdminAuth();
  let authEmail: string | null = null;
  let authDisplayName: string | null = null;
  if (auth) {
    try {
      const record = await auth.getUser(caller.uid);
      authEmail = record.email?.trim() || null;
      authDisplayName = record.displayName?.trim() || null;
    } catch {
      /* profil Auth nemusí existovat */
    }
  }

  const userSnap = await db.collection("users").doc(caller.uid).get();
  const userData = userSnap.data() as Record<string, unknown> | undefined;
  const userEmail =
    typeof userData?.email === "string" && userData.email.trim()
      ? userData.email.trim()
      : authEmail;

  const employee = await resolveEmployeeRecordForCaller(db, caller, {
    reconcileUserLink: false,
  });
  const empDoc = employee?.employeeDoc;
  const ownerUid = companyOwnerUidFromRecord(companyData ?? undefined);
  const effectiveRole = effectivePortalRoleForCaller(
    caller,
    empDoc ?? null,
    { companyOwnerUid: ownerUid }
  );

  const employeeName =
    String(empDoc?.displayName ?? empDoc?.name ?? "").trim() ||
    String(userData?.displayName ?? "").trim() ||
    authDisplayName ||
    (userEmail ? userEmail.split("@")[0] : "") ||
    "Uživatel";

  const roleLabelCs = portalRoleLabelCs(effectiveRole);
  const displayWithRole = roleLabelCs
    ? `${employeeName} · ${roleLabelCs}`
    : employeeName;

  const employeeId =
    employee?.employeeId ??
    (caller.employeeId?.trim() ? caller.employeeId.trim() : null);

  return {
    userId: caller.uid,
    employeeId,
    employeeName,
    employeeEmail: userEmail,
    role: effectiveRole,
    roleLabelCs,
    displayWithRole,
  };
}
