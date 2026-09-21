import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  decryptHikvisionSecret,
  encryptHikvisionSecret,
} from "@/lib/hikvision/integration-crypto";
import {
  HIKVISION_CAMERAS_SUBCOLLECTION,
  HIKVISION_CONNECTORS_SUBCOLLECTION,
  HIKVISION_INTEGRATION_CREDENTIALS_DOC,
  HIKVISION_INTEGRATION_DOC_ID,
  HIKVISION_INTEGRATION_SUBCOLLECTION,
  HIKVISION_DEVICES_SUBCOLLECTION,
  type HikvisionCameraDoc,
  type HikvisionDeviceDoc,
  type HikvisionIntegrationDoc,
  type HikvisionProviderKind,
} from "@/lib/hikvision/types";
import { providerIdFromConnectionMode, normalizeConnectionMode } from "@/lib/hikvision/providers/resolver";
import type { HikvisionIsapiConfig } from "@/lib/hikvision/isapi-client";

export function hikvisionIntegrationRef(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(HIKVISION_INTEGRATION_SUBCOLLECTION)
    .doc(HIKVISION_INTEGRATION_DOC_ID);
}

export function hikvisionCredentialsRef(db: Firestore, companyId: string) {
  return hikvisionIntegrationRef(db, companyId)
    .collection("private")
    .doc(HIKVISION_INTEGRATION_CREDENTIALS_DOC);
}

export function hikvisionCamerasCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(HIKVISION_CAMERAS_SUBCOLLECTION);
}

export function hikvisionDevicesCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(HIKVISION_DEVICES_SUBCOLLECTION);
}

export function hikvisionConnectorsCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(HIKVISION_CONNECTORS_SUBCOLLECTION);
}

export async function loadHikvisionIntegration(
  db: Firestore,
  companyId: string
): Promise<HikvisionIntegrationDoc | null> {
  const snap = await hikvisionIntegrationRef(db, companyId).get();
  if (!snap.exists) return null;
  return snap.data() as HikvisionIntegrationDoc;
}

