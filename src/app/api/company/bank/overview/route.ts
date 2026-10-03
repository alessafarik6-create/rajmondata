import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import {
  bankConnectionPublicView,
  loadBankConnection,
  listActiveBankAccounts,
} from "@/lib/bank/connection-store";
import { bankTransactionsCol } from "@/lib/bank/collections";
import { roundMoney2 } from "@/lib/vat-calculations";

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
  const accounts = await listActiveBankAccounts(perm.db, organizationId);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const txSnap = await bankTransactionsCol(perm.db, organizationId)
    .where("bookingDate", ">=", monthStart)
    .limit(2000)
    .get()
    .catch(() => null);

  let incomingMonth = 0;
  let outgoingMonth = 0;
  let unmatched = 0;
  let matched = 0;

  if (txSnap) {
    for (const doc of txSnap.docs) {
      const t = doc.data();
      if (t.classification === "internal_transfer" || t.classification === "ignored") continue;
      const amt = roundMoney2(Number(t.amount ?? 0));
      if (amt >= 0) incomingMonth += amt;
      else outgoingMonth += Math.abs(amt);
      if (t.classification === "matched") matched += 1;
      else if (t.classification === "unmatched" && Number(t.matchedAmountTotal ?? 0) <= 0) {
        unmatched += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    connection: bankConnectionPublicView(conn),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      accountNumber: a.accountNumber,
      currency: a.currency,
      balance: a.balance,
      availableBalance: a.availableBalance,
      isActive: a.isActive !== false,
    })),
    summary: {
      incomingMonth: roundMoney2(incomingMonth),
      outgoingMonth: roundMoney2(outgoingMonth),
      unmatchedCount: unmatched,
      matchedCount: matched,
    },
  });
}
