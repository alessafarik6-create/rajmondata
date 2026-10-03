import { NextRequest, NextResponse } from "next/server";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { removeBankTransactionMatch } from "@/lib/bank/apply-match";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ matchId: string }> }
) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { matchId } = await ctx.params;
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  try {
    await removeBankTransactionMatch(perm.db, organizationId, matchId, perm.caller.uid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Zrušení párování selhalo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
