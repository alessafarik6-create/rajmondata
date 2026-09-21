/**
 * TODO: Implementovat podpis requestů dle oficiální Hik-Connect OpenAPI dokumentace
 * (timestamp, nonce, hash algoritmus, canonical string, atd.).
 *
 * DO NOT GUESS — bez dokumentace neposílat produkční volání.
 */

export type HikConnectSignedRequest = {
  headers: Record<string, string>;
  /** Query string nebo path — doplnit dle spec. */
};

export function signHikConnectOpenApiRequest(_input: {
  method: string;
  path: string;
  body?: string;
  apiKey: string;
  apiSecret: string;
}): HikConnectSignedRequest | null {
  // TODO(HIKCONNECT_OPENAPI): implement when official signing spec is available
  return null;
}
