import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import {
  canAccessPortalModule,
  portalModuleIdFromPathname,
  portalPermissionsAllowMutation,
  resolveEffectivePortalPermissions,
  type PortalModuleId,
} from "@/lib/portal-permissions";

export async function loadEmployeeDocForCaller(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<Record<string, unknown> | null> {
  if (!caller.employeeId) return null;
  const snap = await db
    .collection("companies")
    .doc(caller.companyId)
    .collection("employees")
    .doc(caller.employeeId)
    .get();
  if (!snap.exists) return null;
  return snap.data() as Record<string, unknown>;
}

export async function resolveCallerPortalPermissions(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<ReturnType<typeof resolveEffectivePortalPermissions>> {
  const employeeDoc = await loadEmployeeDocForCaller(db, caller);
  return resolveEffectivePortalPermissions({
    role: caller.role,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });
}

export type PortalPermissionCheckResult =
  | { ok: true; permissions: ReturnType<typeof resolveEffectivePortalPermissions> }
  | { ok: false; status: number; error: string };

export async function requirePortalModuleAccess(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  moduleId: PortalModuleId,
  required: "read" | "write"
): Promise<PortalPermissionCheckResult> {
  const permissions = await resolveCallerPortalPermissions(db, caller);
  if (!canAccessPortalModule(permissions, moduleId, required)) {
    return {
      ok: false,
      status: 403,
      error:
        required === "write"
          ? "K této akci nemáte oprávnění (vyžadován zápis)."
          : "K této sekci nemáte oprávnění.",
    };
  }
  if (required === "write" && !portalPermissionsAllowMutation(permissions, moduleId, caller.role)) {
    return {
      ok: false,
      status: 403,
      error: "Tato role smí data pouze prohlížet.",
    };
  }
  return { ok: true, permissions };
}

export function httpMethodRequiresWrite(method: string): boolean {
  const m = String(method ?? "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

/** Mapování API cest na modul (rozšiřitelné). */
export function portalModuleIdFromApiPath(pathname: string): PortalModuleId | null {
  const p = String(pathname ?? "");
  if (p.includes("/inquiry-offers/")) return "offers";
  if (p.includes("/inquiry-ai/")) return "leads";
  if (p.includes("/portal-invoices/") || p.includes("/platform-invoices/")) return "invoices";
  if (p.includes("/production/")) return "vyroba";
  if (p.includes("/meeting-records/")) return "meetingRecords";
  if (p.includes("/employees/")) return "employees";
  if (p.includes("/documents/")) return "documents";
  if (p.includes("/jobs/")) return "jobs";
  if (p.includes("/email-mailbox/")) return "emails";
  if (p.includes("/fleet/")) return "fleet";
  if (p.includes("/hikvision/")) return "cameras";
  if (p.includes("/ai/")) return "aiCenter";
  if (p.includes("/daily-work-reports/")) return "labor";
  return null;
}

export async function requirePortalAccessForRequest(
  db: Firestore,
  caller: VerifiedCompanyCaller,
  opts: { moduleId: PortalModuleId | null; method: string; pathname?: string }
): Promise<PortalPermissionCheckResult> {
  let moduleId = opts.moduleId;
  if (!moduleId && opts.pathname) {
    moduleId = portalModuleIdFromApiPath(opts.pathname) ?? portalModuleIdFromPathname(opts.pathname);
  }
  if (!moduleId) {
    return { ok: true, permissions: await resolveCallerPortalPermissions(db, caller) };
  }
  const required = httpMethodRequiresWrite(opts.method) ? "write" : "read";
  return requirePortalModuleAccess(db, caller, moduleId, required);
}

/** Alias: `requirePermission("documents", "WRITE")` v API routes. */
export { requirePortalModuleAccess as requirePermission };
