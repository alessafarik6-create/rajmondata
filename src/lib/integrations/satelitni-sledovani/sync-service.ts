import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { fleetIntegrationRef, fleetVehiclesCol } from "@/lib/fleet/stores";
import { fetchAllSatelitniPages, satelitniRequest } from "@/lib/integrations/satelitni-sledovani/client";
import {
  fleetVehicleDocIdForExternal,
  mapSatelitniLatestPosition,
  mapSatelitniVehicle,
  type SatelitniPositionApi,
  type SatelitniVehicleApi,
} from "@/lib/integrations/satelitni-sledovani/mappers";
import { satelitniSyncConcurrency } from "@/lib/integrations/satelitni-sledovani/config";
import type { FleetVehicleDoc } from "@/lib/fleet/types";

export type SatelitniSyncResult = {
  vehiclesTotal: number;
  vehiclesUpdated: number;
  errors: { vehicleId: string; message: string }[];
  lastSyncAt: string;
};

async function runLimited<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function syncSatelitniFleetForOrganization(
  db: Firestore,
  organizationId: string
): Promise<SatelitniSyncResult> {
  const vehicles = await fetchAllSatelitniPages<SatelitniVehicleApi>(db, organizationId, "/vehicles", {
    pageLimit: 1000,
  });

  let vehiclesUpdated = 0;
  const errors: SatelitniSyncResult["errors"] = [];

  for (const v of vehicles) {
    const mapped = mapSatelitniVehicle(v);
    if (!mapped.externalVehicleId || mapped.externalVehicleId === "0") continue;
    const docId = fleetVehicleDocIdForExternal(mapped.externalVehicleId);
    const patch: Partial<FleetVehicleDoc> = {
      organizationId,
      name: mapped.name,
      licensePlate: mapped.licensePlate || "—",
      vin: mapped.vin,
      externalProvider: "SATELITNI_SLEDOVANI",
      externalVehicleId: mapped.externalVehicleId,
      externalDeviceId: mapped.externalDeviceId,
      active: true,
      updatedAt: FieldValue.serverTimestamp() as unknown as FleetVehicleDoc["updatedAt"],
    };
    await fleetVehiclesCol(db, organizationId).doc(docId).set(patch, { merge: true });
    vehiclesUpdated += 1;
  }

  const externalIds = vehicles
    .map((v) => mapSatelitniVehicle(v).externalVehicleId)
    .filter((id) => id && id !== "0");

  await runLimited(externalIds, satelitniSyncConcurrency(), async (externalVehicleId) => {
    try {
      const { data } = await satelitniRequest<SatelitniPositionApi>(
        db,
        organizationId,
        `/vehicles/${encodeURIComponent(externalVehicleId)}/positions/latest`
      );
      const pos = mapSatelitniLatestPosition(data);
      if (!pos) return;
      const docId = fleetVehicleDocIdForExternal(externalVehicleId);
      await fleetVehiclesCol(db, organizationId).doc(docId).set(
        {
          lastLatitude: pos.lat,
          lastLongitude: pos.lng,
          lastSpeedKmh: pos.speedKmh,
          lastMovementStatus: pos.movementStatus,
          lastPositionAt: pos.receivedAt ? Timestamp.fromDate(new Date(pos.receivedAt)) : FieldValue.serverTimestamp(),
          ignitionOn: pos.ignitionOn,
          externalDeviceId: pos.deviceId ?? undefined,
          lastTelemetry: pos.telemetry ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      errors.push({
        vehicleId: externalVehicleId,
        message: e instanceof Error ? e.message : "Chyba polohy",
      });
    }
  });

  const lastSyncAt = new Date().toISOString();
  await fleetIntegrationRef(db, organizationId).set(
    {
      organizationId,
      provider: "SATELITNI_SLEDOVANI",
      status: "connected",
      lastSyncAt: Timestamp.fromDate(new Date(lastSyncAt)),
      lastSyncVehicleCount: vehicles.length,
      lastSyncError: errors.length ? `${errors.length} vozidel s chybou polohy` : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    vehiclesTotal: vehicles.length,
    vehiclesUpdated,
    errors,
    lastSyncAt,
  };
}
