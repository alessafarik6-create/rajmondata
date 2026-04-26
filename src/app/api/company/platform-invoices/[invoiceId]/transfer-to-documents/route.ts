import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { getAdminStorageBucket } from "@/lib/firebase-admin";
import { transferPlatformInvoiceToCompanyDocuments } from "@/lib/platform-invoice-transfer-documents";

function canManagePlatformBilling(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant";
}

/**
 * Přenese PDF platformní faktury do firemních dokladů (bez duplicit podle sourceInvoiceId).
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ invoiceId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canManagePlatformBilling(v.caller.role)) {
    return NextResponse.json(
      { error: "Přístup jen pro vlastníka, administrátora nebo účetního." },
      { status: 403 }
    );
  }
  const { invoiceId } = await ctx.params;
  const id = String(invoiceId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí invoiceId." }, { status: 400 });
  const bucket = getAdminStorageBucket();
  if (!bucket) {
    return NextResponse.json({ error: "Firebase Storage není nakonfigurován." }, { status: 503 });
  }
  const result = await transferPlatformInvoiceToCompanyDocuments({
    db: v.db,
    bucket,
    organizationId: v.caller.companyId,
    invoiceId: id,
    actorUid: v.caller.uid,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    documentId: result.documentId,
    alreadyTransferred: result.alreadyTransferred,
  });
}