export async function saveHikvisionPassword(
  db: Firestore,
  companyId: string,
  password: string
): Promise<void> {
  await hikvisionCredentialsRef(db, companyId).set(
    {
      encryptedPassword: encryptHikvisionSecret(password),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function saveHikConnectApiCredentials(
  db: Firestore,
  companyId: string,
  input: { apiKey?: string; apiSecret?: string }
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.apiKey !== undefined && input.apiKey.trim()) {
    patch.apiKey = input.apiKey.trim();
  }
  if (input.apiSecret !== undefined && input.apiSecret.trim()) {
    patch.encryptedApiSecret = encryptHikvisionSecret(input.apiSecret.trim());
  }
  if (Object.keys(patch).length <= 1) return;
  await hikvisionCredentialsRef(db, companyId).set(patch, { merge: true });
}

export type HikConnectCredentialsLoadResult =
  | { ok: true; apiKey: string; apiSecret: string }
  | { ok: false; reason: "MISSING" | "DECRYPT_FAILED" };

export async function hasHikConnectApiKey(db: Firestore, companyId: string): Promise<boolean> {
  const snap = await hikvisionCredentialsRef(db, companyId).get();
  if (!snap.exists) return false;
  return Boolean(String((snap.data() as { apiKey?: string })?.apiKey ?? "").trim());
}

export async function loadHikConnectApiCredentials(
  db: Firestore,
  companyId: string
): Promise<HikConnectCredentialsLoadResult> {
  const snap = await hikvisionCredentialsRef(db, companyId).get();
  if (!snap.exists) return { ok: false, reason: "MISSING" };
  const data = snap.data() as { apiKey?: string; encryptedApiSecret?: string };
  const apiKey = String(data.apiKey ?? "").trim();
  const enc = String(data.encryptedApiSecret ?? "").trim();
  if (!apiKey || !enc) return { ok: false, reason: "MISSING" };
  try {
    const apiSecret = decryptHikvisionSecret(enc);
    return { ok: true, apiKey, apiSecret };
  } catch {
    return { ok: false, reason: "DECRYPT_FAILED" };
  }
}

/** @deprecated Prefer loadHikConnectApiCredentials with explicit reason. */
export async function loadHikConnectApiCredentialsOrNull(
  db: Firestore,
  companyId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const r = await loadHikConnectApiCredentials(db, companyId);
  return r.ok ? { apiKey: r.apiKey, apiSecret: r.apiSecret } : null;
}

export async function hasHikConnectApiSecret(db: Firestore, companyId: string): Promise<boolean> {
  const snap = await hikvisionCredentialsRef(db, companyId).get();
  if (!snap.exists) return false;
  return Boolean(
    String((snap.data() as { encryptedApiSecret?: string })?.encryptedApiSecret ?? "").trim()
  );
}

export async function loadHikvisionPassword(
  db: Firestore,
  companyId: string
): Promise<string | null> {
  const snap = await hikvisionCredentialsRef(db, companyId).get();
  if (!snap.exists) return null;
  const enc = String((snap.data() as { encryptedPassword?: string })?.encryptedPassword ?? "");
  if (!enc.trim()) return null;
  try {
    return decryptHikvisionSecret(enc);
  } catch {
    return null;
  }
}

export async function buildIsapiConfigForOrg(
  db: Firestore,
  companyId: string
): Promise<{ ok: true; config: HikvisionIsapiConfig } | { ok: false; error: string }> {
  const integration = await loadHikvisionIntegration(db, companyId);
  if (!integration) {
    return { ok: false, error: "Integrace Hikvision není nastavena." };
  }
  if (integration.active === false) {
    return { ok: false, error: "Integrace Hikvision není aktivní." };
  }
  const mode = normalizeConnectionMode(integration.connectionMode);
  if (mode === "HIKCONNECT_OPENAPI") {
    return {
      ok: false,
      error: "Režim Hik-Connect Cloud: ISAPI se nepoužívá (cloud OpenAPI provider).",
    };
  }
  if (mode === "LOCAL_CONNECTOR") {
    return {
      ok: false,
      error:
        "Režim Local Connector: ISAPI volání provádí lokální connector (cloud nevolá NVR přímo).",
    };
  }
  const password = await loadHikvisionPassword(db, companyId);
  if (!password) {
    return { ok: false, error: "Chybí uložené heslo NVR." };
  }
  if (!integration.host?.trim()) {
    return { ok: false, error: "Chybí host/IP NVR." };
  }
  return {
    ok: true,
    config: {
      host: integration.host.trim(),
      httpPort: Number(integration.httpPort) || 80,
      httpsPort: Number(integration.httpsPort) || 443,
      useHttps: Boolean(integration.useHttps),
      username: String(integration.username ?? "").trim(),
      password,
      allowInsecureTls: Boolean(integration.allowInsecureTls),
    },
  };
}

export function firestoreTimestampToIso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

export function cameraDocId(channelId: string, externalDeviceId?: string): string {
  const ch = String(channelId).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (externalDeviceId?.trim()) {
    const dev = String(externalDeviceId).replace(/[^a-zA-Z0-9_-]/g, "_");
    return `ch_${dev}_${ch}`;
  }
  return `ch_${ch}`;
}

export function deviceDocId(externalDeviceId: string): string {
  return `dev_${String(externalDeviceId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export async function upsertHikvisionDevices(
  db: Firestore,
  companyId: string,
  provider: HikvisionProviderKind,
  devices: Omit<HikvisionDeviceDoc, "organizationId" | "provider" | "updatedAt" | "lastSyncAt">[]
): Promise<number> {
  const batch = db.batch();
  const col = hikvisionDevicesCol(db, companyId);
  const now = FieldValue.serverTimestamp();
  for (const dev of devices) {
    const id = deviceDocId(dev.externalDeviceId);
    batch.set(
      col.doc(id),
      {
        ...dev,
        organizationId: companyId,
        provider,
        lastSyncAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }
  await batch.commit();
  return devices.length;
}

export async function listHikvisionDevices(
  db: Firestore,
  companyId: string
): Promise<(HikvisionDeviceDoc & { id: string })[]> {
  const snap = await hikvisionDevicesCol(db, companyId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as HikvisionDeviceDoc) }));
}

export function providerKindForOrgIntegration(
  integration: HikvisionIntegrationDoc | null
): HikvisionProviderKind {
  return providerIdFromConnectionMode(normalizeConnectionMode(integration?.connectionMode));
}

export async function upsertHikvisionCameras(
  db: Firestore,
  companyId: string,
  channels: Omit<HikvisionCameraDoc, "organizationId" | "integrationId" | "updatedAt">[]
): Promise<number> {
  const batch = db.batch();
  const col = hikvisionCamerasCol(db, companyId);
  const now = FieldValue.serverTimestamp();
  for (const ch of channels) {
    const id = cameraDocId(ch.channelId, ch.externalDeviceId ?? undefined);
    batch.set(
      col.doc(id),
      {
        ...ch,
        organizationId: companyId,
        integrationId: HIKVISION_INTEGRATION_DOC_ID,
        lastCheckedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }
  await batch.commit();
  return channels.length;
}

export async function listHikvisionCameras(
  db: Firestore,
  companyId: string
): Promise<(HikvisionCameraDoc & { id: string })[]> {
  const snap = await hikvisionCamerasCol(db, companyId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as HikvisionCameraDoc) }));
}
