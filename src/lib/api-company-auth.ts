import type { DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export { isCompanyPrivileged } from "@/lib/company-privilege";

export type PortalPreviewCallerMeta = {
  active: true;
  subjectEmployeeId: string;
  subjectDisplayName: string;
  realRole: string;
  realEmployeeId: string | null;
};

export type VerifiedCompanyCaller = {
  uid: string;
  /** ID organizace (`users.companyId` nebo `users.organizationId`). */
  companyId: string;
  role: string;
  employeeId: string | null;
  globalRoles: string[];
  portalPreview?: PortalPreviewCallerMeta;
  /** Původní role před režimem náhledu. */
  realRole?: string;
  realEmployeeId?: string | null;
};

export async function verifyCompanyBearer(
  authHeader: string | null,
  opts?: VerifyCompanyBearerWithPortalOptions
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
  const callerData = callerSnap.data() as Record<string, unknown> | undefined;
  if (!callerData) {
    return { ok: false, status: 403, error: "Profil uživatele neexistuje." };
  }
  const companyId = String(callerData.companyId || callerData.organizationId || "").trim();
  const role = String(callerData.role || "employee");
  const employeeId =
    callerData.employeeId != null && String(callerData.employeeId).trim() !== ""
      ? String(callerData.employeeId).trim()
      : null;
  const globalRoles = Array.isArray(callerData.globalRoles)
    ? callerData.globalRoles.map((x) => String(x))
    : [];
  if (!companyId) {
    return { ok: false, status: 403, error: "Chybí organizace." };
  }
  const baseCaller: VerifiedCompanyCaller = {
    uid,
    companyId,
    role,
    employeeId,
    globalRoles,
  };
  const { applyPortalPreviewToCaller, portalPreviewBlocksMutation } = await import(
    "@/lib/portal-preview-server"
  );
  const caller = await applyPortalPreviewToCaller(db, baseCaller);

  const method = opts?.method;
  if (method) {
    const { httpMethodRequiresWrite } = await import("@/lib/portal-permissions-server");
    const pathname = opts.pathname ?? "";
    if (
      portalPreviewBlocksMutation(caller, { allowPreviewEnd: true, pathname }) &&
      httpMethodRequiresWrite(method)
    ) {
      return {
        ok: false,
        status: 403,
        error:
          "Režim náhledu je pouze pro čtení. Ukončete náhled pro provedení změn.",
      };
    }
  }

  return {
    ok: true,
    db,
    caller,
  };
}

/** Bearer ověření z HTTP požadavku včetně blokace zápisu v režimu náhledu portálu. */
export async function verifyCompanyBearerFromRequest(
  request: Request
): Promise<
  | { ok: true; caller: VerifiedCompanyCaller; db: NonNullable<ReturnType<typeof getAdminFirestore>> }
  | { ok: false; status: number; error: string }
> {
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    pathname = "";
  }
  return verifyCompanyBearer(request.headers.get("authorization"), {
    method: request.method,
    pathname,
  });
}

export function jobSnapData(snap: DocumentSnapshot): Record<string, unknown> | null {
  if (!snap.exists) return null;
  return snap.data() as Record<string, unknown>;
}

export type VerifyCompanyBearerWithPortalOptions = {
  moduleId?: import("@/lib/portal-permissions").PortalModuleId | null;
  method?: string;
  pathname?: string;
};

/** Bearer token + volitelná kontrola NONE/READ/WRITE modulu portálu. */
export async function verifyCompanyBearerWithPortalAccess(
  authHeader: string | null,
  opts?: VerifyCompanyBearerWithPortalOptions
): Promise<
  | {
      ok: true;
      caller: VerifiedCompanyCaller;
      db: NonNullable<ReturnType<typeof getAdminFirestore>>;
    }
  | { ok: false; status: number; error: string }
> {
  const base = await verifyCompanyBearer(authHeader, {
    method: opts?.method,
    pathname: opts?.pathname,
  });
  if (!base.ok) return base;

  if (!opts?.moduleId && !opts?.pathname) {
    return base;
  }
  const { requirePortalAccessForRequest } = await import("@/lib/portal-permissions-server");
  const check = await requirePortalAccessForRequest(base.db, base.caller, {
    moduleId: opts.moduleId ?? null,
    method: opts.method ?? "GET",
    pathname: opts.pathname,
  });
  if (!check.ok) {
    return { ok: false, status: check.status, error: check.error };
  }
  return base;
}
