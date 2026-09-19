import { NextRequest, NextResponse } from "next/server";
import { requireFleetRead, fleetTenantOk } from "@/lib/fleet/api-auth";
import { listFleetTrips, listFleetVehicles } from "@/lib/fleet/stores";
import { isFleetDemoModeEnabled } from "@/lib/fleet/demo-data";

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

  const period = request.nextUrl.searchParams.get("period") ?? "week";
  const now = new Date();
  const from = new Date(now);
  if (period === "day") from.setDate(from.getDate() - 1);
  else if (period === "month") from.setMonth(from.getMonth() - 1);
  else from.setDate(from.getDate() - 7);

  const trips = await listFleetTrips(perm.db, companyId, { from, to: now, limit: 500 });
  const vehicles = await listFleetVehicles(perm.db, companyId);

  const byVehicle = new Map<string, { km: number; trips: number; driveMin: number; idleMin: number }>();
  const byDriver = new Map<string, { km: number; trips: number; name: string }>();

  for (const t of trips) {
    const v = byVehicle.get(t.vehicleId) ?? { km: 0, trips: 0, driveMin: 0, idleMin: 0 };
    v.km += t.distanceKm ?? 0;
    v.trips += 1;
    v.driveMin += t.durationMinutes ?? 0;
    v.idleMin += t.idleMinutes ?? 0;
    byVehicle.set(t.vehicleId, v);

    const driverKey = t.driverUserId ?? "unknown";
    const d = byDriver.get(driverKey) ?? { km: 0, trips: 0, name: t.driverName ?? driverKey };
    d.km += t.distanceKm ?? 0;
    d.trips += 1;
    byDriver.set(driverKey, d);
  }

  const vehicleName = new Map(vehicles.map((v) => [v.id, `${v.name} (${v.licensePlate})`]));

  return NextResponse.json({
    ok: true,
    period,
    empty: trips.length === 0,
    demoHint: trips.length === 0 && isFleetDemoModeEnabled(),
    totals: {
      trips: trips.length,
      km: trips.reduce((s, t) => s + (t.distanceKm ?? 0), 0),
      driveMinutes: trips.reduce((s, t) => s + (t.durationMinutes ?? 0), 0),
      idleMinutes: trips.reduce((s, t) => s + (t.idleMinutes ?? 0), 0),
    },
    byVehicle: [...byVehicle.entries()].map(([vehicleId, stats]) => ({
      vehicleId,
      label: vehicleName.get(vehicleId) ?? vehicleId,
      ...stats,
    })),
    byDriver: [...byDriver.entries()].map(([driverUserId, stats]) => ({
      driverUserId,
      ...stats,
    })),
  });
}
