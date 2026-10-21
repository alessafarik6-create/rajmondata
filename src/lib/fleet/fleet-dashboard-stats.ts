import type { FleetPositionSnapshot, FleetVehicleMovementStatus } from "@/lib/fleet/types";
import { isValidFleetCoordinates } from "@/lib/integrations/satelitni-sledovani/mappers";

export type FleetDashboardStats = {
  total: number;
  online: number;
  moving: number;
  idle: number;
  offline: number;
  withoutGps: number;
  todayKm: number;
  monthKm?: number;
};

export function vehicleHasValidGps(v: {
  lastLatitude?: number | null;
  lastLongitude?: number | null;
}): boolean {
  if (v.lastLatitude == null || v.lastLongitude == null) return false;
  return isValidFleetCoordinates(v.lastLatitude, v.lastLongitude);
}

export function snapshotsFromFleetVehicles(
  vehicles: {
    id: string;
    lastLatitude?: number | null;
    lastLongitude?: number | null;
    lastSpeedKmh?: number | null;
    lastHeadingDeg?: number | null;
    lastMovementStatus?: FleetVehicleMovementStatus | null;
    lastLocationLabel?: string | null;
    lastPositionAt?: { toDate?: () => Date } | null;
    ignitionOn?: boolean | null;
  }[]
): FleetPositionSnapshot[] {
  const out: FleetPositionSnapshot[] = [];
  for (const v of vehicles) {
    if (!vehicleHasValidGps(v)) continue;
    out.push({
      vehicleId: v.id,
      lat: v.lastLatitude!,
      lng: v.lastLongitude!,
      speedKmh: v.lastSpeedKmh ?? null,
      headingDeg: v.lastHeadingDeg ?? null,
      movementStatus: v.lastMovementStatus ?? "unknown",
      recordedAt: v.lastPositionAt?.toDate?.()?.toISOString?.() ?? "",
      locationLabel: v.lastLocationLabel ?? null,
      ignitionOn: v.ignitionOn ?? null,
    });
  }
  return out;
}

export function computeFleetDashboardStats(
  vehicleCount: number,
  positions: FleetPositionSnapshot[]
): FleetDashboardStats {
  const withGps = positions.filter((p) => isValidFleetCoordinates(p.lat, p.lng));
  const moving = withGps.filter((p) => p.movementStatus === "moving").length;
  const idle = withGps.filter(
    (p) => p.movementStatus === "idle" || p.movementStatus === "parked"
  ).length;
  const offline = withGps.filter((p) => p.movementStatus === "offline").length;
  const unknown = withGps.filter((p) => p.movementStatus === "unknown").length;
  const online = moving + idle + unknown;

  const todayKm = withGps.reduce((s, p) => {
    if (p.movementStatus !== "moving" && p.movementStatus !== "idle") return s;
    return s + Math.max(0, (p.speedKmh ?? 0) * 0.02);
  }, 0);

  return {
    total: vehicleCount,
    online,
    moving,
    idle,
    offline,
    withoutGps: Math.max(0, vehicleCount - withGps.length),
    todayKm: Math.round(todayKm * 10) / 10,
  };
}
