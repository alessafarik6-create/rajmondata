import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  HCC_CAMERAS_GET_PATH,
  HCC_CAPTURE_PIC_PATH,
  HCC_DEVICES_GET_PATH,
  HCC_STREAM_TOKEN_PATH,
  HCC_SYSTEM_PROPERTIES_PATH,
  HCC_TOKEN_PATH,
  resolveHikConnectApiBaseUrl,
} from "@/lib/hikvision/hikconnect-openapi/config";
import { hikvisionIntegrationRef } from "@/lib/hikvision/stores";

const REQUEST_TIMEOUT_MS = 25_000;

export type HccApiErrorCode =
  | "HIKCONNECT_AUTH_FAILED"
  | "HIKCONNECT_PERMISSION_DENIED"
  | "HIKCONNECT_RATE_LIMIT"
  | "HIKCONNECT_API_ERROR"
  | "HIKCONNECT_TIMEOUT";

export class HccApiError extends Error {
  readonly code: HccApiErrorCode;
  readonly hccErrorCode?: string;

  constructor(code: HccApiErrorCode, message: string, hccErrorCode?: string) {
    super(message);
    this.name = "HccApiError";
    this.code = code;
    this.hccErrorCode = hccErrorCode;
  }
}

type HccJson = Record<string, unknown>;

type TokenCacheEntry = {
  accessToken: string;
  expireTime: number;
  areaDomain: string | null;
  baseUrl: string;
};

const tokenCache = new Map<string, TokenCacheEntry>();

function orgCacheKey(organizationId: string): string {
  return organizationId;
}

function mapHccError(errorCode: string, message?: string): HccApiError {
  const code = String(errorCode ?? "");
  const msg = String(message ?? "").trim();
  if (code === "OPEN300002" || msg.includes("SECRET_KEY")) {
    return new HccApiError("HIKCONNECT_AUTH_FAILED", "Neplatný API Secret nebo API Key.", code);
  }
  if (code === "OPEN300001" || msg.toLowerCase().includes("permission")) {
    return new HccApiError("HIKCONNECT_PERMISSION_DENIED", "Nedostatečná oprávnění Hik-Connect API.", code);
  }
  if (msg.toLowerCase().includes("rate") || code.includes("RATE")) {
    return new HccApiError("HIKCONNECT_RATE_LIMIT", "Překročen limit Hik-Connect API.", code);
  }
  return new HccApiError(
    "HIKCONNECT_API_ERROR",
    msg ? `Hik-Connect API: ${msg}` : `Hik-Connect API chyba (${code || "unknown"}).`,
    code
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new HccApiError("HIKCONNECT_TIMEOUT", "Hik-Connect API — timeout.");
    }
    throw new HccApiError("HIKCONNECT_API_ERROR", "Hik-Connect API není dostupné.");
  } finally {
    clearTimeout(t);
  }
}

function parseHccResponse(json: HccJson): HccJson {
  const errorCode = String(json.errorCode ?? "");
  if (errorCode && errorCode !== "0") {
    throw mapHccError(errorCode, String(json.message ?? ""));
  }
  return json;
}

export async function hccGetAccessToken(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
  forceRefresh?: boolean;
}): Promise<TokenCacheEntry> {
  const key = orgCacheKey(input.organizationId);
  const cached = tokenCache.get(key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!input.forceRefresh && cached && cached.expireTime > nowSec + 60) {
    return cached;
  }

  const integration = await hikvisionIntegrationRef(input.db, input.organizationId).get();
  const areaDomain = integration.exists
    ? String((integration.data() as { hikConnectAreaDomain?: string })?.hikConnectAreaDomain ?? "")
    : "";

  const baseUrl = resolveHikConnectApiBaseUrl(areaDomain || null);
  const url = `${baseUrl}${HCC_TOKEN_PATH}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: input.apiKey, secretKey: input.apiSecret }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new HccApiError("HIKCONNECT_AUTH_FAILED", "Hik-Connect odmítl API Key / Secret.");
  }
  if (res.status === 429) {
    throw new HccApiError("HIKCONNECT_RATE_LIMIT", "Překročen limit Hik-Connect API.");
  }
  if (!res.ok) {
    throw new HccApiError("HIKCONNECT_API_ERROR", `Hik-Connect token HTTP ${res.status}.`);
  }

  const json = parseHccResponse((await res.json()) as HccJson);
  const data = (json.data ?? {}) as HccJson;
  const accessToken = String(data.accessToken ?? "").trim();
  const expireTime = Number(data.expireTime) || nowSec + 3600;
  const newAreaDomain = String(data.areaDomain ?? "").trim() || null;

  if (!accessToken) {
    throw new HccApiError("HIKCONNECT_API_ERROR", "Hik-Connect nevrátil access token.");
  }

  const apiBase = resolveHikConnectApiBaseUrl(newAreaDomain);
  const entry: TokenCacheEntry = {
    accessToken,
    expireTime,
    areaDomain: newAreaDomain,
    baseUrl: apiBase,
  };
  tokenCache.set(key, entry);

  if (newAreaDomain) {
    await hikvisionIntegrationRef(input.db, input.organizationId).set(
      {
        hikConnectAreaDomain: newAreaDomain,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return entry;
}

async function hccAuthorizedRequest(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
  method: "GET" | "POST";
  path: string;
  body?: HccJson;
}): Promise<HccJson> {
  const token = await hccGetAccessToken(input);
  const url = `${token.baseUrl}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;
  const res = await fetchWithTimeout(url, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      Token: token.accessToken,
    },
    body: input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    tokenCache.delete(orgCacheKey(input.organizationId));
    throw new HccApiError("HIKCONNECT_AUTH_FAILED", "Platnost Hik-Connect tokenu vypršela nebo je neplatný.");
  }
  if (res.status === 429) {
    throw new HccApiError("HIKCONNECT_RATE_LIMIT", "Překročen limit Hik-Connect API.");
  }
  if (!res.ok) {
    throw new HccApiError("HIKCONNECT_API_ERROR", `Hik-Connect HTTP ${res.status}.`);
  }

  return parseHccResponse((await res.json()) as HccJson);
}

