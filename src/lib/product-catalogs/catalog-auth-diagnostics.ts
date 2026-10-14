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
  resolvedEmployeeId: string | null;
  employeeDocSource: string | null;
  effectivePortalRole: string;
  module: PortalModuleId;
  operation: string;
  storedProductCatalogs: string | null;
  materialized: boolean;
  canRead: boolean;
  canWrite: boolean;
  authorized: boolean;
  denialReason: string | null;
};

export function buildCatalogAuthDiagnostic(
  caller: VerifiedCompanyCaller,
  employeeDoc: Record<string, unknown> | null,
  operation: string,
  required: "read" | "write",
  resolveMeta?: {
    resolvedEmployeeId?: string | null;
    employeeDocSource?: string | null;
  }
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

  const materialized = employeeDoc?.portalModulePermissionsMaterialized === true;

  return {
    uid: caller.uid,
    companyId: caller.companyId,
    usersRole: caller.role,
    employeeId: caller.employeeId,
    resolvedEmployeeId: resolveMeta?.resolvedEmployeeId ?? null,
    employeeDocSource: resolveMeta?.employeeDocSource ?? null,
    effectivePortalRole,
    module: MODULE,
    operation,
    storedProductCatalogs: stored,
    materialized,
    canRead,
    canWrite,
    authorized,
    denialReason,
  };
}

export function logCatalogAuthDiagnostic(diag: CatalogAuthDiagnostic): void {
  if (diag.authorized) return;
  console.warn("[product-catalogs/auth] zamítnuto", {
    operation: diag.operation,
    companyId: diag.companyId,
    employeeId: diag.employeeId,
    resolvedEmployeeId: diag.resolvedEmployeeId,
    employeeDocSource: diag.employeeDocSource,
    module: diag.module,
    required: diag.operation,
    storedProductCatalogs: diag.storedProductCatalogs,
    materialized: diag.materialized,
    effectivePortalRole: diag.effectivePortalRole,
    canRead: diag.canRead,
    canWrite: diag.canWrite,
    denialReason: diag.denialReason,
  });
}

export function catalogAuthUserMessage(diag: CatalogAuthDiagnostic, httpStatus: number): string {
  if (diag.authorized) return "";
  if (httpStatus === 403 && diag.denialReason) {
    if (!diag.resolvedEmployeeId) {
      return "Účet není propojen s dokumentem zaměstnance v této organizaci. Kontaktujte administrátora.";
    }
    if (diag.storedProductCatalogs !== "write") {
      return "Nemáte oprávnění Zápis k produktovým katalogům. Administrátor musí v profilu zaměstnance nastavit Produktové katalogy → Zápis a uložit oprávnění.";
    }
    return "K této akci nemáte oprávnění (vyžadován zápis do produktových katalogů).";
  }
  return "Operaci s katalogem se nepodařilo provést. Zkuste to znovu nebo kontaktujte administrátora.";
}
