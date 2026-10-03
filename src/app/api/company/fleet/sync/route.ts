import { NextRequest, NextResponse } from "next/server";
import { requireFleetWrite, fleetTenantOk } from "@/lib/fleet/api-auth";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";
import { syncSatelitniFleetForOrganization } from "@/lib/integrations/satelitni-sledovani/sync-service";
import { writeSatelitniFleetAudit } from "@/lib/integrations/satelitni-sledovani/fleet-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const perm = await requireFleetWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const organizationId = String(body.companyId ?? perm.caller.companyId).trim();
  if (!fleetTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { configured, providerKind } = await resolveFleetProviderForOrg(perm.db, organizationId);
  if (!configured || providerKind !== "SATELITNI_SLEDOVANI") {
    return NextResponse.json(
      { ok: false, error: "SatelitníSledování.cz není připojeno." },
      { status: 400 }
    );
  }

  await writeSatelitniFleetAudit(perm.db, {
    organizationId,
    userId: perm.caller.uid,
    action: "GPS_SYNC_STARTED",
  });

  try {
    const result = await syncSatelitniFleetForOrganization(perm.db, organizationId);
    await writeSatelitniFleetAudit(perm.db, {
      organizationId,
      userId: perm.caller.uid,
      action: "GPS_SYNC_FINISHED",
      metadata: {
        vehiclesTotal: result.vehiclesTotal,
        vehiclesUpdated: result.vehiclesUpdated,
        errors: result.errors.length,
      },
    });
    return NextResponse.json({
      ok: true,
      message: `Synchronizováno ${result.vehiclesTotal} vozidel.`,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Synchronizace selhala.";
    await writeSatelitniFleetAudit(perm.db, {
      organizationId,
      userId: perm.caller.uid,
      action: "GPS_SYNC_ERROR",
      metadata: { message: msg.slice(0, 300) },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
