import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { fleetIntegrationRef, fleetVehiclesCol, listFleetVehicles } from "@/lib/fleet/stores";
import {
  fetchAllSatelitniPages,
  satelitniRequest,
  unwrapSatelitniResource,
} from "@/lib/integrations/satelitni-sledovani/client";
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
  /** Počet záznamů vrácených API (po parsování). */
  vehiclesTotal: number;
  /** Počet úspěšně uložených vozidel v RAJMONDATA. */
  vehiclesUpdated: number;
  vehiclesSkipped: number;
  vehiclesWithGps: number;
  storedVehicleCount: number;
  errors: { vehicleId: string; message: string }[];
  lastSyncAt: string;
  summaryMessage: string;
};

export type SatelitniSyncMode = "full" | "catalog" | "positions";

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

export async function syncSatelitniVehicleCatalogForOrganization(
  db: Firestore,
  organizationId: string
): Promise<{ vehiclesFromApi: SatelitniVehicleApi[]; vehiclesImported: number; vehiclesSkipped: number }> {
  const vehicles = await fetchAllSatelitniPages<SatelitniVehicleApi>(db, organizationId, "/vehicles", {
    pageLimit: 1000,
  });

  let vehiclesImported = 0;
  let vehiclesSkipped = 0;

  for (const v of vehicles) {
    const mapped = mapSatelitniVehicle(v);
    if (!mapped.externalVehicleId || mapped.externalVehicleId === "0") {
      vehiclesSkipped += 1;
      continue;
    }
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
    vehiclesImported += 1;
  }

  return { vehiclesFromApi: vehicles, vehiclesImported, vehiclesSkipped };
}

