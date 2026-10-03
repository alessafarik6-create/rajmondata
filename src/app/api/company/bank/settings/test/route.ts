import { NextRequest, NextResponse } from "next/server";
import { requireBankIntegrationAdmin, bankTenantOk } from "@/lib/bank/api-auth";
import { testBankConnectionForOrg } from "@/lib/bank/connection-store";
import { writeBankAuditLog } from "@/lib/bank/audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireBankIntegrationAdmin(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    await testBankConnectionForOrg(perm.db, organizationId);
    await writeBankAuditLog(perm.db, {
      organizationId,
      userId: perm.caller.uid,
      action: "BANK_CONNECTION_UPDATED",
      metadata: { test: "ok" },
    });
    return NextResponse.json({ ok: true, message: "Spojení s bankou je v pořádku." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Test spojení selhal.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
