import type { Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import {
  canAccessPortalModule,
  resolveEffectivePortalPermissions,
  type PortalModuleId,
} from "@/lib/portal-permissions";

const LABOR_MODULE: PortalModuleId = "labor";

export type PayrollAccessContext = {
  role: string;
  employeeId: string | null;
  permissions: ReturnType<typeof resolveEffectivePortalPermissions>;
};

export async function loadPayrollAccessContext(
  db: Firestore,
  caller: VerifiedCompanyCaller
): Promise<PayrollAccessContext> {
  let employeeDoc: Record<string, unknown> | null = null;
  if (caller.employeeId) {
    const snap = await db
      .collection("companies")
      .doc(caller.companyId)
      .collection("employees")
      .doc(caller.employeeId)
      .get();
    if (snap.exists) employeeDoc = snap.data() as Record<string, unknown>;
  }
  const permissions = resolveEffectivePortalPermissions({
    role: caller.role,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });
  return {
    role: caller.role,
    employeeId: caller.employeeId,
    permissions,
  };
}

/** Smí prohlížet mzdové údaje jiných zaměstnanců (ne vlastní). */
export function canViewOthersPayrollData(ctx: PayrollAccessContext): boolean {
  const role = normalizeCompanyRole(ctx.role);
  if (role === "owner" || role === "admin") {
    return canAccessPortalModule(ctx.permissions, LABOR_MODULE, "read");
  }
  if (role === "accountant") {
    return canAccessPortalModule(ctx.permissions, LABOR_MODULE, "read");
  }
  return false;
}

/** Smí provádět správu mezd (schvalování, zálohy, dluhy, úpravy výplat). */
export function canManageOrganizationPayroll(ctx: PayrollAccessContext): boolean {
  const role = normalizeCompanyRole(ctx.role);
  if (role === "owner" || role === "admin") {
    return canAccessPortalModule(ctx.permissions, LABOR_MODULE, "write");
  }
  if (role === "accountant") {
    return canAccessPortalModule(ctx.permissions, LABOR_MODULE, "write");
  }
  return false;
}

/** Zaměstnanec smí v labor modulu jen číst vlastní data — nikdy správu. */
export function isSelfPayrollOnlyUser(ctx: PayrollAccessContext): boolean {
  const role = normalizeCompanyRole(ctx.role);
  if (role === "employee") return true;
  if (role === "manager") return !canViewOthersPayrollData(ctx);
  return false;
}

export function assertPayrollTargetEmployee(params: {
  ctx: PayrollAccessContext;
  targetEmployeeId: string;
}): { ok: true } | { ok: false; status: number; error: string } {
  const target = String(params.targetEmployeeId || "").trim();
  if (!target) {
    return { ok: false, status: 400, error: "Chybí employeeId." };
  }
  if (canViewOthersPayrollData(params.ctx)) {
    return { ok: true };
  }
  const own = String(params.ctx.employeeId || "").trim();
  if (!own) {
    return { ok: false, status: 403, error: "Chybí vazba účtu na zaměstnance." };
  }
  if (target !== own) {
    return {
      ok: false,
      status: 403,
      error: "K mzdovým údajům jiných zaměstnanců nemáte oprávnění.",
    };
  }
  return { ok: true };
}

export function assertPayrollMutationAllowed(
  ctx: PayrollAccessContext
): { ok: true } | { ok: false; status: number; error: string } {
  if (!canManageOrganizationPayroll(ctx)) {
    return {
      ok: false,
      status: 403,
      error: "K úpravě mzdových údajů nemáte oprávnění.",
    };
  }
  return { ok: true };
}
