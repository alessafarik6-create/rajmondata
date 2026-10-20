import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { bankExpenseRulesCol } from "@/lib/bank/collections";
import type { BankExpenseCategory, BankMarketingSubcategory } from "@/lib/bank/types";
import { writeBankAuditLog } from "@/lib/bank/audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    matchKind?: "counterparty_contains" | "counterparty_exact" | "message_contains";
    matchValue?: string;
    expenseCategory?: BankExpenseCategory;
    marketingSubcategory?: BankMarketingSubcategory | null;
  };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const matchValue = String(body.matchValue ?? "").trim();
  if (!matchValue || !body.expenseCategory || !body.matchKind) {
    return NextResponse.json({ ok: false, error: "Neplatná data pravidla." }, { status: 400 });
  }

  const ref = bankExpenseRulesCol(perm.db, organizationId).doc();
  await ref.set({
    organizationId,
    matchKind: body.matchKind,
    matchValue,
    expenseCategory: body.expenseCategory,
    marketingSubcategory: body.marketingSubcategory ?? null,
    createdBy: perm.caller.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  await writeBankAuditLog(perm.db, {
    organizationId,
    userId: perm.caller.uid,
    action: "BANK_EXPENSE_RULE_CREATED",
    entityId: ref.id,
    metadata: { matchValue, expenseCategory: body.expenseCategory },
  });

  return NextResponse.json({ ok: true, ruleId: ref.id });
}
