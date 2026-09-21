import type { Firestore } from "firebase-admin/firestore";
import {
  hasHikConnectApiKey,
  hasHikConnectApiSecret,
} from "@/lib/hikvision/stores";
import {
  normalizeConnectionMode,
  type HikvisionConnectionModeCanonical,
} from "@/lib/hikvision/connection-mode";
import type { HikvisionIntegrationDoc } from "@/lib/hikvision/types";

/**
 * Režim z dokumentu; pokud connectionMode chybí, odvoď z uložených credentials
 * (aby cloud nepadal na Direct ISAPI validaci host).
 */
export async function resolveEffectiveConnectionMode(
  integration: HikvisionIntegrationDoc | null,
  db: Firestore,
  organizationId: string
): Promise<HikvisionConnectionModeCanonical> {
  if (!integration) return "DIRECT_ISAPI";

  const hasCloud =
    (await hasHikConnectApiKey(db, organizationId)) &&
    (await hasHikConnectApiSecret(db, organizationId));

  const raw = String(integration.connectionMode ?? "").trim();
  if (raw) {
    const normalized = normalizeConnectionMode(raw);
    if (normalized === "DIRECT_ISAPI" && hasCloud && !integration.host?.trim()) {
      return "HIKCONNECT_OPENAPI";
    }
    return normalized;
  }

  if (hasCloud) return "HIKCONNECT_OPENAPI";

  return "DIRECT_ISAPI";
}
