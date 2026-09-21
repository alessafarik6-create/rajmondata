import type { Firestore } from "firebase-admin/firestore";
import { loadHikvisionIntegration } from "@/lib/hikvision/stores";
import {
  normalizeConnectionMode,
  type HikvisionConnectionModeCanonical,
} from "@/lib/hikvision/connection-mode";
import type { HikvisionProvider, HikvisionProviderId } from "@/lib/hikvision/providers/types";
import { directIsapiProvider } from "@/lib/hikvision/providers/direct-isapi-provider";
import { hikConnectOpenApiProvider } from "@/lib/hikvision/providers/hikconnect-openapi-provider";
import { localConnectorProvider } from "@/lib/hikvision/providers/local-connector-provider";

export { normalizeConnectionMode };

export function providerIdFromConnectionMode(
  mode: HikvisionConnectionModeCanonical
): HikvisionProviderId {
  if (mode === "HIKCONNECT_OPENAPI") return "HIKCONNECT_OPENAPI";
  if (mode === "LOCAL_CONNECTOR") return "LOCAL_CONNECTOR";
  return "DIRECT_ISAPI";
}

export function resolveHikvisionProviderByMode(mode: HikvisionConnectionModeCanonical): HikvisionProvider {
  if (mode === "HIKCONNECT_OPENAPI") return hikConnectOpenApiProvider;
  if (mode === "LOCAL_CONNECTOR") return localConnectorProvider;
  return directIsapiProvider;
}

export async function resolveHikvisionProviderForOrg(
  db: Firestore,
  organizationId: string
): Promise<{ provider: HikvisionProvider; mode: HikvisionConnectionModeCanonical }> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  const mode = normalizeConnectionMode(integration?.connectionMode);
  return { provider: resolveHikvisionProviderByMode(mode), mode };
}
