/** Konfigurace SatelitníSledování.cz REST API v2 + OAuth 2.1 (public client, PKCE). */

export function satelitniDiscoveryUrl(): string {
  return (
    String(process.env.SATELITNI_SLEDOVANI_DISCOVERY_URL ?? "").trim() ||
    "https://app.satelitnisledovani.cz/.well-known/oauth-authorization-server"
  );
}

export function satelitniApiBaseUrl(): string {
  return (
    String(process.env.SATELITNI_SLEDOVANI_BASE_URL ?? "").trim() ||
    "https://app.satelitnisledovani.cz/api/v2"
  ).replace(/\/$/, "");
}

export function satelitniOAuthRedirectUri(): string {
  const raw =
    String(process.env.SATELITNI_SLEDOVANI_REDIRECT_URI ?? "").trim() ||
    "https://rajmondata.cz/api/integrations/satelitni-sledovani/callback";
  return raw;
}

export function satelitniOAuthClientId(): string {
  return String(process.env.SATELITNI_SLEDOVANI_CLIENT_ID ?? "").trim();
}

export function satelitniOAuthRegisterUrl(): string {
  return "https://app.satelitnisledovani.cz/oauth/register";
}

/** Minuty bez signálu → offline (env SATELITNI_SLEDOVANI_OFFLINE_MINUTES). */
export function satelitniOfflineThresholdMinutes(): number {
  const n = Number(process.env.SATELITNI_SLEDOVANI_OFFLINE_MINUTES ?? 15);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export function satelitniSyncConcurrency(): number {
  const n = Number(process.env.SATELITNI_SLEDOVANI_SYNC_CONCURRENCY ?? 5);
  return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : 5;
}
