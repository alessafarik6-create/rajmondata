import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import { loadExpenseAnalyticsForOrganization } from "@/lib/bank/expense-analytics-load.server";
import { pct } from "@/lib/bank/expense-analytics-aggregate";

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

  const built = await loadExpenseAnalyticsForOrganization(
    perm.db,
    organizationId,
    request.nextUrl.searchParams
  );
  const total = built.summary.netExpenses || built.summary.totalOutgoing;

  return NextResponse.json({
    ok: true,
    summary: built.summary,
    shares: {
      marketing: pct(built.summary.totalMarketing, total),
      googleAds: pct(built.summary.googleAds, total),
      metaAds: pct(built.summary.metaAds, total),
      payroll: pct(built.summary.payroll, total),
      material: pct(built.summary.material, total),
      energy: pct(built.summary.energy, total),
      insurance: pct(built.summary.insurance, total),
      operations: pct(built.summary.operations, total),
      other: pct(built.summary.other, total),
    },
    monthly: built.monthly,
    marketingComparison: built.marketingComparison,
    transactions: built.rows.map((r) => ({
      id: r.id,
      bookingDate: r.bookingDate,
      counterpartyName: r.counterpartyName,
      message: r.message,
      amount: r.amount,
      currency: r.currency,
      effectiveCategory: r.effectiveCategory,
      effectiveCategoryLabel: r.effectiveCategoryLabel,
      marketingSubcategoryLabel: r.marketingSubcategoryLabel,
      effectiveMarketingSubcategory: r.effectiveMarketingSubcategory,
      needsReview: r.needsReview,
      suggestionReason: r.suggestionReason,
      linkedDocumentId: r.linkedDocumentId,
      matchStatus: r.matchStatus,
      classification: r.classification,
      expenseCategory: r.expenseCategory,
      marketingSubcategory: r.marketingSubcategory,
    })),
  });
}
