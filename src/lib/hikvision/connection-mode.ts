/** Kanonické hodnoty ukládané ve Firestore a v API. */
export type HikvisionConnectionModeCanonical =
  | "HIKCONNECT_OPENAPI"
  | "DIRECT_ISAPI"
  | "LOCAL_CONNECTOR";

export type HikvisionIntegrationLifecycle =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "CONNECTED"
  | "ERROR";

export function normalizeConnectionMode(
  raw: string | undefined | null
): HikvisionConnectionModeCanonical {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (v === "hikconnect_openapi" || v === "hikconnect" || v === "hik_connect_openapi") {
    return "HIKCONNECT_OPENAPI";
  }
  if (v === "local_connector" || v === "localconnector") {
    return "LOCAL_CONNECTOR";
  }
  if (v === "direct_isapi" || v === "direct") {
    return "DIRECT_ISAPI";
  }
  if (!v) {
    return "DIRECT_ISAPI";
  }
  return "DIRECT_ISAPI";
}

export function connectionModeLabel(mode: HikvisionConnectionModeCanonical): string {
  if (mode === "HIKCONNECT_OPENAPI") return "Hik-Connect Cloud / OpenAPI";
  if (mode === "LOCAL_CONNECTOR") return "Local Connector";
  return "Direct ISAPI";
}

export function providerNameForMode(mode: HikvisionConnectionModeCanonical): string {
  if (mode === "HIKCONNECT_OPENAPI") return "HikConnectOpenApiProvider";
  if (mode === "LOCAL_CONNECTOR") return "LocalConnectorProvider";
  return "DirectIsapiProvider";
}

export function isIntegrationActiveFlag(active: boolean | undefined | null): boolean {
  return active !== false;
}
