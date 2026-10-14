import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import {
  canAccessPortalModule,
  resolveEffectivePortalPermissions,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import { effectivePortalRoleForCaller } from "@/lib/portal-caller-role";

const MODULE: PortalModuleId = "productCatalogs";

export type CatalogAuthDiagnostic = {
  uid: string;
  companyId: string;
  usersRole: string;
  employeeId: string | null;
  effectivePortalRole: string;
  module: PortalModuleId;
  operation: string;
  storedProductCatalogs: string | null;
  canRead: boolean;
  canWrite: boolean;
  authorized: boolean;
  denialReason: string | null;
};

export function buildCatalogAuthDiagnostic(
  caller: VerifiedCompanyCaller,
  employeeDoc: Record<string, unknown> | null,
  operation: string,
  required: "read" | "write"
): CatalogAuthDiagnostic {
  const effectivePortalRole = effectivePortalRoleForCaller(caller, employeeDoc);
  const permissions = resolveEffectivePortalPermissions({
    role: effectivePortalRole,
    globalRoles: caller.globalRoles,
    employeeDoc,
  });
  const raw = employeeDoc?.portalModulePermissions;
  const stored =
    raw && typeof raw === "object"
      ? String((raw as Record<string, unknown>).productCatalogs ?? "").trim() || null
      : null;

  const canRead = canAccessPortalModule(permissions, MODULE, "read");
  const canWrite = canAccessPortalModule(permissions, MODULE, "write");
  const authorized = required === "write" ? canWrite : canRead;

  let denialReason: string | null = null;
  if (!authorized) {
    denialReason =
      required === "write"
        ? "Efektivní oprávnění modulu productCatalogs není write (matice, role nebo cap)."
        : "Efektivní oprávnění modulu productCatalogs není read.";
  }

  return {
    uid: caller.uid,
    companyId: caller.companyId,
    usersRole: caller.role,
    employeeId: caller.employeeId,
    effectivePortalRole,
    module: MODULE,
    operation,
    storedProductCatalogs: stored,
    canRead,
    canWrite,
    authorized,
    denialReason,
  };
}

export function logCatalogAuthDiagnostic(diag: CatalogAuthDiagnostic): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[product-catalogs/auth]", diag);
}
