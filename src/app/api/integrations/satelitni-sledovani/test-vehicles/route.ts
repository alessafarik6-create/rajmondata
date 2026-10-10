import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetIntegrationRef } from "@/lib/fleet/stores";
import { runSatelitniFleetDiagnostics } from "@/lib/integrations/satelitni-sledovani/diagnostics";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const organizationId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!fleetTenantOk(auth.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const diagnostics = await runSatelitniFleetDiagnostics(auth.db, organizationId);
  const ok = diagnostics.vehiclesApiOk && diagnostics.apiVehicleCount >= 0;

  await fleetIntegrationRef(auth.db, organizationId).set(
    {
      lastTestAt: FieldValue.serverTimestamp(),
      lastError: diagnostics.apiError,
      status: diagnostics.oauthConnected && diagnostics.vehiclesApiOk ? "connected" : "error",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({
    ok,
    message: diagnostics.message,
    apiVehicleCount: diagnostics.apiVehicleCount,
    diagnostics,
  });
}
