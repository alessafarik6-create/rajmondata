import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  fleetIntegrationRef,
  loadFleetIntegration,
  saveFleetIntegrationCredentials,
} from "@/lib/fleet/stores";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { isFleetIntegrationEncryptionConfigured } from "@/lib/fleet/integration-crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!fleetTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const integration = await loadFleetIntegration(auth.db, companyId);
  return NextResponse.json({
    ok: true,
    integration: integration
      ? {
          provider: integration.provider,
          status: integration.status,
          apiBaseUrl: integration.apiBaseUrl ?? null,
          lastTestAt: integration.lastTestAt?.toDate?.()?.toISOString?.() ?? null,
          lastError: integration.lastError ?? null,
          hasApiKey: integration.status === "configured",
        }
      : {
          provider: "ECOFLEET",
          status: "not_connected",
          apiBaseUrl: null,
          hasApiKey: false,
        },
    encryptionConfigured: isFleetIntegrationEncryptionConfigured(),
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string; apiBaseUrl?: string; apiKey?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!fleetTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  if (body.apiKey && !isFleetIntegrationEncryptionConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Server nemá nastaven šifrovací klíč (EMAIL_CREDENTIALS_ENCRYPTION_KEY / integrace).",
      },
      { status: 503 }
    );
  }

  const ref = fleetIntegrationRef(auth.db, companyId);
  const patch: Record<string, unknown> = {
    organizationId: companyId,
    provider: "ECOFLEET",
    updatedAt: FieldValue.serverTimestamp(),
    configuredByUserId: auth.caller.uid,
  };
  if (body.apiBaseUrl !== undefined) patch.apiBaseUrl = String(body.apiBaseUrl ?? "").trim() || null;
  if (body.status === "disabled") patch.status = "disabled";
  else if (body.apiBaseUrl) patch.status = "configured";

  await ref.set(patch, { merge: true });

  if (body.apiKey?.trim()) {
    await saveFleetIntegrationCredentials(auth.db, companyId, body.apiKey.trim());
  }

  return NextResponse.json({ ok: true, message: "Integrace uložena. Test připojení bude dostupný po implementaci Ecofleet API." });
}
