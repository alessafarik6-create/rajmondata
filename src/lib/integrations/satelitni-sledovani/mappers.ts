import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";
import { satelitniOfflineThresholdMinutes } from "@/lib/integrations/satelitni-sledovani/config";

export type SatelitniVehicleApi = Record<string, unknown>;

export function isValidFleetCoordinates(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

/** Stabilní externí ID vozidla pro REST `/vehicles/{id}` — nikoli device id, pokud existuje vehicle id. */
export function pickSatelitniExternalVehicleId(v: SatelitniVehicleApi): string | null {
  const candidates = [
    v.id,
    v.vehicle_id,
    v.vehicleId,
    v.code,
    v.vehicle_code,
    v.number,
    v.vehicle_number,
  ];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const s = String(c).trim();
    if (s && s !== "0") return s;
  }
  const dev = v.device_id ?? v.deviceId;
  if (dev != null && String(dev).trim() && String(dev).trim() !== "0") {
    return String(dev).trim();
  }
  return null;
}

export function mapSatelitniVehicle(v: SatelitniVehicleApi) {
  const externalVehicleId = pickSatelitniExternalVehicleId(v) ?? "0";
  const label = String(v.label ?? v.name ?? v.title ?? "").trim();
  const sub = String(v.sub_label ?? v.subtitle ?? "").trim();
  const name =
    [label, sub].filter(Boolean).join(" — ") ||
    `Vozidlo ${externalVehicleId !== "0" ? externalVehicleId : "?"}`;
  const deviceRaw = v.device_id ?? v.deviceId;
  return {
    externalVehicleId,
    name,
    licensePlate: String(v.car_sign ?? v.registration_number ?? v.spz ?? v.plate ?? "").trim(),
    vin: String(v.vin ?? "").trim() || null,
    externalDeviceId: deviceRaw != null ? String(deviceRaw).trim() : null,
    vehicleType: v.type != null ? String(v.type) : null,
  };
}

export type SatelitniPositionApi = Record<string, unknown>;

export function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = Number(obj[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function mapSatelitniLatestPosition(
  p: SatelitniPositionApi
): {
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  receivedAt: string | null;
  createdAt: string | null;
  deviceId: string | null;
  telemetry: Record<string, unknown> | null;
  movementStatus: FleetVehicleMovementStatus;
  ignitionOn: boolean | null;
} | null {
  const lat = pickNumber(p, ["latitude", "lat"]);
  const lng = pickNumber(p, ["longitude", "lng", "lon"]);
  if (lat == null || lng == null) return null;
  if (!isValidFleetCoordinates(lat, lng)) return null;

  let speed = pickNumber(p, ["speed", "speed_kmh", "speedKmh"]);
  if (speed != null && speed > 250) {
    speed = Math.round((speed * 3.6 + Number.EPSILON) * 10) / 10;
  }
  const receivedRaw = String(p.received ?? p.received_at ?? "").trim();
  const createdRaw = String(p.created ?? p.created_at ?? "").trim();
  const receivedAt = receivedRaw || createdRaw || null;

  const telemetry =
    p.telemetry && typeof p.telemetry === "object"
      ? (p.telemetry as Record<string, unknown>)
      : null;

  let ignitionOn: boolean | null = null;
  const switches = telemetry?.switches;
  if (switches && typeof switches === "object") {
    const ign = (switches as Record<string, unknown>).ignition;
    if (typeof ign === "boolean") ignitionOn = ign;
  }

  const movementStatus = deriveMovementStatus(speed ?? 0, receivedAt, ignitionOn);

  const odometerKm = pickNumber(p, ["odometer", "odometer_km", "mileage", "mileage_km"]);

  return {
    lat,
    lng,
    speedKmh: speed,
    heading: pickNumber(p, ["course", "heading"]),
    receivedAt,
    createdAt: createdRaw || null,
    deviceId: p.device_id != null ? String(p.device_id) : null,
    telemetry: telemetry
      ? {
          ...telemetry,
          ...(odometerKm != null ? { odometerKm } : {}),
        }
      : odometerKm != null
        ? { odometerKm }
        : null,
    movementStatus,
    ignitionOn,
  };
}

export function deriveMovementStatus(
  speedKmh: number,
  receivedAtIso: string | null,
  ignitionOn?: boolean | null
): FleetVehicleMovementStatus {
  const offlineMs = satelitniOfflineThresholdMinutes() * 60 * 1000;
  if (receivedAtIso) {
    const t = Date.parse(receivedAtIso);
    if (Number.isFinite(t) && Date.now() - t > offlineMs) return "offline";
  } else {
    return "unknown";
  }
  if (speedKmh > 3) return "moving";
  if (ignitionOn === false && speedKmh <= 3) return "parked";
  if (speedKmh >= 0) return "idle";
  return "unknown";
}

export function fleetVehicleDocIdForExternal(externalVehicleId: string): string {
  return `ssv-${externalVehicleId}`;
}

export function tripDocId(externalVehicleId: string, begin: string): string {
  const safe = begin.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `sst-${externalVehicleId}-${safe}`;
}
