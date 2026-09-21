/**
 * Server-side konfigurace Hik-Connect OpenAPI.
 * Hodnoty pouze z env — nikdy z klienta.
 */

export type HikConnectOpenApiServerConfig = {
  baseUrl: string | null;
  /** Relativní cesta pro test — doplnit dle oficiální dokumentace. */
  testPath: string | null;
};

export function getHikConnectOpenApiServerConfig(): HikConnectOpenApiServerConfig {
  const baseUrl = String(process.env.HIKCONNECT_OPENAPI_BASE_URL ?? "").trim() || null;
  const testPath = String(process.env.HIKCONNECT_OPENAPI_TEST_PATH ?? "").trim() || null;
  return { baseUrl, testPath };
}

export function isHikConnectOpenApiServerConfigured(): boolean {
  const { baseUrl, testPath } = getHikConnectOpenApiServerConfig();
  return Boolean(baseUrl && testPath);
}
