import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { claimPlatformInvoicePaymentAdmin } from "@/lib/platform-invoice-payment-server";

function canClaimPlatformBilling(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant";
}

/**
 * Oznámení „Zaplatil jsem“ — nastaví paymentClaimed + 48 h lhůtu (neuhrazeno).
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ invoiceId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;
  if (!canClaimPlatformBilling(caller.role)) {
    return NextResponse.json({ error: "Přístup jen pro vlastníka, administrátora nebo účetního." }, { status: 403 });
  }
  const { invoiceId } = await ctx.params;
  const id = String(invoiceId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí invoiceId." }, { status: 400 });

  const result = await claimPlatformInvoicePaymentAdmin({
    db,
    organizationId: caller.companyId,
    invoiceId: id,
    actorUid: caller.uid,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    alreadyClaimed: result.alreadyClaimed,
    gracePeriodUntilIso: result.gracePeriodUntilIso,
  });
}
