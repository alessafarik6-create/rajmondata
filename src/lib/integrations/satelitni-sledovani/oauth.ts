import * as client from "openid-client";
import {
  satelitniDiscoveryUrl,
  satelitniOAuthClientId,
  satelitniOAuthRedirectUri,
  satelitniOAuthRegisterUrl,
  satelitniOAuthScope,
} from "@/lib/integrations/satelitni-sledovani/config";
import { logGpsOAuthStart } from "@/lib/integrations/satelitni-sledovani/oauth-diagnostics";
import { generatePkceCodeVerifier, pkceCodeChallengeS256 } from "@/lib/integrations/satelitni-sledovani/pkce";

let cachedConfig: client.Configuration | null = null;
let cachedClientId: string | null = null;

async function resolveClientId(): Promise<string> {
  const fromEnv = satelitniOAuthClientId();
  if (fromEnv) return fromEnv;
  throw new Error(
    "Chybí SATELITNI_SLEDOVANI_CLIENT_ID. OAuth klient zaregistrujte jednorázově přes POST /oauth/register."
  );
}

export async function getSatelitniOAuthConfiguration(): Promise<client.Configuration> {
  const clientId = await resolveClientId();
  if (cachedConfig && cachedClientId === clientId) return cachedConfig;
  cachedClientId = clientId;
  cachedConfig = await client.discovery(new URL(satelitniDiscoveryUrl()), clientId, {
    token_endpoint_auth_method: "none",
  });
  return cachedConfig;
}

/** Jednorázová registrace public klienta (spusťte ručně / skript, ne při každém loginu). */
export async function registerSatelitniPublicClient(): Promise<{ client_id: string }> {
  const redirectUri = satelitniOAuthRedirectUri();
  const res = await fetch(satelitniOAuthRegisterUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "RAJMONDATA",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Registrace OAuth klienta selhala (HTTP ${res.status}).`);
  }
  const j = JSON.parse(text) as { client_id?: string };
  if (!j.client_id) throw new Error("Registrace nevrátila client_id.");
  return { client_id: j.client_id };
}

export async function buildSatelitniAuthorizeUrl(input: {
  codeVerifier: string;
  state: string;
}): Promise<string> {
  const config = await getSatelitniOAuthConfiguration();
  const redirectUri = satelitniOAuthRedirectUri();
  const scope = satelitniOAuthScope();
  const meta = config.serverMetadata();
  logGpsOAuthStart({
    clientIdConfigured: Boolean(satelitniOAuthClientId()),
    redirectUri,
    authorizationEndpoint: String(meta.authorization_endpoint ?? ""),
    tokenEndpoint: String(meta.token_endpoint ?? ""),
    scope,
  });
  const codeChallenge = pkceCodeChallengeS256(input.codeVerifier);
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: input.state,
    response_type: "code",
  });
  return url.href;
}

export async function exchangeSatelitniAuthorizationCode(input: {
  callbackUrl: URL;
  codeVerifier: string;
  expectedState: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const config = await getSatelitniOAuthConfiguration();
  const tokenResponse = await client.authorizationCodeGrant(config, input.callbackUrl, {
    pkceCodeVerifier: input.codeVerifier,
    expectedState: input.expectedState,
  });
  const accessToken = tokenResponse.access_token;
  const refreshToken = tokenResponse.refresh_token;
  if (!accessToken || !refreshToken) {
    throw new Error("OAuth odpověď neobsahuje access nebo refresh token.");
  }
  const expiresIn = Number(tokenResponse.expires_in ?? 3600);
  return {
    accessToken: String(accessToken),
    refreshToken: String(refreshToken),
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
  };
}

export async function refreshSatelitniTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const config = await getSatelitniOAuthConfiguration();
  const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
  const accessToken = tokenResponse.access_token;
  const newRefresh = tokenResponse.refresh_token ?? refreshToken;
  if (!accessToken) throw new Error("Refresh token grant nevrátil access token.");
  const expiresIn = Number(tokenResponse.expires_in ?? 3600);
  return {
    accessToken: String(accessToken),
    refreshToken: String(newRefresh),
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
  };
}
