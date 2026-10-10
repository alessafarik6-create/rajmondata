import { NextRequest, NextResponse } from "next/server";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { runSatelitniFleetDiagnostics } from "@/lib/integrations/satelitni-sledovani/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!fleetTenantOk(auth.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const diagnostics = await runSatelitniFleetDiagnostics(auth.db, organizationId);
  return NextResponse.json({ ok: true, diagnostics });
}
