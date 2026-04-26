import type { DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export { isCompanyPrivileged } from "@/lib/company-privilege";

export type VerifiedCompanyCaller = {
  uid: string;
  /** ID organizace (`users.companyId` nebo `users.organizationId`). */
  companyId: string;
  role: string;
  employeeId: string | null;
  globalRoles: string[];
};

export async function verifyCompanyBearer(
  authHeader: string | null
): Promise<
  | { ok: true; caller: VerifiedCompanyCaller; db: NonNullable<ReturnType<typeof getAdminFirestore>> }
  | { ok: false; status: number; error: string }
> {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return { ok: false, status: 503, error: "Firebase Admin není nakonfigurován." };
  }
  const raw = authHeader || "";
  const idToken = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!idToken) {
    return { ok: false, status: 401, error: "Chybí Authorization Bearer token." };
  }
  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return { ok: false, status: 401, error: "Neplatný token." };
  }
  const callerSnap = await db.collection("users").doc(uid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return { ok: false, status: 403, error: "Profil uživatele neexistuje." };
  }
  const companyId = String(caller.companyId || caller.organizationId || "").trim();
  const role = String(caller.role || "employee");
  const employeeId =
    caller.employeeId != null && String(caller.employeeId).trim() !== ""
      ? String(caller.employeeId).trim()
      : null;
  const globalRoles = Array.isArray(caller.globalRoles)
    ? caller.globalRoles.map((x) => String(x))
    : [];
  if (!companyId) {
    return { ok: false, status: 403, error: "Chybí organizace." };
  }
  return {
    ok: true,
    db,
    caller: { uid, companyId, role, employeeId, globalRoles },
  };
}

export function jobSnapData(snap: DocumentSnapshot): Record<string, unknown> | null {
  if (!snap.exists) return null;
  return snap.data() as Record<string, unknown>;
}
