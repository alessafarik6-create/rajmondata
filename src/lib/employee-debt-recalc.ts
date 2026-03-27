/**
 * Přepočet zůstatku dluhu: remainingAmount = debtAmount - sum(splátky).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

export type DebtStatusComputed = "active" | "paid" | "overpaid";

export function computeDebtRemainingFromPayments(
  debtAmount: number,
  paymentAmounts: number[]
): {
  remainingAmount: number;
  repaidTotal: number;
  status: DebtStatusComputed;
} {
  const repaidTotal =
    Math.round(
      paymentAmounts.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0) * 100
    ) / 100;
  const amt = Number.isFinite(debtAmount) ? debtAmount : 0;
  const remainingAmount = Math.round((amt - repaidTotal) * 100) / 100;
  let status: DebtStatusComputed;
  if (remainingAmount > 0) status = "active";
  else if (remainingAmount < 0) status = "overpaid";
  else status = "paid";
  return { remainingAmount, repaidTotal, status };
}

/**
 * Načte dluh + všechny splátky podle debtId a uloží remainingAmount + status + audit.
 */
export async function recalculateDebtAfterPaymentsChange(
  firestore: Firestore,
  companyId: string,
  debtId: string,
  updatedByUid: string
): Promise<void> {
  const debtRef = doc(firestore, "companies", companyId, "employee_debts", debtId);
  const debtSnap = await getDoc(debtRef);
  if (!debtSnap.exists()) return;
  const debtAmount = Number(debtSnap.data().amount) || 0;
  const payQ = query(
    collection(firestore, "companies", companyId, "employee_debt_payments"),
    where("debtId", "==", debtId),
    limit(500)
  );
  const paySnap = await getDocs(payQ);
  const amounts: number[] = [];
  paySnap.forEach((d) => amounts.push(Number(d.data().amount) || 0));
  const { remainingAmount, status } = computeDebtRemainingFromPayments(debtAmount, amounts);
  await updateDoc(debtRef, {
    remainingAmount,
    status,
    updatedAt: serverTimestamp(),
    updatedBy: updatedByUid,
  });
}

/**
 * Smaže dluh a všechny navázané splátky (žádné osiřelé záznamy).
 */
export async function deleteDebtAndAllPayments(
  firestore: Firestore,
  companyId: string,
  debtId: string
): Promise<void> {
  const payQ = query(
    collection(firestore, "companies", companyId, "employee_debt_payments"),
    where("debtId", "==", debtId),
    limit(500)
  );
  const paySnap = await getDocs(payQ);
  const debtRef = doc(firestore, "companies", companyId, "employee_debts", debtId);
  let batch = writeBatch(firestore);
  let n = 0;
  paySnap.forEach((d) => {
    batch.delete(d.ref);
    n += 1;
    if (n >= 450) {
      throw new Error("Příliš mnoho splátek — kontaktujte administrátora.");
    }
  });
  batch.delete(debtRef);
  await batch.commit();
}
