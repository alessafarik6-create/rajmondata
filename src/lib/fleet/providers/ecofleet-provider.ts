import type { FleetTrackingProvider, FleetProviderConnectionTest } from "@/lib/fleet/providers/types";
import type { FleetProviderContext } from "@/lib/fleet/providers/types";

const NOT_CONFIGURED: FleetProviderConnectionTest = {
  ok: false,
  message:
    "Ecofleet API zatím není implementováno. Po dodání dokumentace a API klíče doplníme EcofleetProvider.",
  errorCode: "NOT_CONFIGURED",
};

/**
 * Ecofleet CZ — placeholder implementace.
 *
 * TODO (po dodání API dokumentace):
 * - autentizace (token / API key header — dle dokumentace)
 * - base URL z integrace (apiBaseUrl)
 * - getVehicles → mapování externalVehicleId, externalDeviceId
 * - getVehiclePositions → realtime / polling endpoint
 * - getTrips / getRoute → historie jízd a polyline
 * - rozhodnutí A vs B: query-on-demand vs sync do Firestore
 */
export class EcofleetProvider implements FleetTrackingProvider {
  readonly kind = "ECOFLEET" as const;

  constructor(private readonly ctx: FleetProviderContext) {}

  private notReady(): FleetProviderConnectionTest {
    if (!this.ctx.integration?.apiBaseUrl || !this.ctx.apiKey) {
      return {
        ok: false,
        message: "Ecofleet není nakonfigurován (chybí URL nebo API klíč).",
        errorCode: "MISSING_CREDENTIALS",
      };
    }
    return NOT_CONFIGURED;
  }

  async testConnection(): Promise<FleetProviderConnectionTest> {
    return this.notReady();
  }

  async getVehicles() {
    return [];
  }

  async getVehiclePosition(_vehicleExternalId: string) {
    return null;
  }

  async getVehiclePositions() {
    return [];
  }

  async getTrips(_params: { vehicleExternalId?: string; from: Date; to: Date }) {
    return [];
  }

  async getTrip(_externalTripId: string) {
    return null;
  }

  async getRoute(_externalTripId: string) {
    return null;
  }

  async getEvents(_params: { vehicleExternalId?: string; from: Date; to: Date }) {
    return [];
  }
}
