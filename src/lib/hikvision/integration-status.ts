import type { Firestore } from "firebase-admin/firestore";
import {
  loadHikConnectApiCredentials,
  loadHikvisionIntegration,
  loadHikvisionPassword,
} from "@/lib/hikvision/stores";
import { normalizeConnectionMode } from "@/lib/hikvision/providers/resolver";
import type { HikvisionIntegrationDoc } from "@/lib/hikvision/types";

export type IntegrationConfiguredCheck = {
  configured: boolean;
  reason?: string;
};

export async function isHikvisionIntegrationConfiguredForOrg(
  db: Firestore,
  organizationId: string
): Promise<IntegrationConfiguredCheck> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  if (!integration?.active) {
    return { configured: false, reason: "Integrace není aktivní." };
  }
  return isHikvisionIntegrationConfigured(integration, db, organizationId);
}

export async function isHikvisionIntegrationConfigured(
  integration: HikvisionIntegrationDoc,
  db: Firestore,
  organizationId: string
): Promise<IntegrationConfiguredCheck> {
  if (!integration.active) {
    return { configured: false, reason: "Integrace není aktivní." };
  }
  const mode = normalizeConnectionMode(integration.connectionMode);
  if (mode === "hikconnect_openapi") {
    const creds = await loadHikConnectApiCredentials(db, organizationId);
    if (!creds?.apiKey || !creds.apiSecret) {
      return { configured: false, reason: "Chybí API Key nebo API Secret pro Hik-Connect." };
    }
    return { configured: true };
  }
  if (mode === "local_connector") {
    if (!integration.connectorOnline) {
      return { configured: false, reason: "Local Connector není online." };
    }
    return { configured: true };
  }
  const password = await loadHikvisionPassword(db, organizationId);
  if (!integration.host?.trim()) {
    return { configured: false, reason: "Chybí host/IP NVR." };
  }
  if (!integration.username?.trim()) {
    return { configured: false, reason: "Chybí uživatelské jméno NVR." };
  }
  if (!password) {
    return { configured: false, reason: "Chybí heslo NVR." };
  }
  return { configured: true };
}
