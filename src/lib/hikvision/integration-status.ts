import type { Firestore } from "firebase-admin/firestore";
import {
  hasHikConnectApiKey,
  hasHikConnectApiSecret,
  loadHikConnectApiCredentials,
  loadHikvisionIntegration,
  loadHikvisionPassword,
} from "@/lib/hikvision/stores";
import type { HikvisionIntegrationLifecycle } from "@/lib/hikvision/connection-mode";
import { isIntegrationActiveFlag } from "@/lib/hikvision/connection-mode";
import type { HikvisionConnectionModeCanonical } from "@/lib/hikvision/connection-mode";
import type { HikvisionIntegrationDoc } from "@/lib/hikvision/types";
import { resolveEffectiveConnectionMode } from "@/lib/hikvision/resolve-effective-connection-mode";

export type IntegrationConfiguredCheck = {
  configured: boolean;
  reason?: string;
};

export type IntegrationLifecycleResult = {
  lifecycle: HikvisionIntegrationLifecycle;
  reason?: string;
};

function lifecycleFromDoc(
  integration: HikvisionIntegrationDoc | null,
  configured: boolean,
  reason?: string,
  effectiveMode?: HikvisionConnectionModeCanonical
): IntegrationLifecycleResult {
  if (!integration || !configured) {
    return { lifecycle: "NOT_CONFIGURED", reason };
  }
  const st = String(integration.status ?? "").toLowerCase();
  if (st === "online") return { lifecycle: "CONNECTED" };
  if (st === "error" || st === "offline") {
    const err =
      effectiveMode === "HIKCONNECT_OPENAPI"
        ? integration.lastError ?? reason
        : integration.lastError ?? reason;
    return { lifecycle: "ERROR", reason: err };
  }
  return { lifecycle: "CONFIGURED" };
}

export async function resolveHikvisionIntegrationLifecycle(
  db: Firestore,
  organizationId: string
): Promise<IntegrationLifecycleResult> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  const configured = await isHikvisionIntegrationConfigured(integration, db, organizationId);
  const mode = await resolveEffectiveConnectionMode(integration, db, organizationId);
  return lifecycleFromDoc(integration, configured.configured, configured.reason, mode);
}

export async function isHikvisionIntegrationConfiguredForOrg(
  db: Firestore,
  organizationId: string
): Promise<IntegrationConfiguredCheck> {
  const integration = await loadHikvisionIntegration(db, organizationId);
  return isHikvisionIntegrationConfigured(integration, db, organizationId);
}

export async function isHikvisionIntegrationConfigured(
  integration: HikvisionIntegrationDoc | null,
  db: Firestore,
  organizationId: string
): Promise<IntegrationConfiguredCheck> {
  if (!integration) {
    return { configured: false, reason: "Integrace není nastavena." };
  }
  if (!isIntegrationActiveFlag(integration.active)) {
    return { configured: false, reason: "Integrace není aktivní." };
  }

  const mode = await resolveEffectiveConnectionMode(integration, db, organizationId);
  return validateConfiguredForMode(mode, integration, db, organizationId);
}

async function validateConfiguredForMode(
  mode: HikvisionConnectionModeCanonical,
  integration: HikvisionIntegrationDoc,
  db: Firestore,
  organizationId: string
): Promise<IntegrationConfiguredCheck> {
  if (mode === "HIKCONNECT_OPENAPI") {
    const hasKey = await hasHikConnectApiKey(db, organizationId);
    const hasSecret = await hasHikConnectApiSecret(db, organizationId);
    if (!hasKey || !hasSecret) {
      return { configured: false, reason: "Chybí API Key nebo API Secret pro Hik-Connect." };
    }
    const creds = await loadHikConnectApiCredentials(db, organizationId);
    if (!creds.ok && creds.reason === "DECRYPT_FAILED") {
      return {
        configured: false,
        reason:
          "API Secret nelze dešifrovat (HIKCONNECT_CREDENTIAL_DECRYPT_FAILED). Zkontrolujte EMAIL_CREDENTIALS_ENCRYPTION_KEY na serveru.",
      };
    }
    return { configured: true };
  }
  if (mode === "LOCAL_CONNECTOR") {
    if (!integration.connectorOnline) {
      return { configured: false, reason: "Local Connector není online." };
    }
    return { configured: true };
  }

  // DIRECT_ISAPI only below
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

/** Pro test — Hik-Connect: credentials stačí i když OpenAPI spec ještě není na serveru. */
export async function hasHikConnectCredentialsReady(
  db: Firestore,
  organizationId: string
): Promise<boolean> {
  const creds = await loadHikConnectApiCredentials(db, organizationId);
  return creds.ok;
}
