import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type {
  FleetProviderConnectionTest,
  FleetProviderTripRoute,
  FleetTrackingProvider,
} from "@/lib/fleet/providers/types";
import type { FleetProviderContext } from "@/lib/fleet/providers/types";
import type { FleetPositionSnapshot, FleetTripDoc, FleetVehicleDoc } from "@/lib/fleet/types";
import { listFleetVehicles, fleetTripsCol } from "@/lib/fleet/stores";
import {
  fetchAllSatelitniPages,
  satelitniRequest,
} from "@/lib/integrations/satelitni-sledovani/client";
import {
  mapSatelitniLatestPosition,
  mapSatelitniVehicle,
  tripDocId,
  type SatelitniPositionApi,
  type SatelitniVehicleApi,
} from "@/lib/integrations/satelitni-sledovani/mappers";
import { SatelitniApiError } from "@/lib/integrations/satelitni-sledovani/problem-json";

export class SatelitniSledovaniProvider implements FleetTrackingProvider {
  readonly kind = "SATELITNI_SLEDOVANI" as const;

  constructor(
    private readonly ctx: FleetProviderContext & { db: Firestore }
  ) {}

  async testConnection(): Promise<FleetProviderConnectionTest> {
    try {
      await satelitniRequest(this.ctx.db, this.ctx.companyId, "/vehicles", {
        query: { limit: 1 },
      });
      return { ok: true, message: "Připojení k SatelitníSledování.cz je funkční." };
    } catch (e) {
      const msg = e instanceof SatelitniApiError ? e.message : e instanceof Error ? e.message : "Test selhal.";
      return { ok: false, message: msg, errorCode: "PROVIDER_ERROR" };
    }
  }

  async getVehicles(): Promise<(FleetVehicleDoc & { id: string })[]> {
    const rows = await listFleetVehicles(this.ctx.db, this.ctx.companyId);
    return rows.filter((v) => v.externalProvider === "SATELITNI_SLEDOVANI");
  }

  async getVehiclePosition(vehicleExternalId: string): Promise<FleetPositionSnapshot | null> {
    try {
      const { data } = await satelitniRequest<SatelitniPositionApi>(
        this.ctx.db,
        this.ctx.companyId,
        `/vehicles/${encodeURIComponent(vehicleExternalId)}/positions/latest`
      );
      const pos = mapSatelitniLatestPosition(data);
      if (!pos) return null;
      return {
        vehicleId: vehicleExternalId,
        lat: pos.lat,
        lng: pos.lng,
        speedKmh: pos.speedKmh,
        movementStatus: pos.movementStatus,
        recordedAt: pos.receivedAt ?? new Date().toISOString(),
        ignitionOn: pos.ignitionOn,
      };
    } catch {
      return null;
    }
  }

  async getVehiclePositions(): Promise<FleetPositionSnapshot[]> {
    const vehicles = await this.getVehicles();
    const out: FleetPositionSnapshot[] = [];
    for (const v of vehicles) {
      const ext = v.externalVehicleId;
      if (!ext) continue;
      if (v.lastLatitude != null && v.lastLongitude != null) {
        out.push({
          vehicleId: v.id,
          lat: v.lastLatitude,
          lng: v.lastLongitude,
          speedKmh: v.lastSpeedKmh ?? null,
          movementStatus: v.lastMovementStatus ?? "unknown",
          recordedAt: v.lastPositionAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
          locationLabel: v.lastLocationLabel ?? null,
          ignitionOn: v.ignitionOn ?? null,
        });
      }
    }
    return out;
  }

