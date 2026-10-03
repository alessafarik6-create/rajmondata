/** Bezpečné logování OAuth (bez code, tokenů, code_verifier). */

const MAX_DESC_LEN = 500;

export function sanitizeOAuthLogValue(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  if (!s) return "(empty)";
  if (s.length > MAX_DESC_LEN) return `${s.slice(0, MAX_DESC_LEN)}…`;
  return s;
}

export function logGpsOAuthCallbackError(input: {
  error: string | null;
  errorDescription: string | null;
  errorUri: string | null;
  statePresent: boolean;
}): void {
  console.error("[GPS OAUTH CALLBACK]");
  console.error(`error: ${sanitizeOAuthLogValue(input.error)}`);
  console.error(`error_description: ${sanitizeOAuthLogValue(input.errorDescription)}`);
  if (input.errorUri) {
    console.error(`error_uri: ${sanitizeOAuthLogValue(input.errorUri)}`);
  }
  console.error(`state_present: ${input.statePresent}`);
}

export function logGpsOAuthCallbackTokenExchangeError(message: string): void {
  console.error("[GPS OAUTH CALLBACK]");
  console.error("phase: token_exchange");
  console.error(`error_description: ${sanitizeOAuthLogValue(message)}`);
}

export function logGpsOAuthStart(input: {
  clientIdConfigured: boolean;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scope: string;
}): void {
  console.info("[GPS OAUTH START]");
  console.info(`clientId configured: ${input.clientIdConfigured}`);
  console.info(`redirectUri: ${input.redirectUri}`);
  console.info(`authorizationEndpoint: ${input.authorizationEndpoint}`);
  console.info(`tokenEndpoint: ${input.tokenEndpoint}`);
  console.info(`scope: ${input.scope}`);
  console.info("PKCE: S256");
}

export function gpsOAuthUserMessage(input: {
  error: string | null;
  errorDescription: string | null;
  fallback?: string;
}): string {
  const code = String(input.error ?? "").trim();
  const desc = sanitizeOAuthLogValue(input.errorDescription);
  if (code === "access_denied") {
    return "Připojení bylo zrušeno nebo zamítnuto.";
  }
  if (desc && desc !== "(empty)") {
    if (code) return `${code}: ${desc}`;
    return desc;
  }
  if (code) return code;
  return input.fallback ?? "OAuth se nepodařilo dokončit.";
}

export function buildIntegraceOAuthRedirect(
  origin: string,
  params: Record<string, string>
): URL {
  const url = new URL("/portal/settings", origin);
  url.searchParams.set("tab", "integrace");
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url;
}
