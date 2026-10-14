import type { NextRequest } from "next/server";
import { verifyCompanyBearerFromRequest } from "@/lib/api-company-auth";
import {
  loadEmployeeDocForCaller,
  requirePortalModuleAccess,
} from "@/lib/portal-permissions-server";
import {
  buildCatalogAuthDiagnostic,
  logCatalogAuthDiagnostic,
} from "@/lib/product-catalogs/catalog-auth-diagnostics";

export async function requireProductCatalogAccess(
  request: NextRequest,
  required: "read" | "write"
) {
  const base = await verifyCompanyBearerFromRequest(request);
  if (!base.ok) {
    return { ok: false as const, status: base.status, error: base.error };
  }

  const employeeDoc = await loadEmployeeDocForCaller(base.db, base.caller);
  const diag = buildCatalogAuthDiagnostic(base.caller, employeeDoc, request.method, required);
  logCatalogAuthDiagnostic(diag);

  const check = await requirePortalModuleAccess(base.db, base.caller, "productCatalogs", required);
  if (!check.ok) {
    return { ok: false as const, status: check.status, error: check.error, diagnostic: diag };
  }

  return {
    ok: true as const,
    db: base.db,
    caller: base.caller,
    employeeDoc,
    diagnostic: diag,
  };
}
