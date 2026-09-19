import { NextRequest, NextResponse } from "next/server";
import { requireFleetRead, fleetTenantOk } from "@/lib/fleet/api-auth";
import { listFleetVehicles, loadFleetIntegration } from "@/lib/fleet/stores";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";
import { demoDashboardStats, demoPositionsForVehicles, isFleetDemoModeEnabled } from "@/lib/fleet/demo-data";
import { serializeVehicle } from "@/lib/fleet/serialize";

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

  const vehicles = await listFleetVehicles(perm.db, companyId);
  const integration = await loadFleetIntegration(perm.db, companyId);
  const { configured } = await resolveFleetProviderForOrg(perm.db, companyId);
  const demo = isFleetDemoModeEnabled();

  let positions: ReturnType<typeof demoPositionsForVehicles> = [];
  if (configured) {
    const { provider } = await resolveFleetProviderForOrg(perm.db, companyId);
    positions = await provider.getVehiclePositions();
  } else if (demo && vehicles.length > 0) {
    positions = demoPositionsForVehicles(
      vehicles.map((v) => ({ id: v.id, licensePlate: v.licensePlate, name: v.name }))
    );
  }

  const stats = demoDashboardStats(
    positions.length
      ? positions
      : vehicles.map((v) => ({
          vehicleId: v.id,
          lat: v.lastLatitude ?? 0,
          lng: v.lastLongitude ?? 0,
          movementStatus: v.lastMovementStatus ?? "unknown",
          recordedAt: v.lastPositionAt?.toDate?.()?.toISOString?.() ?? "",
          speedKmh: v.lastSpeedKmh ?? null,
        }))
  );

  return NextResponse.json({
    ok: true,
    gpsConnected: configured,
    demoMode: demo && !configured,
    integrationStatus: integration?.status ?? "not_connected",
    message: configured
      ? null
      : demo
        ? null
        : "GPS monitoring zatím není připojen. Nastavte Ecofleet v Nastavení → Integrace → GPS / Vozový park.",
    stats,
    vehicles: vehicles.map(serializeVehicle),
    positions,
  });
}
