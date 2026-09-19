import type { FleetTrackingProvider } from "@/lib/fleet/providers/types";
import type { FleetProviderContext } from "@/lib/fleet/providers/types";
import { EcofleetProvider } from "@/lib/fleet/providers/ecofleet-provider";
import type { FleetTrackingProviderKind } from "@/lib/fleet/types";

export function getFleetTrackingProvider(
  kind: FleetTrackingProviderKind,
  ctx: FleetProviderContext
): FleetTrackingProvider {
  switch (kind) {
    case "ECOFLEET":
    default:
      return new EcofleetProvider(ctx);
  }
}

export async function resolveFleetProviderForOrg(
  db: import("firebase-admin/firestore").Firestore,
  companyId: string
): Promise<{ provider: FleetTrackingProvider; configured: boolean }> {
  const { loadFleetIntegration, loadFleetIntegrationApiKey } = await import("@/lib/fleet/stores");
  const integration = await loadFleetIntegration(db, companyId);
  const apiKey = await loadFleetIntegrationApiKey(db, companyId);
  const kind = integration?.provider ?? "ECOFLEET";
  const provider = getFleetTrackingProvider(kind, {
    integration,
    apiKey,
    companyId,
  });
  const configured = Boolean(integration?.apiBaseUrl && apiKey && integration.status === "configured");
  return { provider, configured };
}
