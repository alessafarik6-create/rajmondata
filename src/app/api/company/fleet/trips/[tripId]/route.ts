import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireFleetRead, requireFleetWrite, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetTripsCol } from "@/lib/fleet/stores";
import { serializeTrip } from "@/lib/fleet/serialize";
import { demoTripRoute, isFleetDemoModeEnabled } from "@/lib/fleet/demo-data";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";
import type { FleetTripDoc } from "@/lib/fleet/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const perm = await requireFleetRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const { tripId } = await ctx.params;
  const snap = await fleetTripsCol(perm.db, companyId).doc(tripId).get();
  const { configured, provider } = await resolveFleetProviderForOrg(perm.db, companyId);

  if (!snap.exists) {
    if (isFleetDemoModeEnabled() && tripId.startsWith("demo-")) {
      return NextResponse.json({
        ok: true,
        demoMode: true,
        trip: {
          id: tripId,
          vehicleId: "",
          startAddress: "Výsonín",
          endAddress: "Pardubice",
          distanceKm: 52,
          durationMinutes: 44,
          idleMinutes: 84,
        },
        route: demoTripRoute(),
      });
    }
    return NextResponse.json({ ok: false, error: "Jízda nenalezena." }, { status: 404 });
  }
  const trip = { id: snap.id, ...(snap.data() as FleetTripDoc) };
  let route = null;
  if (configured && trip.externalTripId) {
    route = await provider.getRoute(trip.externalTripId);
  } else if (isFleetDemoModeEnabled()) {
    route = demoTripRoute();
  }
  return NextResponse.json({
    ok: true,
    trip: serializeTrip(trip),
    route,
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const perm = await requireFleetWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { tripId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (body.jobId !== undefined) patch.jobId = body.jobId;
  if (body.jobLabel !== undefined) patch.jobLabel = body.jobLabel;
  await fleetTripsCol(perm.db, companyId).doc(tripId).update(patch);
  return NextResponse.json({ ok: true });
}
