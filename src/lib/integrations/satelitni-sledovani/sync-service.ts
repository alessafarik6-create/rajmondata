import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { fleetIntegrationRef, fleetVehiclesCol, listFleetVehicles } from "@/lib/fleet/stores";
import { fetchAllSatelitniPages } from "@/lib/integrations/satelitni-sledovani/client";
import {
  fleetVehicleDocIdForExternal,
  isValidFleetCoordinates,
  mapSatelitniVehicle,
  type SatelitniVehicleApi,
} from "@/lib/integrations/satelitni-sledovani/mappers";
import {
  fetchSatelitniLatestPosition,
  satelitniPositionUrlIdCandidates,
} from "@/lib/integrations/satelitni-sledovani/position-fetch";
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

  const existing = await listFleetVehicles(db, organizationId);
  const byDevice = new Map(
    existing
      .filter((r) => r.externalDeviceId)
      .map((r) => [String(r.externalDeviceId), r] as const)
  );
  const byExt = new Map(
    existing
      .filter((r) => r.externalVehicleId)
      .map((r) => [String(r.externalVehicleId), r] as const)
  );

  for (const v of vehicles) {
    const mapped = mapSatelitniVehicle(v);
    if (!mapped.externalVehicleId || mapped.externalVehicleId === "0") {
      vehiclesSkipped += 1;
      continue;
    }
    const matched =
      (mapped.externalDeviceId ? byDevice.get(mapped.externalDeviceId) : undefined) ??
      byExt.get(mapped.externalVehicleId);
    const docId = matched?.id ?? fleetVehicleDocIdForExternal(mapped.externalVehicleId);
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

function buildSatelitniApiVehicleIndex(list: SatelitniVehicleApi[]) {
  const byDevice = new Map<string, SatelitniVehicleApi>();
  const byExt = new Map<string, SatelitniVehicleApi>();
  for (const row of list) {
    const mapped = mapSatelitniVehicle(row);
    if (mapped.externalDeviceId) byDevice.set(mapped.externalDeviceId, row);
    if (mapped.externalVehicleId && mapped.externalVehicleId !== "0") {
      byExt.set(mapped.externalVehicleId, row);
    }
  }
  return { byDevice, byExt };
}

export async function syncSatelitniVehiclePositionsForOrganization(
  db: Firestore,
  organizationId: string,
  externalIds?: string[],
  apiCatalog?: SatelitniVehicleApi[]
): Promise<{ vehiclesWithGps: number; errors: SatelitniSyncResult["errors"] }> {
  const stored = (await listFleetVehicles(db, organizationId)).filter(
    (v) => v.externalProvider === "SATELITNI_SLEDOVANI" && v.externalVehicleId
  );

  let apiIndex = apiCatalog ? buildSatelitniApiVehicleIndex(apiCatalog) : null;
  if (!apiIndex) {
    try {
      const list = await fetchAllSatelitniPages<SatelitniVehicleApi>(db, organizationId, "/vehicles", {
        pageLimit: 500,
      });
      apiIndex = buildSatelitniApiVehicleIndex(list);
    } catch {
      apiIndex = { byDevice: new Map(), byExt: new Map() };
    }
  }

  const targets = externalIds?.length
    ? stored.filter((v) => externalIds.includes(String(v.externalVehicleId)))
    : stored;

  const errors: SatelitniSyncResult["errors"] = [];
  let vehiclesWithGps = 0;

  await runLimited(targets, satelitniSyncConcurrency(), async (vehicle) => {
    const ext = String(vehicle.externalVehicleId ?? "").trim();
    if (!ext) return;
    try {
      const apiRow =
        apiIndex!.byExt.get(ext) ??
        (vehicle.externalDeviceId ? apiIndex!.byDevice.get(String(vehicle.externalDeviceId)) : undefined);
      const candidates = satelitniPositionUrlIdCandidates(vehicle, apiRow);
      const pos = await fetchSatelitniLatestPosition(db, organizationId, candidates);
      if (!pos) {
        errors.push({ vehicleId: ext, message: "API nevrátilo platné souřadnice." });
        return;
      }
      vehiclesWithGps += 1;
      const odometerRaw = pos.telemetry?.odometerKm;
      const odometerKm =
        typeof odometerRaw === "number" && Number.isFinite(odometerRaw) ? odometerRaw : undefined;
      await fleetVehiclesCol(db, organizationId).doc(vehicle.id).set(
        {
          lastLatitude: pos.lat,
          lastLongitude: pos.lng,
          lastSpeedKmh: pos.speedKmh,
          lastHeadingDeg: pos.heading,
          lastMovementStatus: pos.movementStatus,
          lastPositionAt: pos.receivedAt
            ? Timestamp.fromDate(new Date(pos.receivedAt))
            : FieldValue.serverTimestamp(),
          ignitionOn: pos.ignitionOn,
          externalDeviceId: pos.deviceId ?? vehicle.externalDeviceId ?? undefined,
          externalVehicleId: apiRow ? mapSatelitniVehicle(apiRow).externalVehicleId : ext,
          lastTelemetry: pos.telemetry ?? null,
          ...(odometerKm != null ? { odometerKm } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      errors.push({
        vehicleId: ext,
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
    (v) =>
      v.lastLatitude != null &&
      v.lastLongitude != null &&
      isValidFleetCoordinates(v.lastLatitude, v.lastLongitude)
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

const LIVE_POSITION_MIN_INTERVAL_MS = 12_000;

/** Obnoví GPS polohy z API, pokud od posledního běhu uplynulo ≥12 s (pro mapu vozového parku). */
export async function refreshSatelitniLivePositionsIfDue(
  db: Firestore,
  organizationId: string,
  force = false
): Promise<{ refreshed: boolean; vehiclesWithGps?: number }> {
  const integration = await fleetIntegrationRef(db, organizationId).get();
  const data = integration.data() as Record<string, unknown> | undefined;
  const last = data?.lastPositionSyncAt;
  const lastMs =
    last && typeof (last as { toDate?: () => Date }).toDate === "function"
      ? (last as { toDate: () => Date }).toDate().getTime()
      : 0;
  if (!force && lastMs && Date.now() - lastMs < LIVE_POSITION_MIN_INTERVAL_MS) {
    return { refreshed: false };
  }
  const { vehiclesWithGps, errors } = await syncSatelitniVehiclePositionsForOrganization(
    db,
    organizationId
  );
  await fleetIntegrationRef(db, organizationId).set(
    {
      lastPositionSyncAt: FieldValue.serverTimestamp(),
      lastSyncGpsCount: vehiclesWithGps,
      lastSyncError: errors.length ? errors[0]?.message?.slice(0, 500) ?? null : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { refreshed: true, vehiclesWithGps };
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
  let apiCatalogForPositions: SatelitniVehicleApi[] | undefined;
  const errors: SatelitniSyncResult["errors"] = [];

  if (mode === "full" || mode === "catalog") {
    const catalog = await syncSatelitniVehicleCatalogForOrganization(db, organizationId);
    vehiclesTotal = catalog.vehiclesFromApi.length;
    vehiclesUpdated = catalog.vehiclesImported;
    vehiclesSkipped = catalog.vehiclesSkipped;
    apiCatalogForPositions = catalog.vehiclesFromApi;
    externalIds = catalog.vehiclesFromApi
      .map((v) => mapSatelitniVehicle(v).externalVehicleId)
      .filter((id) => id && id !== "0");
  }

  let vehiclesWithGps = 0;
  if (mode === "full" || mode === "positions") {
    const pos = await syncSatelitniVehiclePositionsForOrganization(
      db,
      organizationId,
      externalIds,
      apiCatalogForPositions
    );
    vehiclesWithGps = pos.vehiclesWithGps;
    errors.push(...pos.errors);
    try {
      const { syncRecentFleetTripsForOrganization } = await import("@/lib/fleet/trip-sync-service");
      await syncRecentFleetTripsForOrganization(db, organizationId, 2);
    } catch (tripErr) {
      console.warn("[fleet] trip sync", tripErr instanceof Error ? tripErr.message : tripErr);
    }
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
