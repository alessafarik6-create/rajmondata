import { NextRequest, NextResponse } from "next/server";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { generatePkceCodeVerifier } from "@/lib/integrations/satelitni-sledovani/pkce";
import { encodeOAuthState } from "@/lib/integrations/satelitni-sledovani/oauth-state";
import { saveOAuthPending } from "@/lib/integrations/satelitni-sledovani/store";
import { buildSatelitniAuthorizeUrl } from "@/lib/integrations/satelitni-sledovani/oauth";
import { isSatelitniEncryptionConfigured } from "@/lib/integrations/satelitni-sledovani/crypto";

export const dynamic = "force-dynamic";

/**
 * GET s Authorization Bearer — vrátí authorize URL (PKCE).
 * UI poté přesměruje prohlížeč na poskytovatele.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!isSatelitniEncryptionConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Chybí šifrovací klíč (SATELITNI_SLEDOVANI_ENCRYPTION_KEY nebo EMAIL_CREDENTIALS_ENCRYPTION_KEY).",
      },
      { status: 503 }
    );
  }

  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!fleetTenantOk(auth.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    const codeVerifier = generatePkceCodeVerifier();
    const state = encodeOAuthState(organizationId);
    await saveOAuthPending(auth.db, organizationId, state, {
      userId: auth.caller.uid,
      codeVerifier,
    });
    const authorizeUrl = await buildSatelitniAuthorizeUrl({ codeVerifier, state });
    return NextResponse.json({ ok: true, authorizeUrl, state });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nepodařilo se zahájit OAuth.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
