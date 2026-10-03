import { NextRequest, NextResponse } from "next/server";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { syncBankForOrganization } from "@/lib/bank/sync-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    const result = await syncBankForOrganization(perm.db, organizationId, perm.caller.uid);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Synchronizace selhala.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
