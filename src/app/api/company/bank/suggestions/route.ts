import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import { bankTransactionsCol } from "@/lib/bank/collections";
import { suggestBankTransactionMatches } from "@/lib/bank/matching";

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
  const transactionId = String(request.nextUrl.searchParams.get("transactionId") ?? "").trim();
  if (!transactionId) {
    return NextResponse.json({ ok: false, error: "Chybí transactionId." }, { status: 400 });
  }

  const txnSnap = await bankTransactionsCol(perm.db, organizationId).doc(transactionId).get();
  if (!txnSnap.exists) {
    return NextResponse.json({ ok: false, error: "Transakce nenalezena." }, { status: 404 });
  }
  const txn = txnSnap.data() as Record<string, unknown>;
  const todayIso = new Date().toISOString().split("T")[0];

  const invSnap = await perm.db
    .collection("companies")
    .doc(organizationId)
    .collection("invoices")
    .limit(300)
    .get();
  const issuedInvoices = invSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
    invoiceNumber: d.data().invoiceNumber ?? d.data().documentNumber,
  }));

  const docSnap = await perm.db
    .collection("companies")
    .doc(organizationId)
    .collection("documents")
    .limit(300)
    .get();
  const receivedDocuments = docSnap.docs
    .filter((d) => {
      const t = String(d.data().type ?? "").toLowerCase();
      const k = String(d.data().documentKind ?? "").toLowerCase();
      return t === "received" || k === "prijate";
    })
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

  const suggestions = suggestBankTransactionMatches(
    {
      direction: txn.direction as "incoming" | "outgoing",
      amount: Number(txn.amount),
      currency: String(txn.currency ?? "CZK"),
      variableSymbol: txn.variableSymbol as string | null,
      counterpartyName: txn.counterpartyName as string | null,
      counterpartyAccount: txn.counterpartyAccount as string | null,
      bookingDate: String(txn.bookingDate),
    },
    { todayIso, issuedInvoices, receivedDocuments }
  );

  return NextResponse.json({ ok: true, suggestions });
}
