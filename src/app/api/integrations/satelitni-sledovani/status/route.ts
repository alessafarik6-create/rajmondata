import { NextRequest, NextResponse } from "next/server";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { loadFleetIntegration, listFleetVehicles } from "@/lib/fleet/stores";
import { loadSatelitniOAuthTokens } from "@/lib/integrations/satelitni-sledovani/store";
import { isSatelitniEncryptionConfigured } from "@/lib/integrations/satelitni-sledovani/crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || auth.caller.companyId;
  if (!fleetTenantOk(auth.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const integration = await loadFleetIntegration(auth.db, organizationId);
  const tokens = await loadSatelitniOAuthTokens(auth.db, organizationId);
  const vehicles = await listFleetVehicles(auth.db, organizationId);
  const satelitniCount = vehicles.filter((v) => v.externalProvider === "SATELITNI_SLEDOVANI").length;

  const connected = Boolean(tokens);
  let tokenActive = false;
  if (tokens) {
    tokenActive = tokens.expiresAt.getTime() > Date.now();
  }

  let connectedByLabel: string | null = null;
  const connectedByUserId = String(integration?.connectedByUserId ?? "").trim();
  if (connectedByUserId) {
    const userSnap = await auth.db.collection("users").doc(connectedByUserId).get();
    const u = userSnap.data();
    connectedByLabel =
      String(u?.displayName ?? u?.email ?? "").trim() || connectedByUserId;
  }

  return NextResponse.json({
    ok: true,
    provider: "satelitnisledovani",
    status: connected ? (integration?.status === "error" ? "error" : "connected") : "disconnected",
    connected,
    tokenActive,
    encryptionConfigured: isSatelitniEncryptionConfigured(),
    lastSyncAt: integration?.lastSyncAt?.toDate?.()?.toISOString?.() ?? null,
    connectedAt: integration?.connectedAt?.toDate?.()?.toISOString?.() ?? null,
    connectedByLabel,
    vehicleCount: satelitniCount,
    lastSyncError: integration?.lastSyncError ?? null,
  });
}
