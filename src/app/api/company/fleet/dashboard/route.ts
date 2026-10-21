import { NextRequest, NextResponse } from "next/server";
import { requireFleetRead, fleetTenantOk } from "@/lib/fleet/api-auth";
import { listFleetTrips, listFleetVehicles, loadFleetIntegration } from "@/lib/fleet/stores";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";
import { demoPositionsForVehicles, isFleetDemoModeEnabled } from "@/lib/fleet/demo-data";
import {
  computeFleetDashboardStats,
  snapshotsFromFleetVehicles,
} from "@/lib/fleet/fleet-dashboard-stats";
import { serializeVehicle } from "@/lib/fleet/serialize";
import { refreshSatelitniLivePositionsIfDue } from "@/lib/integrations/satelitni-sledovani/sync-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const refreshLive =
    request.nextUrl.searchParams.get("live") === "1" ||
    request.nextUrl.searchParams.get("refreshPositions") === "1";

  const integration = await loadFleetIntegration(perm.db, companyId);
  const { configured, providerKind } = await resolveFleetProviderForOrg(perm.db, companyId);
  const demo = isFleetDemoModeEnabled();

  let liveRefresh: { refreshed: boolean; vehiclesWithGps?: number } | null = null;
  if (configured && providerKind === "SATELITNI_SLEDOVANI" && refreshLive) {
    try {
      liveRefresh = await refreshSatelitniLivePositionsIfDue(perm.db, companyId, false);
    } catch (e) {
      console.warn("[fleet/dashboard] live position refresh", e instanceof Error ? e.message : e);
    }
  }

  const allVehicles = await listFleetVehicles(perm.db, companyId);
  const vehicles = allVehicles.filter((v) => v.archived !== true && v.active !== false);

  let positions = snapshotsFromFleetVehicles(vehicles);
  if (configured && positions.length === 0) {
    const { provider } = await resolveFleetProviderForOrg(perm.db, companyId);
    positions = await provider.getVehiclePositions();
  } else if (demo && vehicles.length > 0 && !configured) {
    positions = demoPositionsForVehicles(
      vehicles.map((v) => ({ id: v.id, licensePlate: v.licensePlate, name: v.name }))
    );
  }

  const stats = computeFleetDashboardStats(vehicles.length, positions);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthTrips = await listFleetTrips(perm.db, companyId, {
    from: monthStart,
    to: new Date(),
    limit: 3000,
  });
  const monthKm = monthTrips.reduce((s, t) => s + Number(t.distanceKm ?? 0), 0);
  stats.monthKm = Math.round(monthKm * 10) / 10;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTrips = monthTrips.filter((t) => {
    const started = t.startedAt?.toDate?.()?.getTime?.() ?? 0;
    return started >= todayStart.getTime();
  });
  stats.todayKm = Math.round(todayTrips.reduce((s, t) => s + Number(t.distanceKm ?? 0), 0) * 10) / 10;

  return NextResponse.json({
    ok: true,
    gpsConnected: configured,
    demoMode: demo && !configured,
    integrationStatus: integration?.status ?? "not_connected",
    liveRefresh,
    message: configured
      ? null
      : demo
        ? null
        : "GPS monitoring není připojen. Propojte SatelitníSledování.cz v Nastavení → Integrace → GPS / Vozový park.",
    stats,
    vehicles: vehicles.map(serializeVehicle),
    positions,
  });
}
