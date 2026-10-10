import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { parseOAuthState } from "@/lib/integrations/satelitni-sledovani/oauth-state";
import {
  consumeOAuthPending,
  saveSatelitniOAuthTokens,
} from "@/lib/integrations/satelitni-sledovani/store";
import { exchangeSatelitniAuthorizationCode } from "@/lib/integrations/satelitni-sledovani/oauth";
import { fleetIntegrationRef } from "@/lib/fleet/stores";
import { satelitniOAuthClientId } from "@/lib/integrations/satelitni-sledovani/config";
import { writeSatelitniFleetAudit } from "@/lib/integrations/satelitni-sledovani/fleet-audit";
import {
  buildIntegraceOAuthRedirect,
  logGpsOAuthCallbackError,
  logGpsOAuthCallbackTokenExchangeError,
  sanitizeOAuthLogValue,
} from "@/lib/integrations/satelitni-sledovani/oauth-diagnostics";

export const dynamic = "force-dynamic";

function appOrigin(request: NextRequest): string {
  return (
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

function providerErrorRedirect(
  origin: string,
  input: {
    error: string;
    errorDescription: string | null;
    errorUri: string | null;
    statePresent: boolean;
  }
): NextResponse {
  logGpsOAuthCallbackError({
    error: input.error,
    errorDescription: input.errorDescription,
    errorUri: input.errorUri,
    statePresent: input.statePresent,
  });
  return NextResponse.redirect(
    buildIntegraceOAuthRedirect(origin, {
      gps_oauth_error: input.error,
      gps_oauth_error_description: sanitizeOAuthLogValue(input.errorDescription),
    })
  );
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const origin = appOrigin(request);
  const params = request.nextUrl.searchParams;
  const state = String(params.get("state") ?? "");
  const oauthError = params.get("error");
  const errorDescription = params.get("error_description");
  const errorUri = params.get("error_uri");

  if (!db) {
    logGpsOAuthCallbackError({
      error: "server_misconfigured",
      errorDescription: "Firebase Admin není k dispozici.",
      errorUri: null,
      statePresent: Boolean(state),
    });
    return NextResponse.redirect(
      buildIntegraceOAuthRedirect(origin, {
        gps_oauth_error: "server_misconfigured",
        gps_oauth_error_description: "Server není nakonfigurován.",
      })
    );
  }

  if (oauthError) {
    return providerErrorRedirect(origin, {
      error: oauthError,
      errorDescription,
      errorUri,
      statePresent: Boolean(state),
    });
  }

  const parsed = parseOAuthState(state);
  if (!parsed) {
    logGpsOAuthCallbackError({
      error: "invalid_state",
      errorDescription: "Nepodařilo se ověřit parametr state.",
      errorUri: null,
      statePresent: Boolean(state),
    });
    return NextResponse.redirect(
      buildIntegraceOAuthRedirect(origin, {
        gps_oauth_error: "invalid_state",
        gps_oauth_error_description: "Neplatný stav OAuth. Zkuste připojení znovu.",
      })
    );
  }

  const pending = await consumeOAuthPending(db, parsed.organizationId, state);
  if (!pending) {
    logGpsOAuthCallbackError({
      error: "pending_not_found",
      errorDescription: "Chybí nebo vypršel uložený PKCE stav (state/code_verifier).",
      errorUri: null,
      statePresent: true,
    });
    return NextResponse.redirect(
      buildIntegraceOAuthRedirect(origin, {
        gps_oauth_error: "pending_not_found",
        gps_oauth_error_description:
          "Platnost připojení vypršela nebo byl stav již použit. Spusťte OAuth znovu.",
      })
    );
  }

  const code = params.get("code");
  if (!code) {
    logGpsOAuthCallbackError({
      error: "missing_code",
      errorDescription: "Callback neobsahuje authorization code.",
      errorUri: null,
      statePresent: true,
    });
    return NextResponse.redirect(
      buildIntegraceOAuthRedirect(origin, {
        gps_oauth_error: "missing_code",
        gps_oauth_error_description: "Poskytovatel nevrátil autorizační kód.",
      })
    );
  }

  try {
    const tokens = await exchangeSatelitniAuthorizationCode({
      callbackUrl: new URL(request.url),
      codeVerifier: pending.codeVerifier,
      expectedState: state,
    });

    await saveSatelitniOAuthTokens(db, parsed.organizationId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresIn,
    });

    await fleetIntegrationRef(db, parsed.organizationId).set(
      {
        organizationId: parsed.organizationId,
        provider: "SATELITNI_SLEDOVANI",
        status: "connected",
        oauthClientId: satelitniOAuthClientId() || null,
        connectedAt: Timestamp.now(),
        connectedByUserId: pending.userId,
        lastError: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await writeSatelitniFleetAudit(db, {
      organizationId: parsed.organizationId,
      userId: pending.userId,
      action: "GPS_CONNECTED",
    });

    return NextResponse.redirect(
      buildIntegraceOAuthRedirect(origin, { gps: "connected", gps_sync: "1" })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token exchange selhal.";
    logGpsOAuthCallbackTokenExchangeError(msg);
    return NextResponse.redirect(
      buildIntegraceOAuthRedirect(origin, {
        gps_oauth_error: "token_exchange_failed",
        gps_oauth_error_description: sanitizeOAuthLogValue(msg),
      })
    );
  }
}
