import { NextRequest, NextResponse } from "next/server";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { bankMatchesCol, bankTransactionsCol } from "@/lib/bank/collections";
import {
  buildPaymentConfirmationDraft,
  isVerifiedCustomerInvoiceEmail,
} from "@/lib/bank/payment-confirmation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: { companyId?: string; transactionId?: string; matchId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const matchId = String(body.matchId ?? "").trim();
  const transactionId = String(body.transactionId ?? "").trim();
  if (!matchId && !transactionId) {
    return NextResponse.json({ ok: false, error: "Chybí matchId nebo transactionId." }, { status: 400 });
  }

  let matchDoc = matchId
    ? await bankMatchesCol(perm.db, organizationId).doc(matchId).get()
    : null;

  if (!matchDoc?.exists && transactionId) {
    const q = await bankMatchesCol(perm.db, organizationId)
      .where("transactionId", "==", transactionId)
      .limit(1)
      .get();
    matchDoc = q.docs[0] ?? null;
  }

  if (!matchDoc?.exists) {
    return NextResponse.json({ ok: false, error: "Spárování nenalezeno." }, { status: 404 });
  }

  const match = matchDoc.data() as Record<string, unknown>;
  const invoiceId = String(match.invoiceId ?? "").trim();
  if (!invoiceId) {
    return NextResponse.json(
      { ok: false, error: "Potvrzení lze odeslat jen u spárované vydané faktury." },
      { status: 400 }
    );
  }

  const txnId = String(match.transactionId ?? transactionId);
  const txnSnap = await bankTransactionsCol(perm.db, organizationId).doc(txnId).get();
  if (!txnSnap.exists) {
    return NextResponse.json({ ok: false, error: "Transakce nenalezena." }, { status: 404 });
  }
  const txn = txnSnap.data() as Record<string, unknown>;

  const invSnap = await perm.db
    .collection("companies")
    .doc(organizationId)
    .collection("invoices")
    .doc(invoiceId)
    .get();
  if (!invSnap.exists) {
    return NextResponse.json({ ok: false, error: "Faktura nenalezena." }, { status: 404 });
  }
  const inv = invSnap.data() as Record<string, unknown>;
  const customerEmail = isVerifiedCustomerInvoiceEmail(inv.customerEmail);
  if (!customerEmail) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Faktura nemá ověřený e-mail zákazníka v CRM. Doplňte e-mail u zákazníka nebo na faktuře.",
      },
      { status: 400 }
    );
  }

  const companySnap = await perm.db.collection("companies").doc(organizationId).get();
  const organizationName = String(
    companySnap.data()?.name ?? companySnap.data()?.companyName ?? ""
  ).trim();

  const matchedAmount = Number(match.matchedAmount ?? 0);
  const txnTotal = Math.abs(Number(txn.amount ?? 0));
  const matchedTotal = Number(txn.matchedAmountTotal ?? matchedAmount);
  const isFullPayment = matchedTotal + 0.02 >= txnTotal;

  const draft = buildPaymentConfirmationDraft({
    organizationName,
    invoiceNumber: String(inv.invoiceNumber ?? invoiceId),
    customerName: String(inv.customerName ?? ""),
    customerEmail,
    amount: matchedAmount,
    currency: String(txn.currency ?? "CZK"),
    paidAtIso: String(txn.bookingDate ?? new Date().toISOString().slice(0, 10)),
    isFullPayment,
  });

  return NextResponse.json({
    ok: true,
    draft,
    matchId: matchDoc.id,
    alreadySent: Boolean(match.paymentConfirmationSentAt),
  });
}
