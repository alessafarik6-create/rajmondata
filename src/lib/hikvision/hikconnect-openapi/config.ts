/**
 * Hik-Connect for Teams / HikCentral Connect OpenAPI
 * @see HikCentral Connect OpenAPI Developer Guide (Chapter 3 — AK/SK → Token)
 */

export type HikConnectRegion = "eu" | "us" | "sg" | "sa" | "ru";

/** Regionální hostname dle dokumentace (Getting Started — Country/Region Server Address). */
const REGION_HOST: Record<HikConnectRegion, string> = {
  eu: "ieu.hikcentralconnect.com",
  us: "ius.hikcentralconnect.com",
  sg: "isg.hikcentralconnect.com",
  sa: "isa.hikcentralconnect.com",
  ru: "iru.hikcentralconnect.com",
};

export const HCC_TOKEN_PATH = "/api/hccgw/platform/v1/token/get";
export const HCC_SYSTEM_PROPERTIES_PATH = "/api/hccgw/platform/v1/systemproperties";
export const HCC_DEVICES_GET_PATH = "/api/hccgw/resource/v1/devices/get";
export const HCC_CAMERAS_GET_PATH = "/api/hccgw/resource/v1/areas/cameras/get";
export const HCC_STREAM_TOKEN_PATH = "/api/hccgw/platform/v1/streamtoken/get";
export const HCC_CAPTURE_PIC_PATH = "/api/hccgw/resource/v1/device/capturePic";
export const HCC_LIVE_ADDRESS_PATH = "/api/hccgw/video/v1/live/address/get";
export const HCC_RECORD_SETTINGS_PATH = "/api/hccgw/video/v1/recordsettings/get";
export const HCC_ALARM_MQ_SUBSCRIBE_PATH = "/api/hccgw/alarm/v1/mq/subscribe";
export const HCC_ALARM_MQ_MESSAGES_PATH = "/api/hccgw/alarm/v1/mq/messages";
export const HCC_ALARM_MQ_MESSAGES_COMPLETE_PATH = "/api/hccgw/alarm/v1/mq/messages/complete";
export const HCC_ISAPI_PROXY_PASS_PATH = "/api/hccgw/video/v1/isapi/proxypass";

export function resolveHikConnectApiBaseUrl(areaDomain?: string | null): string {
  const fromEnv = String(process.env.HIKCONNECT_OPENAPI_BASE_URL ?? "").trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const domain = String(areaDomain ?? "").trim();
  if (domain) {
    const host = domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `https://${host}`;
  }
  const region = String(process.env.HIKCONNECT_OPENAPI_REGION ?? "eu")
    .trim()
    .toLowerCase() as HikConnectRegion;
  const host = REGION_HOST[region] ?? REGION_HOST.eu;
  return `https://${host}`;
}

export function isHikConnectOpenApiServerConfigured(): boolean {
  if (String(process.env.HIKCONNECT_OPENAPI_BASE_URL ?? "").trim()) return true;
  return true;
}
