import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, requireBankIntegrationAdmin, bankTenantOk } from "@/lib/bank/api-auth";
import {
  bankConnectionPublicView,
  loadBankConnection,
  upsertBankConnectionSettings,
} from "@/lib/bank/connection-store";
import { writeBankAuditLog } from "@/lib/bank/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireBankRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const conn = await loadBankConnection(perm.db, organizationId);
  return NextResponse.json({ ok: true, settings: bankConnectionPublicView(conn) });
}

export async function POST(request: NextRequest) {
  const perm = await requireBankIntegrationAdmin(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  const form = await request.formData();
  const organizationId =
    String(form.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const clientId = String(form.get("clientId") ?? "").trim();
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "ClientID je povinné." }, { status: 400 });
  }

  const certFile = form.get("certificate");
  const password = String(form.get("certificatePassword") ?? "");
  let p12: Buffer | null = null;
  if (certFile instanceof File && certFile.size > 0) {
    const buf = Buffer.from(await certFile.arrayBuffer());
    if (buf.length > 512 * 1024) {
      return NextResponse.json({ ok: false, error: "Certifikát je příliš velký." }, { status: 400 });
    }
    p12 = buf;
    if (!password) {
      return NextResponse.json({ ok: false, error: "Zadejte heslo certifikátu." }, { status: 400 });
    }
  }

  try {
    await upsertBankConnectionSettings(perm.db, organizationId, {
      clientId,
      certificateP12: p12,
      certificatePassword: password || null,
      userId: perm.caller.uid,
    });
    await writeBankAuditLog(perm.db, {
      organizationId,
      userId: perm.caller.uid,
      action: p12 ? "BANK_CONNECTED" : "BANK_CONNECTION_UPDATED",
      metadata: { clientIdMasked: clientId.slice(-4) },
    });
    const conn = await loadBankConnection(perm.db, organizationId);
    return NextResponse.json({ ok: true, settings: bankConnectionPublicView(conn) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Uložení selhalo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