export async function hccTestConnection(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
}): Promise<{ latencyMs: number; systemGuid?: string | null }> {
  const started = Date.now();
  await hccGetAccessToken({ ...input, forceRefresh: true });
  const sys = await hccAuthorizedRequest({
    ...input,
    method: "GET",
    path: HCC_SYSTEM_PROPERTIES_PATH,
  });
  const data = (sys.data ?? {}) as HccJson;
  return {
    latencyMs: Date.now() - started,
    systemGuid: data.systemGUID ? String(data.systemGUID) : null,
  };
}

export type HccDeviceRow = {
  id: string;
  name: string;
  serialNo: string;
  model: string;
  online: boolean;
  category: string;
};

export async function hccListDevices(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
}): Promise<HccDeviceRow[]> {
  const out: HccDeviceRow[] = [];
  let pageIndex = 1;
  const pageSize = 100;
  for (;;) {
    const json = await hccAuthorizedRequest({
      ...input,
      method: "POST",
      path: HCC_DEVICES_GET_PATH,
      body: {
        pageIndex,
        pageSize,
        deviceCategory: "encodingDevice",
        filter: { matchKey: "", jobNumber: "" },
      },
    });
    const data = (json.data ?? {}) as HccJson;
    const devices = Array.isArray(data.device) ? data.device : [];
    for (const d of devices) {
      const row = d as HccJson;
      out.push({
        id: String(row.id ?? ""),
        name: String(row.name ?? ""),
        serialNo: String(row.serialNo ?? ""),
        model: String(row.type ?? ""),
        online: Number(row.onlineStatus) === 1,
        category: String(row.category ?? ""),
      });
    }
    const total = Number(data.totalCount) || out.length;
    if (out.length >= total || devices.length < pageSize) break;
    pageIndex += 1;
    if (pageIndex > 50) break;
  }
  return out.filter((d) => d.id);
}

export type HccCameraRow = {
  id: string;
  name: string;
  online: boolean;
  deviceId: string;
  deviceSerial: string;
  channelNo: string;
  channelId: string;
};

export async function hccListCameras(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
  deviceSerialNo?: string;
}): Promise<HccCameraRow[]> {
  const out: HccCameraRow[] = [];
  let pageIndex = 1;
  const pageSize = 100;
  for (;;) {
    const filter: HccJson = {
      areaID: "",
      includeSubArea: "1",
      deviceID: "",
      deviceSerialNo: input.deviceSerialNo ?? "",
      cameraID: [],
    };
    const json = await hccAuthorizedRequest({
      ...input,
      method: "POST",
      path: HCC_CAMERAS_GET_PATH,
      body: { pageIndex, pageSize, filter },
    });
    const data = (json.data ?? {}) as HccJson;
    const cameras = Array.isArray(data.camera) ? data.camera : [];
    for (const c of cameras) {
      const row = c as HccJson;
      const device = (row.device ?? {}) as HccJson;
      const devInfo = (device.devInfo ?? {}) as HccJson;
      const channelInfo = (device.channelInfo ?? {}) as HccJson;
      const deviceId = String(devInfo.id ?? "");
      const serial = String(devInfo.serialNo ?? "");
      const channelNo = String(channelInfo.no ?? "");
      const channelId = String(channelInfo.id ?? row.id ?? "");
      out.push({
        id: String(row.id ?? channelId),
        name: String(row.name ?? `Kanál ${channelNo}`),
        online: String(row.online) === "1",
        deviceId,
        deviceSerial: serial,
        channelNo,
        channelId,
      });
    }
    const total = Number(data.totalCount) || out.length;
    if (out.length >= total || cameras.length < pageSize) break;
    pageIndex += 1;
    if (pageIndex > 50) break;
  }
  return out;
}

export async function hccGetStreamToken(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
}): Promise<{ appKey?: string; appToken?: string; streamAreaDomain?: string }> {
  const json = await hccAuthorizedRequest({
    ...input,
    method: "GET",
    path: HCC_STREAM_TOKEN_PATH,
  });
  const data = (json.data ?? {}) as HccJson;
  return {
    appKey: data.appKey ? String(data.appKey) : undefined,
    appToken: data.appToken ? String(data.appToken) : undefined,
    streamAreaDomain: data.streamAreaDomai
      ? String(data.streamAreaDomai)
      : data.streamAreaDomain
        ? String(data.streamAreaDomain)
        : undefined,
  };
}

export async function hccCapturePicture(input: {
  organizationId: string;
  db: Firestore;
  apiKey: string;
  apiSecret: string;
  deviceSerial: string;
  channelNo: string;
}): Promise<{ captureUrl?: string }> {
  const json = await hccAuthorizedRequest({
    organizationId: input.organizationId,
    db: input.db,
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    method: "POST",
    path: HCC_CAPTURE_PIC_PATH,
    body: { deviceSerial: input.deviceSerial, channelNo: Number(input.channelNo) || 1 },
  });
  const data = (json.data ?? {}) as HccJson;
  return { captureUrl: data.captureUrl ? String(data.captureUrl) : undefined };
}
