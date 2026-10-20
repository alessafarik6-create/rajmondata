import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { bankTransactionsCol } from "@/lib/bank/collections";
import type {
  BankExpenseCategory,
  BankMarketingSubcategory,
  BankTransactionClassification,
} from "@/lib/bank/types";
import { bankExpenseRulesCol } from "@/lib/bank/collections";
import { writeBankAuditLog } from "@/lib/bank/audit";

export const dynamic = "force-dynamic";

const VALID: BankTransactionClassification[] = [
  "internal_transfer",
  "expense",
  "other_income",
  "ignored",
  "unmatched",
];

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ transactionId: string }> }
) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { transactionId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    classification?: BankTransactionClassification;
    expenseCategory?: BankExpenseCategory | null;
    marketingSubcategory?: BankMarketingSubcategory | null;
    linkedDocumentId?: string | null;
    createVendorRule?: boolean;
    ruleMatchValue?: string | null;
  };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  const classification = body.classification;
  if (!classification || !VALID.includes(classification)) {
    return NextResponse.json({ ok: false, error: "Neplatná klasifikace." }, { status: 400 });
  }

  await bankTransactionsCol(perm.db, organizationId).doc(transactionId).set(
    {
      classification,
      expenseCategory: body.expenseCategory ?? null,
      marketingSubcategory: body.marketingSubcategory ?? null,
      expenseAutoStatus: "confirmed",
      expenseAutoConfidence: 1,
      linkedDocumentId: body.linkedDocumentId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (body.createVendorRule === true && body.expenseCategory) {
    const matchValue = String(body.ruleMatchValue ?? "").trim();
    if (matchValue) {
      await bankExpenseRulesCol(perm.db, organizationId).add({
        organizationId,
        matchKind: "counterparty_contains",
        matchValue,
        expenseCategory: body.expenseCategory,
        marketingSubcategory: body.marketingSubcategory ?? null,
        createdBy: perm.caller.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await writeBankAuditLog(perm.db, {
    organizationId,
    userId: perm.caller.uid,
    action: "BANK_TRANSACTION_CATEGORIZED",
    entityId: transactionId,
    metadata: { classification, expenseCategory: body.expenseCategory ?? null },
  });

  return NextResponse.json({ ok: true });
}
