import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { bankMatchesCol, bankTransactionsCol } from "@/lib/bank/collections";
import { roundMoney2 } from "@/lib/vat-calculations";
import type { BankTransactionClassification } from "@/lib/bank/types";

export async function recomputeTransactionMatchTotals(
  db: Firestore,
  organizationId: string,
  transactionId: string
): Promise<void> {
  const matchesSnap = await bankMatchesCol(db, organizationId)
    .where("transactionId", "==", transactionId)
    .get();

  let total = 0;
  for (const m of matchesSnap.docs) {
    total += roundMoney2(Number(m.data().matchedAmount ?? 0));
  }
  total = roundMoney2(total);

  const txnRef = bankTransactionsCol(db, organizationId).doc(transactionId);
  const txnSnap = await txnRef.get();
  if (!txnSnap.exists) return;

  const txnAmount = Math.abs(roundMoney2(Number(txnSnap.data()?.amount ?? 0)));
  let classification: BankTransactionClassification = "unmatched";
  if (total > 0 && total >= txnAmount - 0.009) classification = "matched";
  else if (total > 0) classification = "unmatched";

  const existingClass = String(txnSnap.data()?.classification ?? "unmatched");
  if (existingClass === "internal_transfer" || existingClass === "ignored" || existingClass === "expense" || existingClass === "other_income") {
    classification = existingClass as BankTransactionClassification;
  }

  let matchStatus: "unmatched" | "review" | "matched" = "unmatched";
  if (classification === "matched") matchStatus = "matched";
  else if (total > 0) matchStatus = "review";

  await txnRef.update({
    matchedAmountTotal: total,
    classification,
    matchStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
