import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { bankTransactionsCol } from "@/lib/bank/collections";
import { suggestBankTransactionMatches } from "@/lib/bank/matching";
import type { BankSuggestedMatch } from "@/lib/bank/types";

function toStored(s: import("@/lib/bank/types").BankMatchSuggestion): BankSuggestedMatch {
  return {
    targetKind: s.targetKind,
    targetId: s.targetId,
    label: s.label,
    variableSymbol: s.variableSymbol ?? null,
    amount: s.amount,
    currency: s.currency,
    confidence: s.confidence,
    reasons: s.reasons,
  };
}

export async function refreshSuggestedMatchesForOrganization(
  db: Firestore,
  organizationId: string,
  limit = 80
): Promise<number> {
  const todayIso = new Date().toISOString().split("T")[0];
  const invSnap = await db
    .collection("companies")
    .doc(organizationId)
    .collection("invoices")
    .limit(300)
    .get();
  const issuedInvoices = invSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
  }));

  const docSnap = await db
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

  const txSnap = await bankTransactionsCol(db, organizationId)
    .where("classification", "==", "unmatched")
    .orderBy("bookingDate", "desc")
    .limit(limit)
    .get()
    .catch(() => null);

  if (!txSnap) return 0;

  let updated = 0;
  const now = new Date().toISOString();

  for (const tDoc of txSnap.docs) {
    const t = tDoc.data();
    if (Number(t.matchedAmountTotal ?? 0) > 0) continue;

    const suggestions = suggestBankTransactionMatches(
      {
        direction: t.direction as "incoming" | "outgoing",
        amount: Number(t.amount),
        currency: String(t.currency ?? "CZK"),
        variableSymbol: t.variableSymbol as string | null,
        counterpartyName: t.counterpartyName as string | null,
        counterpartyAccount: t.counterpartyAccount as string | null,
        bookingDate: String(t.bookingDate),
      },
      { todayIso, issuedInvoices, receivedDocuments }
    );

    const stored = suggestions.slice(0, 8).map(toStored);
    await tDoc.ref.set(
      {
        suggestedMatches: stored,
        suggestedMatchesAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    updated += 1;
  }

  return updated;
}
