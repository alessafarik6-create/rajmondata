import type { NextRequest } from "next/server";
import { verifyCompanyBearerFromRequest } from "@/lib/api-company-auth";
import {
  requirePortalModuleAccess,
} from "@/lib/portal-permissions-server";
import { resolveEmployeeRecordForCaller } from "@/lib/portal-employee-doc-resolve";
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

  const resolved = await resolveEmployeeRecordForCaller(base.db, base.caller);
  const employeeDoc = resolved?.employeeDoc ?? null;
  const diag = buildCatalogAuthDiagnostic(base.caller, employeeDoc, request.method, required, {
    resolvedEmployeeId: resolved?.employeeId ?? null,
    employeeDocSource: resolved?.source ?? null,
  });
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
