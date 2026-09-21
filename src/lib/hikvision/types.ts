import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export const HIKVISION_INTEGRATION_SUBCOLLECTION = "hikvision_integration";
export const HIKVISION_INTEGRATION_DOC_ID = "hikvision_integration";
export const HIKVISION_INTEGRATION_CREDENTIALS_DOC = "credentials";

export const HIKVISION_CAMERAS_SUBCOLLECTION = "hikvision_cameras";
export const HIKVISION_CONNECTORS_SUBCOLLECTION = "hikvision_connectors";
export const HIKVISION_EVENTS_SUBCOLLECTION = "hikvision_camera_events";
export const HIKVISION_STREAM_SESSIONS_SUBCOLLECTION = "hikvision_stream_sessions";

export type HikvisionConnectionMode = "direct" | "local_connector";

export type HikvisionIntegrationStatus =
  | "not_connected"
  | "configured"
  | "online"
  | "offline"
  | "error"
  | "disabled";

export type HikvisionIntegrationDoc = {
  organizationId: string;
  deviceLabel: string;
  host: string;
  httpPort: number;
  httpsPort: number;
  rtspPort: number;
  useHttps: boolean;
  connectionMode: HikvisionConnectionMode;
  username: string;
  active: boolean;
  status: HikvisionIntegrationStatus;
  allowInsecureTls?: boolean;
  /** NVR deviceInfo po testu */
  model?: string | null;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
  deviceName?: string | null;
  lastTestAt?: unknown;
  lastSyncAt?: unknown;
  lastCommunicationAt?: unknown;
  lastError?: string | null;
  cameraCount?: number;
  connectorOnline?: boolean;
  lastConnectorHeartbeatAt?: unknown;
  pendingRegistrationTokenHash?: string | null;
  pendingRegistrationExpiresAt?: unknown;
  configuredByUserId?: string;
  updatedAt?: unknown;
};

export type HikvisionCameraDoc = {
  organizationId: string;
  integrationId: string;
  channelId: string;
  name: string;
  ipAddress?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  online: boolean;
  trackStreamId: string;
  lastCheckedAt?: unknown;
  updatedAt?: unknown;
};

export type HikvisionConnectorDoc = {
  organizationId: string;
  connectorId: string;
  label?: string;
  status: "pending" | "online" | "offline";
  lastHeartbeatAt?: unknown;
  lastError?: string | null;
  createdAt?: unknown;
};

export type HikvisionCameraEventDoc = {
  organizationId: string;
  deviceId: string;
  cameraId: string;
  eventType: string;
  eventTime: unknown;
  payload?: Record<string, unknown>;
  snapshotStoragePath?: string | null;
};

export function hikvisionIntegrationCollectionPath(companyId: string): string {
  return `${COMPANIES_COLLECTION}/${companyId}/${HIKVISION_INTEGRATION_SUBCOLLECTION}`;
}
