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
  type HikvisionCameraDoc,
  type HikvisionIntegrationDoc,
} from "@/lib/hikvision/types";
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
  if (!integration?.active) {
    return { ok: false, error: "Integrace Hikvision není aktivní." };
  }
  if (integration.connectionMode === "local_connector") {
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

export function cameraDocId(channelId: string): string {
  return `ch_${String(channelId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
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
    const id = cameraDocId(ch.channelId);
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
