import type { FleetPositionSnapshot, FleetTripDoc, FleetVehicleMovementStatus } from "@/lib/fleet/types";
import type { Timestamp } from "firebase-admin/firestore";

/** Demo režim — pouze explicitně zapnutý, nikdy v produkci jako falešná data. */
export function isFleetDemoModeEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return String(process.env.FLEET_DEMO_DATA ?? "").trim() === "1";
}

export function demoPositionsForVehicles(
  vehicles: { id: string; licensePlate: string; name: string }[]
): FleetPositionSnapshot[] {
  const baseLat = 49.5938;
  const baseLng = 15.0797;
  return vehicles.map((v, i) => ({
    vehicleId: v.id,
    lat: baseLat + i * 0.02,
    lng: baseLng + i * 0.015,
    speedKmh: i === 0 ? 62 : 0,
    movementStatus: (i === 0 ? "moving" : "idle") as FleetVehicleMovementStatus,
    recordedAt: new Date().toISOString(),
    locationLabel: i === 0 ? "D1 směr Praha" : "Depo — parkoviště",
    ignitionOn: i === 0,
  }));
}

export function demoDashboardStats(positions: FleetPositionSnapshot[]) {
  const total = positions.length;
  const online = positions.filter((p) => p.movementStatus !== "offline").length;
  const moving = positions.filter((p) => p.movementStatus === "moving").length;
  const idle = positions.filter((p) => p.movementStatus === "idle" || p.movementStatus === "parked").length;
  const offline = total - online;
  const todayKm = positions.reduce((s, p) => s + (p.movementStatus === "moving" ? 48 : 12), 0);
  return { total, online, moving, idle, offline, todayKm };
}

/** Ukázková jízda pro UI mapy/timeline v demo režimu. */
export function demoTripRoute() {
  return {
    start: { lat: 49.5938, lng: 15.0797, address: "Výsonín", at: new Date().toISOString() },
    end: { lat: 50.0343, lng: 15.7812, address: "Pardubice", at: new Date().toISOString() },
    points: [
      { lat: 49.5938, lng: 15.0797, recordedAt: new Date().toISOString(), speedKmh: 0 },
      { lat: 49.72, lng: 15.35, recordedAt: new Date().toISOString(), speedKmh: 78 },
      { lat: 50.0343, lng: 15.7812, recordedAt: new Date().toISOString(), speedKmh: 0 },
    ],
    stops: [
      {
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        endedAt: new Date(Date.now() - 2700000).toISOString(),
        address: "Výsonín",
        lat: 49.5938,
        lng: 15.0797,
      },
    ],
  };
}

export type DemoTripRow = Partial<FleetTripDoc> & { id: string };

export function demoTrips(vehicleId: string): DemoTripRow[] {
  const now = Date.now();
  return [
    {
      id: "demo-trip-1",
      organizationId: "",
      vehicleId,
      startedAt: { toDate: () => new Date(now - 4 * 3600000) } as Timestamp,
      endedAt: { toDate: () => new Date(now - 3 * 3600000) } as Timestamp,
      startAddress: "Výsonín",
      endAddress: "Pardubice",
      distanceKm: 52,
      durationMinutes: 44,
      idleMinutes: 84,
      avgSpeedKmh: 58,
      maxSpeedKmh: 92,
    },
  ];
}
