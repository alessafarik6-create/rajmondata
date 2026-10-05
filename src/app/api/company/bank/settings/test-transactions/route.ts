import { NextRequest, NextResponse } from "next/server";
import { requireBankIntegrationAdmin, bankTenantOk } from "@/lib/bank/api-auth";
import { testBankTransactionsForOrg } from "@/lib/bank/connection-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const result = await testBankTransactionsForOrg(perm.db, organizationId);
    return NextResponse.json(
      {
        ...result,
        ok: result.ok,
      },
      { status: result.ok ? 200 : result.httpStatus >= 400 ? result.httpStatus : 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Test transakcí selhal.";
    return NextResponse.json({ ok: false, error: msg, message: msg }, { status: 500 });
  }
}
