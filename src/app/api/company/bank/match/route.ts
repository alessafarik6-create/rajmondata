import { NextRequest, NextResponse } from "next/server";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { applyBankTransactionMatch } from "@/lib/bank/apply-match";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    transactionId?: string;
    matchedAmount?: number;
    issuedInvoiceId?: string;
    receivedDocumentId?: string;
    matchType?: "auto" | "manual" | "confirmed_auto";
    confidence?: number;
  };
  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  if (body.matchType === "auto") {
    return NextResponse.json(
      { ok: false, error: "Automatické párování bez potvrzení není povoleno." },
      { status: 400 }
    );
  }

  try {
    const result = await applyBankTransactionMatch(perm.db, {
      organizationId,
      transactionId: String(body.transactionId ?? ""),
      userId: perm.caller.uid,
      matchedAmount: Number(body.matchedAmount),
      matchType: body.matchType === "confirmed_auto" ? "confirmed_auto" : "manual",
      confidence: body.confidence ?? null,
      issuedInvoiceId: body.issuedInvoiceId ?? null,
      receivedDocumentId: body.receivedDocumentId ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Párování selhalo.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
