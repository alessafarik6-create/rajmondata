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

export const dynamic = "force-dynamic";

function appOrigin(request: NextRequest): string {
  return (
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

export async function GET(request: NextRequest) {
  const db = getAdminFirestore();
  const origin = appOrigin(request);
  if (!db) {
    return NextResponse.redirect(new URL("/portal/settings?satelitni=error", origin));
  }

  const state = String(request.nextUrl.searchParams.get("state") ?? "");
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/portal/settings?satelitni=denied&reason=${encodeURIComponent(error)}`, origin)
    );
  }

  const parsed = parseOAuthState(state);
  if (!parsed) {
    return NextResponse.redirect(new URL("/portal/settings?satelitni=invalid_state", origin));
  }

  const pending = await consumeOAuthPending(db, parsed.organizationId, state);
  if (!pending) {
    return NextResponse.redirect(new URL("/portal/settings?satelitni=expired", origin));
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

    return NextResponse.redirect(new URL("/portal/fleet?satelitni=connected", origin));
  } catch {
    return NextResponse.redirect(new URL("/portal/fleet?satelitni=error", origin));
  }
}
