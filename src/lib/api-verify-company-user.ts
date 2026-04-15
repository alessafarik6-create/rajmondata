import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";

export type VerifiedCompanyCaller = {
  uid: string;
  companyId: string;
  role: string;
  globalRoles: string[];
  isSuperAdmin: boolean;
};

export async function verifyBearerAndLoadCaller(
  auth: Auth,
  db: Firestore,
  idToken: string
): Promise<VerifiedCompanyCaller | null> {
  if (!idToken) return null;
  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return null;
  }
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data) return null;
  const companyId = String(data.companyId ?? "").trim();
  const role = String(data.role ?? "");
  const globalRoles = Array.isArray(data.globalRoles)
    ? (data.globalRoles as string[])
    : [];
  const isSuperAdmin = globalRoles.includes("super_admin");
  return {
    uid,
    companyId,
    role,
    globalRoles,
    isSuperAdmin,
  };
}

export function callerCanAccessCompany(
  caller: VerifiedCompanyCaller,
  companyId: string
): boolean {
  if (caller.isSuperAdmin) return true;
  return caller.companyId === companyId;
}

/** Může měnit globální e-mailové notifikace firmy (nastavení portálu). */
export function callerCanManageOrgEmailSettings(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  return caller.role === "owner" || caller.role === "admin";
}

/** Může spouštět modulové notifikace (člen organizace, ne zákazník). */
export function callerCanTriggerOrgNotifications(caller: VerifiedCompanyCaller): boolean {
  if (caller.isSuperAdmin) return true;
  if (!caller.companyId) return false;
  return caller.role !== "customer";
}