  async getTrips(params: {
    vehicleExternalId?: string;
    from: Date;
    to: Date;
  }): Promise<Partial<FleetTripDoc>[]> {
    if (!params.vehicleExternalId) return [];
    const from = params.from.toISOString();
    const to = params.to.toISOString();
    const trips = await fetchAllSatelitniPages<Record<string, unknown>>(
      this.ctx.db,
      this.ctx.companyId,
      `/vehicles/${encodeURIComponent(params.vehicleExternalId)}/trips`,
      { query: { from, to, limit: 200 }, pageLimit: 200 }
    );

    return trips.map((t) => {
      const begin = String(t.begin ?? t.started_at ?? t.start ?? "");
      const end = String(t.end ?? t.ended_at ?? t.finish ?? "");
      return {
        organizationId: this.ctx.companyId,
        vehicleId: `ssv-${params.vehicleExternalId}`,
        externalProvider: "SATELITNI_SLEDOVANI",
        externalTripId: `${params.vehicleExternalId}-${begin}`,
        driverName: t.driver != null ? String((t.driver as Record<string, unknown>)?.name ?? t.driver) : null,
        startedAt: begin ? Timestamp.fromDate(new Date(begin)) : undefined,
        endedAt: end ? Timestamp.fromDate(new Date(end)) : undefined,
        startAddress: String(t.start_address ?? t.from_address ?? "").trim() || null,
        endAddress: String(t.end_address ?? t.to_address ?? "").trim() || null,
        distanceKm: Number(t.distance ?? t.distance_km ?? 0) || null,
        durationMinutes: Number(t.duration ?? t.duration_minutes ?? 0) || null,
        avgSpeedKmh: Number(t.avg_speed ?? t.average_speed ?? 0) || null,
        maxSpeedKmh: Number(t.max_speed ?? 0) || null,
      };
    });
  }

  async getTrip(externalTripId: string): Promise<Partial<FleetTripDoc> | null> {
    const parts = externalTripId.split("-");
    if (parts.length < 2) return null;
    return { externalTripId };
  }

  async getRoute(externalTripId: string): Promise<FleetProviderTripRoute | null> {
    const m = externalTripId.match(/^(\d+)-(.+)$/);
    if (!m) return null;
    const vehicleId = m[1];
    const begin = m[2];
    try {
      const { data } = await satelitniRequest<Record<string, unknown>>(
        this.ctx.db,
        this.ctx.companyId,
        `/vehicles/${encodeURIComponent(vehicleId)}/trips/${encodeURIComponent(begin)}`
      );
      const trip = data as Record<string, unknown>;
      const from = String(trip.begin ?? begin);
      const to = String(trip.end ?? new Date().toISOString());
      const pointsRaw = await fetchAllSatelitniPages<SatelitniPositionApi>(
        this.ctx.db,
        this.ctx.companyId,
        `/vehicles/${encodeURIComponent(vehicleId)}/positions/points`,
        { query: { from, to, limit: 500 }, pageLimit: 500 }
      );
      const points = pointsRaw
        .map((p) => mapSatelitniLatestPosition(p))
        .filter(Boolean)
        .map((p) => ({
          lat: p!.lat,
          lng: p!.lng,
          recordedAt: p!.receivedAt ?? from,
          speedKmh: p!.speedKmh,
        }));
      if (!points.length) return null;
      return {
        tripId: externalTripId,
        points,
        stops: [],
        start: { lat: points[0].lat, lng: points[0].lng, at: points[0].recordedAt },
        end: {
          lat: points[points.length - 1].lat,
          lng: points[points.length - 1].lng,
          at: points[points.length - 1].recordedAt,
        },
      };
    } catch {
      return null;
    }
  }

  async getEvents(): Promise<unknown[]> {
    return [];
  }

  /** Sync trips into Firestore for portal list. */
  async syncTripsForVehicle(
    vehicleExternalId: string,
    from: Date,
    to: Date
  ): Promise<number> {
    const partial = await this.getTrips({ vehicleExternalId, from, to });
    let n = 0;
    for (const t of partial) {
      const begin =
        t.startedAt?.toDate?.()?.toISOString?.() ??
        String(t.externalTripId ?? "").split("-").slice(1).join("-");
      const id = tripDocId(vehicleExternalId, begin);
      await fleetTripsCol(this.ctx.db, this.ctx.companyId).doc(id).set(t, { merge: true });
      n += 1;
    }
    return n;
  }

  async fetchVehiclesFromApi(): Promise<ReturnType<typeof mapSatelitniVehicle>[]> {
    const list = await fetchAllSatelitniPages<SatelitniVehicleApi>(
      this.ctx.db,
      this.ctx.companyId,
      "/vehicles"
    );
    return list.map(mapSatelitniVehicle);
  }
}
