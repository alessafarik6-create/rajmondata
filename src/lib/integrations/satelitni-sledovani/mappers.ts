import type { FleetVehicleMovementStatus } from "@/lib/fleet/types";
import { satelitniOfflineThresholdMinutes } from "@/lib/integrations/satelitni-sledovani/config";

export type SatelitniVehicleApi = Record<string, unknown>;

/** Stabilní externí ID pro upsert — preferuje vehicle id, jinak device id. */
export function pickSatelitniExternalVehicleId(v: SatelitniVehicleApi): string | null {
  const candidates = [v.id, v.vehicle_id, v.vehicleId];
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

  const speed = pickNumber(p, ["speed", "speed_kmh"]);
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

  const movementStatus = deriveMovementStatus(speed ?? 0, receivedAt);

  return {
    lat,
    lng,
    speedKmh: speed,
    heading: pickNumber(p, ["course", "heading"]),
    receivedAt,
    createdAt: createdRaw || null,
    deviceId: p.device_id != null ? String(p.device_id) : null,
    telemetry,
    movementStatus,
    ignitionOn,
  };
}

export function deriveMovementStatus(
  speedKmh: number,
  receivedAtIso: string | null
): FleetVehicleMovementStatus {
  const offlineMs = satelitniOfflineThresholdMinutes() * 60 * 1000;
  if (receivedAtIso) {
    const t = Date.parse(receivedAtIso);
    if (Number.isFinite(t) && Date.now() - t > offlineMs) return "offline";
  }
  if (speedKmh > 3) return "moving";
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
