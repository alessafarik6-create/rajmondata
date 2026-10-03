import type { FleetTrackingProvider } from "@/lib/fleet/providers/types";
import type { FleetProviderContext } from "@/lib/fleet/providers/types";
import { EcofleetProvider } from "@/lib/fleet/providers/ecofleet-provider";
import { SatelitniSledovaniProvider } from "@/lib/fleet/providers/satelitni-sledovani-provider";
import type { FleetTrackingProviderKind } from "@/lib/fleet/types";
import type { Firestore } from "firebase-admin/firestore";
import { loadSatelitniOAuthTokens } from "@/lib/integrations/satelitni-sledovani/store";

export function getFleetTrackingProvider(
  kind: FleetTrackingProviderKind,
  ctx: FleetProviderContext & { db?: Firestore }
): FleetTrackingProvider {
  switch (kind) {
    case "SATELITNI_SLEDOVANI":
      if (!ctx.db) throw new Error("Satelitni provider vyžaduje Firestore.");
      return new SatelitniSledovaniProvider({ ...ctx, db: ctx.db });
    case "ECOFLEET":
    default:
      return new EcofleetProvider(ctx);
  }
}

export async function resolveFleetProviderForOrg(
  db: Firestore,
  companyId: string
): Promise<{ provider: FleetTrackingProvider; configured: boolean; providerKind: FleetTrackingProviderKind }> {
  const { loadFleetIntegration, loadFleetIntegrationApiKey } = await import("@/lib/fleet/stores");
  const integration = await loadFleetIntegration(db, companyId);
  const oauthTokens = await loadSatelitniOAuthTokens(db, companyId);

  if (
    oauthTokens &&
    (integration?.provider === "SATELITNI_SLEDOVANI" || integration?.status === "connected")
  ) {
    const provider = getFleetTrackingProvider("SATELITNI_SLEDOVANI", {
      integration,
      apiKey: null,
      companyId,
      db,
    });
    return { provider, configured: true, providerKind: "SATELITNI_SLEDOVANI" };
  }

  const apiKey = await loadFleetIntegrationApiKey(db, companyId);
  const kind = integration?.provider ?? "ECOFLEET";
  const provider = getFleetTrackingProvider(kind, {
    integration,
    apiKey,
    companyId,
    db,
  });
  const configured = Boolean(
    kind === "SATELITNI_SLEDOVANI"
      ? oauthTokens
      : integration?.apiBaseUrl && apiKey && integration.status === "configured"
  );
  return { provider, configured, providerKind: kind };
}
