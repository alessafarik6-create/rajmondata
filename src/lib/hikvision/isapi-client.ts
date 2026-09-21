import { createHash, randomBytes } from "crypto";
import https from "node:https";
import { xmlBlocks, xmlBool, xmlTagText } from "@/lib/hikvision/xml-utils";

export type HikvisionIsapiConfig = {
  host: string;
  httpPort: number;
  httpsPort: number;
  useHttps: boolean;
  username: string;
  password: string;
  allowInsecureTls?: boolean;
  timeoutMs?: number;
};

export type HikvisionDeviceInfo = {
  deviceName: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
};

export type HikvisionInputProxyChannel = {
  channelId: string;
  name: string;
  ipAddress: string | null;
  model: string | null;
  serialNumber: string | null;
  online: boolean;
  trackStreamId: string;
};

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

function parseDigestChallenge(wwwAuthenticate: string): Record<string, string> {
  const out: Record<string, string> = {};
  const digest = wwwAuthenticate.replace(/^Digest\s+/i, "");
  for (const part of digest.split(",")) {
    const m = part.trim().match(/^(\w+)=(?:"([^"]*)"|([^\s"]+))$/);
    if (m) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return out;
}

function buildDigestAuthorization(params: {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: Record<string, string>;
}): string {
  const realm = params.challenge.realm ?? "";
  const nonce = params.challenge.nonce ?? "";
  const qop = params.challenge.qop?.split(",")[0]?.trim();
  const opaque = params.challenge.opaque;
  const algorithm = (params.challenge.algorithm ?? "MD5").toUpperCase();
  if (algorithm !== "MD5") {
    throw new Error(`Nepodporovaný Digest algoritmus: ${algorithm}`);
  }
  const ha1 = md5(`${params.username}:${realm}:${params.password}`);
  const ha2 = md5(`${params.method}:${params.uri}`);
  let response: string;
  let nc: string | undefined;
  let cnonce: string | undefined;
  if (qop === "auth" || qop === "auth-int") {
    nc = "00000001";
    cnonce = randomBytes(8).toString("hex");
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }
  const parts = [
    `username="${params.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${params.uri}"`,
    `response="${response}"`,
  ];
  if (opaque) parts.push(`opaque="${opaque}"`);
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  return `Digest ${parts.join(", ")}`;
}

function baseUrl(config: HikvisionIsapiConfig): string {
  const host = config.host.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const port = config.useHttps ? config.httpsPort : config.httpPort;
  const scheme = config.useHttps ? "https" : "http";
  return `${scheme}://${host}:${port}`;
}

function fetchInitFor(config: HikvisionIsapiConfig): RequestInit {
  if (!config.useHttps || !config.allowInsecureTls) return {};
  const agent = new https.Agent({ rejectUnauthorized: false });
  return { agent } as RequestInit;
}

async function isapiRequest(
  config: HikvisionIsapiConfig,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${baseUrl(config)}${path.startsWith("/") ? path : `/${path}`}`;
  const method = (init.method ?? "GET").toUpperCase();
  const timeoutMs = config.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tlsInit = fetchInitFor(config);
  try {
    const first = await fetch(url, {
      ...init,
      ...tlsInit,
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/xml, */*",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (first.status !== 401) return first;
    const www = first.headers.get("www-authenticate") ?? "";
    if (!www.toLowerCase().includes("digest")) {
      return first;
    }
    const uri = new URL(url).pathname + (new URL(url).search || "");
    const auth = buildDigestAuthorization({
      username: config.username,
      password: config.password,
      method,
      uri,
      challenge: parseDigestChallenge(www),
    });
    return fetch(url, {
      ...init,
      ...tlsInit,
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/xml, */*",
        Authorization: auth,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHikvisionDeviceInfo(
  config: HikvisionIsapiConfig
): Promise<{ ok: true; info: HikvisionDeviceInfo } | { ok: false; error: string; status?: number }> {
  try {
    const res = await isapiRequest(config, "/ISAPI/System/deviceInfo");
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `ISAPI deviceInfo HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      };
    }
    return {
      ok: true,
      info: {
        deviceName: xmlTagText(text, "deviceName"),
        model: xmlTagText(text, "model"),
        serialNumber: xmlTagText(text, "serialNumber"),
        firmwareVersion: xmlTagText(text, "firmwareVersion"),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) {
      return { ok: false, error: "Timeout při připojení k NVR." };
    }
    return { ok: false, error: msg || "Nepodařilo se spojit s NVR." };
  }
}

function resolveTrackStreamId(channelId: string): string {
  const n = Number.parseInt(channelId, 10);
  if (Number.isFinite(n) && n > 0) return String(n * 100 + 1);
  return `${channelId}01`;
}

export async function fetchHikvisionInputProxyChannels(
  config: HikvisionIsapiConfig
): Promise<
  | { ok: true; channels: HikvisionInputProxyChannel[] }
  | { ok: false; error: string; status?: number }
> {
  try {
    const res = await isapiRequest(config, "/ISAPI/ContentMgmt/InputProxy/channels");
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `ISAPI InputProxy/channels HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`,
      };
    }
    const blocks = xmlBlocks(text, "InputProxyChannel");
    const channels: HikvisionInputProxyChannel[] = [];
    for (const block of blocks) {
      const channelId =
        xmlTagText(block, "id") ??
        xmlTagText(block, "channelID") ??
        xmlTagText(block, "channelId");
      if (!channelId) continue;
      const name =
        xmlTagText(block, "name") ??
        xmlTagText(block, "channelName") ??
        `Kanál ${channelId}`;
      const ipAddress =
        xmlTagText(block, "ipAddress") ??
        xmlTagText(block, "hostName") ??
        xmlTagText(block, "ip");
      const model = xmlTagText(block, "model");
      const serialNumber = xmlTagText(block, "serialNumber");
      const online = xmlBool(xmlTagText(block, "online") ?? xmlTagText(block, "status"));
      const trackStreamId =
        xmlTagText(block, "streamingChannelID") ??
        xmlTagText(block, "trackStreamID") ??
        resolveTrackStreamId(channelId);
      channels.push({
        channelId,
        name,
        ipAddress,
        model,
        serialNumber,
        online,
        trackStreamId,
      });
    }
    return { ok: true, channels };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Načtení kanálů selhalo." };
  }
}

export async function fetchHikvisionChannelPicture(
  config: HikvisionIsapiConfig,
  trackStreamId: string
): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string }> {
  try {
    const path = `/ISAPI/Streaming/channels/${encodeURIComponent(trackStreamId)}/picture`;
    const res = await isapiRequest(config, path, {
      headers: { Accept: "image/jpeg, image/*, */*" },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Snapshot HTTP ${res.status}: ${t.slice(0, 120) || res.statusText}`,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return { ok: true, buffer: buf, contentType };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Snapshot selhal." };
  }
}
