import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import { bankAccountsCol, bankConnectionsCol } from "@/lib/bank/collections";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ accountId: string }> }
) {
  const perm = await requireBankRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { accountId } = await ctx.params;
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const accSnap = await bankAccountsCol(perm.db, organizationId).doc(accountId).get();
  if (!accSnap.exists) {
    return NextResponse.json({ ok: false, error: "Účet nenalezen." }, { status: 404 });
  }
  const acc = accSnap.data() as Record<string, unknown>;
  if (String(acc.organizationId) !== organizationId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const connSnap = await bankConnectionsCol(perm.db, organizationId).limit(1).get();
  const conn = connSnap.docs[0]?.data() as Record<string, unknown> | undefined;

  return NextResponse.json({
    ok: true,
    account: {
      id: accSnap.id,
      name: acc.name ?? null,
      accountNumber: acc.accountNumber ?? null,
      iban: acc.iban ?? null,
      currency: acc.currency ?? "CZK",
      balance: acc.balance ?? null,
      availableBalance: acc.availableBalance ?? acc.balance ?? null,
      isActive: acc.isActive !== false,
      lastSyncAt: conn?.lastSyncAt ?? null,
    },
  });
}