export async function syncSatelitniVehiclePositionsForOrganization(
  db: Firestore,
  organizationId: string,
  externalIds?: string[]
): Promise<{ vehiclesWithGps: number; errors: SatelitniSyncResult["errors"] }> {
  const ids =
    externalIds ??
    (await listFleetVehicles(db, organizationId))
      .filter((v) => v.externalProvider === "SATELITNI_SLEDOVANI" && v.externalVehicleId)
      .map((v) => String(v.externalVehicleId));

  const errors: SatelitniSyncResult["errors"] = [];
  let vehiclesWithGps = 0;

  await runLimited(ids, satelitniSyncConcurrency(), async (externalVehicleId) => {
    try {
      const { data } = await satelitniRequest<SatelitniPositionApi>(
        db,
        organizationId,
        `/vehicles/${encodeURIComponent(externalVehicleId)}/positions/latest`
      );
      const pos = mapSatelitniLatestPosition(unwrapSatelitniResource<SatelitniPositionApi>(data));
      if (!pos) return;
      vehiclesWithGps += 1;
      const docId = fleetVehicleDocIdForExternal(externalVehicleId);
      await fleetVehiclesCol(db, organizationId).doc(docId).set(
        {
          lastLatitude: pos.lat,
          lastLongitude: pos.lng,
          lastSpeedKmh: pos.speedKmh,
          lastMovementStatus: pos.movementStatus,
          lastPositionAt: pos.receivedAt
            ? Timestamp.fromDate(new Date(pos.receivedAt))
            : FieldValue.serverTimestamp(),
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

  return { vehiclesWithGps, errors };
}

function buildSummaryMessage(input: {
  vehiclesTotal: number;
  vehiclesUpdated: number;
  vehiclesWithGps: number;
  errors: number;
}): string {
  if (input.vehiclesTotal === 0) {
    return "Připojení je aktivní, ale API nevrací žádná vozidla. Zkontrolujte oprávnění připojeného účtu nebo spusťte synchronizaci.";
  }
  const base = `API vrátilo ${input.vehiclesTotal} vozidel. Importováno ${input.vehiclesUpdated} vozidel.`;
  const gps =
    input.vehiclesWithGps > 0
      ? ` GPS poloha aktualizována u ${input.vehiclesWithGps} vozidel.`
      : " GPS poloha nebyla aktualizována (chybí souřadnice nebo endpoint polohy).";
  const err = input.errors > 0 ? ` ${input.errors} chyb polohy.` : "";
  return base + gps + err;
}

export async function countStoredSatelitniFleet(db: Firestore, organizationId: string) {
  const vehicles = await listFleetVehicles(db, organizationId);
  const satelitni = vehicles.filter((v) => v.externalProvider === "SATELITNI_SLEDOVANI");
  const withGps = satelitni.filter(
    (v) => v.lastLatitude != null && v.lastLongitude != null && Number.isFinite(v.lastLatitude)
  );
  return {
    storedVehicleCount: satelitni.length,
    storedWithGpsCount: withGps.length,
  };
}

async function persistSyncMeta(
  db: Firestore,
  organizationId: string,
  result: Omit<SatelitniSyncResult, "lastSyncAt" | "summaryMessage"> & { summaryMessage: string }
) {
  const lastSyncAt = new Date().toISOString();
  await fleetIntegrationRef(db, organizationId).set(
    {
      organizationId,
      provider: "SATELITNI_SLEDOVANI",
      status: "connected",
      lastSyncAt: Timestamp.fromDate(new Date(lastSyncAt)),
      lastSyncVehicleCount: result.vehiclesTotal,
      lastSyncImportedCount: result.vehiclesUpdated,
      lastSyncStoredCount: result.storedVehicleCount,
      lastSyncGpsCount: result.vehiclesWithGps,
      lastSyncSummary: result.summaryMessage.slice(0, 500),
      lastSyncError: result.errors.length ? result.errors[0]?.message?.slice(0, 500) ?? null : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return lastSyncAt;
}

export async function syncSatelitniFleetForOrganization(
  db: Firestore,
  organizationId: string,
  mode: SatelitniSyncMode = "full"
): Promise<SatelitniSyncResult> {
  let vehiclesTotal = 0;
  let vehiclesUpdated = 0;
  let vehiclesSkipped = 0;
  let externalIds: string[] | undefined;
  const errors: SatelitniSyncResult["errors"] = [];

  if (mode === "full" || mode === "catalog") {
    const catalog = await syncSatelitniVehicleCatalogForOrganization(db, organizationId);
    vehiclesTotal = catalog.vehiclesFromApi.length;
    vehiclesUpdated = catalog.vehiclesImported;
    vehiclesSkipped = catalog.vehiclesSkipped;
    externalIds = catalog.vehiclesFromApi
      .map((v) => mapSatelitniVehicle(v).externalVehicleId)
      .filter((id) => id && id !== "0");
  }

  let vehiclesWithGps = 0;
  if (mode === "full" || mode === "positions") {
    const pos = await syncSatelitniVehiclePositionsForOrganization(db, organizationId, externalIds);
    vehiclesWithGps = pos.vehiclesWithGps;
    errors.push(...pos.errors);
  }

  const { storedVehicleCount } = await countStoredSatelitniFleet(db, organizationId);
  const summaryMessage = buildSummaryMessage({
    vehiclesTotal: mode === "positions" ? storedVehicleCount : vehiclesTotal,
    vehiclesUpdated: mode === "positions" ? storedVehicleCount : vehiclesUpdated,
    vehiclesWithGps,
    errors: errors.length,
  });

  const lastSyncAt = await persistSyncMeta(db, organizationId, {
    vehiclesTotal: mode === "positions" ? storedVehicleCount : vehiclesTotal,
    vehiclesUpdated: mode === "positions" ? 0 : vehiclesUpdated,
    vehiclesSkipped,
    vehiclesWithGps,
    storedVehicleCount,
    errors,
    summaryMessage,
  });

  return {
    vehiclesTotal: mode === "positions" ? storedVehicleCount : vehiclesTotal,
    vehiclesUpdated: mode === "positions" ? 0 : vehiclesUpdated,
    vehiclesSkipped,
    vehiclesWithGps,
    storedVehicleCount,
    errors,
    lastSyncAt,
    summaryMessage,
  };
}
