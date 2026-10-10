import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { requireFleetWrite, requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";
import { syncSatelitniFleetForOrganization } from "@/lib/integrations/satelitni-sledovani/sync-service";
import { writeSatelitniFleetAudit } from "@/lib/integrations/satelitni-sledovani/fleet-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };

  const fleetWrite = await requireFleetWrite(request);
  let db: Firestore;
  let userId: string;
  let companyIdFromCaller: string;

  if (fleetWrite.ok) {
    db = fleetWrite.db;
    userId = fleetWrite.caller.uid;
    companyIdFromCaller = fleetWrite.caller.companyId;
  } else {
    const admin = await requireFleetIntegrationAdmin(request);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: fleetWrite.error }, { status: fleetWrite.status });
    }
    db = admin.db;
    userId = admin.caller.uid;
    companyIdFromCaller = admin.caller.companyId;
  }

  const organizationId = String(body.companyId ?? companyIdFromCaller).trim();
  if (!fleetTenantOk({ companyId: companyIdFromCaller }, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { configured, providerKind } = await resolveFleetProviderForOrg(db, organizationId);
  if (!configured || providerKind !== "SATELITNI_SLEDOVANI") {
    return NextResponse.json(
      { ok: false, error: "SatelitníSledování.cz není připojeno." },
      { status: 400 }
    );
  }

  await writeSatelitniFleetAudit(db, {
    organizationId,
    userId,
    action: "GPS_SYNC_STARTED",
  });

  try {
    const result = await syncSatelitniFleetForOrganization(db, organizationId);
    await writeSatelitniFleetAudit(db, {
      organizationId,
      userId,
      action: "GPS_SYNC_FINISHED",
      metadata: {
        vehiclesTotal: result.vehiclesTotal,
        vehiclesUpdated: result.vehiclesUpdated,
        errors: result.errors.length,
      },
    });
    return NextResponse.json({
      ok: true,
      message: result.summaryMessage,
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Synchronizace selhala.";
    await writeSatelitniFleetAudit(db, {
      organizationId,
      userId,
      action: "GPS_SYNC_ERROR",
      metadata: { message: msg.slice(0, 300) },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
