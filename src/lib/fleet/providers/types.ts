import type {
  FleetIntegrationDoc,
  FleetPositionSnapshot,
  FleetTripDoc,
  FleetVehicleDoc,
  FleetVehicleMovementStatus,
} from "@/lib/fleet/types";

export type FleetProviderConnectionTest = {
  ok: boolean;
  message: string;
  errorCode?: "NOT_CONFIGURED" | "MISSING_CREDENTIALS" | "PROVIDER_ERROR" | "UNSUPPORTED";
};

export type FleetProviderTripRoute = {
  tripId: string;
  points: { lat: number; lng: number; recordedAt: string; speedKmh?: number | null }[];
  stops: { startedAt: string; endedAt?: string | null; address?: string | null; lat?: number; lng?: number }[];
  start: { lat: number; lng: number; address?: string | null; at: string };
  end: { lat: number; lng: number; address?: string | null; at: string };
};

/**
 * Abstrakce GPS providera (Ecofleet a další).
 * Skutečné HTTP volání doplníme až po dodání API dokumentace.
 */
export interface FleetTrackingProvider {
  readonly kind: "ECOFLEET";
  testConnection(): Promise<FleetProviderConnectionTest>;
  getVehicles(): Promise<FleetVehicleDoc[]>;
  getVehiclePosition(vehicleExternalId: string): Promise<FleetPositionSnapshot | null>;
  getVehiclePositions(): Promise<FleetPositionSnapshot[]>;
  getTrips(params: {
    vehicleExternalId?: string;
    from: Date;
    to: Date;
  }): Promise<Partial<FleetTripDoc>[]>;
  getTrip(externalTripId: string): Promise<Partial<FleetTripDoc> | null>;
  getRoute(externalTripId: string): Promise<FleetProviderTripRoute | null>;
  getEvents(params: { vehicleExternalId?: string; from: Date; to: Date }): Promise<unknown[]>;
}

export type FleetProviderContext = {
  integration: FleetIntegrationDoc | null;
  apiKey: string | null;
  companyId: string;
};

export function movementStatusLabel(status: FleetVehicleMovementStatus): string {
  switch (status) {
    case "moving":
      return "V pohybu";
    case "idle":
      return "Stojí";
    case "parked":
      return "Zaparkováno";
    case "offline":
      return "Offline";
    default:
      return "Neznámý stav";
  }
}
