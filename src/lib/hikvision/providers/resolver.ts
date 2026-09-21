import type { Firestore } from "firebase-admin/firestore";
import { loadHikvisionIntegration } from "@/lib/hikvision/stores";
import type { HikvisionConnectionMode } from "@/lib/hikvision/types";
import type { HikvisionProvider, HikvisionProviderId } from "@/lib/hikvision/providers/types";
import { directIsapiProvider } from "@/lib/hikvision/providers/direct-isapi-provider";
import { hikConnectOpenApiProvider } from "@/lib/hikvision/providers/hikconnect-openapi-provider";
import { localConnectorProvider } from "@/lib/hikvision/providers/local-connector-provider";

export function normalizeConnectionMode(
  raw: string | undefined | null
): HikvisionConnectionMode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "hikconnect_openapi" || v === "hikconnect") return "hikconnect_openapi";
  if (v === "local_connector") return "local_connector";
  return "direct";
}

export function providerIdFromConnectionMode(mode: HikvisionConnectionMode): HikvisionProviderId {
  if (mode === "hikconnect_openapi") return "HIKCONNECT_OPENAPI";
  if (mode === "local_connector") return "LOCAL_CONNECTOR";
  return "DIRECT_ISAPI";
}

export function resolveHikvisionProviderByMode(mode: HikvisionConnectionMode): HikvisionProvider {
  if (mode === "hikconnect_openapi") return hikConnectOpenApiProvider;
  if (mode === "local_connector") return localConnectorProvider;
  return directIsapiProvider;
}

export async function resolveHikvisionProviderForOrg(
  db: Firestore,
  organizationId: string
): Promise<{ provider: HikvisionProvider; mode: HikvisionConnectionMode }> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  const mode = normalizeConnectionMode(integration?.connectionMode);
  return { provider: resolveHikvisionProviderByMode(mode), mode };
}
