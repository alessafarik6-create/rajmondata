import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetIntegrationRef } from "@/lib/fleet/stores";
import { clearSatelitniOAuthTokens } from "@/lib/integrations/satelitni-sledovani/store";
import { writeSatelitniFleetAudit } from "@/lib/integrations/satelitni-sledovani/fleet-audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const organizationId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!fleetTenantOk(auth.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  await clearSatelitniOAuthTokens(auth.db, organizationId);
  await fleetIntegrationRef(auth.db, organizationId).set(
    {
      status: "not_connected",
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeSatelitniFleetAudit(auth.db, {
    organizationId,
    userId: auth.caller.uid,
    action: "GPS_DISCONNECTED",
  });

  return NextResponse.json({ ok: true, message: "SatelitníSledování.cz bylo odpojeno." });
}
