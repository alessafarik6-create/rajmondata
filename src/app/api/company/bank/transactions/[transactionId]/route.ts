import { NextRequest, NextResponse } from "next/server";
import { requireBankRead, bankTenantOk } from "@/lib/bank/api-auth";
import {
  bankAccountsCol,
  bankMatchesCol,
  bankTransactionsCol,
} from "@/lib/bank/collections";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ transactionId: string }> }
) {
  const perm = await requireBankRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const { transactionId } = await ctx.params;
  const organizationId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const txnSnap = await bankTransactionsCol(perm.db, organizationId).doc(transactionId).get();
  if (!txnSnap.exists) {
    return NextResponse.json({ ok: false, error: "Transakce nenalezena." }, { status: 404 });
  }
  const t = txnSnap.data() as import("@/lib/bank/types").BankTransactionDoc;
  if (String(t.organizationId) !== organizationId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const accSnap = await bankAccountsCol(perm.db, organizationId).doc(String(t.accountId)).get();
  const acc = accSnap.exists ? (accSnap.data() as Record<string, unknown>) : null;

  const matchSnap = await bankMatchesCol(perm.db, organizationId)
    .where("transactionId", "==", transactionId)
    .get();
  const matches = matchSnap.docs.map((m) => ({
    id: m.id,
    ...(m.data() as Record<string, unknown>),
  })) as Array<
    Record<string, unknown> & {
      id: string;
      invoiceId?: string | null;
      documentId?: string | null;
      matchedAmount?: number;
    }
  >;

  const labels = new Map<string, string>();
  for (const m of matches) {
    const invId = String(m.invoiceId ?? "").trim();
    const docId = String(m.documentId ?? "").trim();
    if (invId) {
      const inv = await perm.db
        .collection("companies")
        .doc(organizationId)
        .collection("invoices")
        .doc(invId)
        .get();
      if (inv.exists) {
        const d = inv.data() as Record<string, unknown>;
        labels.set(`inv:${invId}`, String(d.invoiceNumber ?? d.documentNumber ?? invId));
      }
    }
    if (docId) {
      const doc = await perm.db
        .collection("companies")
        .doc(organizationId)
        .collection("documents")
        .doc(docId)
        .get();
      if (doc.exists) {
        const d = doc.data() as Record<string, unknown>;
        labels.set(`doc:${docId}`, String(d.documentNumber ?? d.title ?? docId));
      }
    }
  }

  const historySnap = await perm.db
    .collection("companies")
    .doc(organizationId)
    .collection("activityLogs")
    .where("entityId", "==", transactionId)
    .limit(40)
    .get()
    .catch(() => null);

  const toIso = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === "string") return v;
    if (typeof (v as { toDate?: () => Date }).toDate === "function") {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    return null;
  };

  const history = (historySnap?.docs ?? [])
    .map((d) => {
      const row = d.data() as Record<string, unknown>;
      const createdAt = toIso(row.createdAt);
      return {
        id: d.id,
        actionType: row.actionType,
        actionLabel: row.actionLabel,
        userId: row.userId,
        createdAt,
        metadata: row.metadata ?? null,
        _sort: createdAt ? Date.parse(createdAt) : 0,
      };
    })
    .sort((a, b) => b._sort - a._sort)
    .map(({ _sort, ...rest }) => rest);

  return NextResponse.json({
    ok: true,
    transaction: {
      id: txnSnap.id,
      accountId: t.accountId,
      accountLabel: acc?.name ?? acc?.accountNumber ?? t.accountId,
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
      message: t.message,
      reference: t.reference,
      externalTransactionId: t.externalTransactionId,
      classification: t.classification,
      matchStatus: t.matchStatus,
      matchedAmountTotal: t.matchedAmountTotal ?? 0,
      note: t.note ?? "",
      noteUpdatedAt: t.noteUpdatedAt,
      noteUpdatedByUserId: t.noteUpdatedByUserId,
      suggestedMatches: t.suggestedMatches ?? [],
      suggestedMatchesAt: t.suggestedMatchesAt,
      matches: matches.map((m) => ({
        ...m,
        targetLabel:
          m.invoiceId
            ? labels.get(`inv:${String(m.invoiceId)}`) ?? String(m.invoiceId)
            : m.documentId
              ? labels.get(`doc:${String(m.documentId)}`) ?? String(m.documentId)
              : null,
      })),
    },
    history,
  });
}
