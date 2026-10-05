import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import { bankTransactionsCol, bankMatchesCol } from "@/lib/bank/collections";
import {
  bankTransactionMatchesFilter,
  parseBankTransactionFilterFromSearchParams,
  bankDatePresetRange,
} from "@/lib/bank/transaction-query";

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

  const sp = request.nextUrl.searchParams;
  let filter = parseBankTransactionFilterFromSearchParams(sp);
  const preset = sp.get("datePreset");
  if (preset) {
    const today = new Date().toISOString().split("T")[0];
    const range = bankDatePresetRange(preset, today);
    if (range) {
      filter = { ...filter, dateFrom: range.dateFrom, dateTo: range.dateTo };
    }
  }

  const limit = Math.min(500, Math.max(1, Number(sp.get("limit") ?? 200) || 200));
  const snap = await bankTransactionsCol(perm.db, organizationId)
    .orderBy("bookingDate", "desc")
    .limit(limit)
    .get();

  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as import("@/lib/bank/types").BankTransactionDoc) }))
    .filter((r) => bankTransactionMatchesFilter(r, filter));

  const matchSnap = await bankMatchesCol(perm.db, organizationId).limit(500).get();
  const matchesByTxn = new Map<string, unknown[]>();
  for (const m of matchSnap.docs) {
    const tid = String(m.data().transactionId ?? "");
    if (!tid) continue;
    const list = matchesByTxn.get(tid) ?? [];
    list.push({ id: m.id, ...m.data() });
    matchesByTxn.set(tid, list);
  }

  return NextResponse.json({
    ok: true,
    transactions: rows.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      bookingDate: t.bookingDate,
      valueDate: t.valueDate,
      amount: t.amount,
      currency: t.currency,
      direction: t.direction,
      counterpartyName: t.counterpartyName,
      counterpartyAccount: t.counterpartyAccount,
      variableSymbol: t.variableSymbol,
      constantSymbol: t.constantSymbol,
      specificSymbol: t.specificSymbol,
      reference: t.reference,
      message: t.message,
      classification: t.classification,
      matchStatus: t.matchStatus,
      expenseCategory: t.expenseCategory,
      matchedAmountTotal: t.matchedAmountTotal ?? 0,
      note: t.note ?? null,
      suggestedMatches: t.suggestedMatches ?? [],
      suggestedMatchesAt: t.suggestedMatchesAt ?? null,
      matches: matchesByTxn.get(t.id) ?? [],
    })),
    filter,
  });
}
