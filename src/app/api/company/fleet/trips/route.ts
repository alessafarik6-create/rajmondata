import { NextRequest, NextResponse } from "next/server";
import { requireFleetRead, fleetTenantOk } from "@/lib/fleet/api-auth";
import { listFleetTrips } from "@/lib/fleet/stores";
import { serializeTrip } from "@/lib/fleet/serialize";
import { demoTrips, isFleetDemoModeEnabled } from "@/lib/fleet/demo-data";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireFleetRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!fleetTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicleId") ?? undefined;
  const driverUserId = request.nextUrl.searchParams.get("driverUserId") ?? undefined;
  const jobId = request.nextUrl.searchParams.get("jobId") ?? undefined;
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  const { configured } = await resolveFleetProviderForOrg(perm.db, companyId);
  let trips = await listFleetTrips(perm.db, companyId, { vehicleId, from, to, limit: 300 });

  if (trips.length === 0 && isFleetDemoModeEnabled() && !configured && vehicleId) {
    trips = demoTrips(vehicleId) as typeof trips;
  }

  if (driverUserId) {
    trips = trips.filter((t) => t.driverUserId === driverUserId);
  }
  if (jobId) {
    trips = trips.filter((t) => t.jobId === jobId);
  }

  return NextResponse.json({
    ok: true,
    demoMode: isFleetDemoModeEnabled() && !configured && trips.some((t) => t.id.startsWith("demo-")),
    trips: trips.map(serializeTrip),
  });
}
