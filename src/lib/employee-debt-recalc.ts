/**
 * Přepočet zůstatku dluhu: remainingAmount = jistina − sum(splátky).
 * Při úplném umoření: status paid/overpaid, paidAt/paidBy na dokumentu dluhu
 * a trvalý řádek v `employee_debt_history` (nesmazatelný audit).
 */

import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
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

function paymentSortMs(data: Record<string, unknown>): number {
  const ds = String(data.date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
    const [y, m, d] = ds.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0).getTime();
  }
  const ca = data.createdAt;
  if (ca && typeof (ca as { toDate?: () => Date }).toDate === "function") {
    try {
      const t = (ca as { toDate: () => Date }).toDate();
      if (t instanceof Date && !Number.isNaN(t.getTime())) return t.getTime();
    } catch {
      /* ignore */
    }
  }
  return 0;
}

export type RecalculateDebtOptions = {
  /** Zobrazené jméno osoby, která uzavřela / přepočítala dluh (volitelné). */
  paidByDisplayName?: string | null;
};

/**
 * Načte dluh + všechny splátky podle debtId a uloží remainingAmount + status + audit.
 * Při přechodu na stav „zcela umořeno“ doplní paidAt/paidBy a zapíše řádek do employee_debt_history.
 */
export async function recalculateDebtAfterPaymentsChange(
  firestore: Firestore,
  companyId: string,
  debtId: string,
  updatedByUid: string,
  options?: RecalculateDebtOptions
): Promise<void> {
  const debtRef = doc(firestore, "companies", companyId, "employee_debts", debtId);
  const debtSnap = await getDoc(debtRef);
  if (!debtSnap.exists()) return;
  const data = debtSnap.data() as Record<string, unknown>;
  const principalRaw =
    typeof data.originalAmount === "number" && Number.isFinite(data.originalAmount)
      ? Number(data.originalAmount)
      : Number(data.amount) || 0;
  const principal = principalRaw;

  const payQ = query(
    collection(firestore, "companies", companyId, "employee_debt_payments"),
    where("debtId", "==", debtId),
    limit(500)
  );
  const paySnap = await getDocs(payQ);
  const paymentRows: { id: string; amount: number; data: Record<string, unknown> }[] = [];
  paySnap.forEach((d) => {
    paymentRows.push({
      id: d.id,
      amount: Number(d.data().amount) || 0,
      data: d.data() as Record<string, unknown>,
    });
  });
  const amounts = paymentRows.map((p) => p.amount);
  const { remainingAmount, status } = computeDebtRemainingFromPayments(principal, amounts);

  const prevRem = Number(data.remainingAmount);
  const hadPositiveBalance = Number.isFinite(prevRem) ? prevRem > 0 : true;
  const nowFullySettled = remainingAmount <= 0;

  const patch: Record<string, unknown> = {
    remainingAmount,
    status,
    updatedAt: serverTimestamp(),
    updatedBy: updatedByUid,
  };

  const isClosed = status === "paid" || status === "overpaid";
  if (isClosed) {
    patch.paidAt = serverTimestamp();
    patch.paidBy = updatedByUid;
    if (options?.paidByDisplayName && String(options.paidByDisplayName).trim()) {
      patch.paidByName = String(options.paidByDisplayName).trim().slice(0, 200);
    }
  } else {
    patch.paidAt = deleteField();
    patch.paidBy = deleteField();
    patch.paidByName = deleteField();
  }

  await updateDoc(debtRef, patch as DocumentData);

  if (hadPositiveBalance && nowFullySettled) {
    const sorted = [...paymentRows].sort(
      (a, b) => paymentSortMs(b.data) - paymentSortMs(a.data)
    );
    const last = sorted[0];
    const settlementMethodRaw = last?.data?.paymentMethod;
    const settlementMethod =
      settlementMethodRaw != null && String(settlementMethodRaw).trim()
        ? String(settlementMethodRaw).trim().slice(0, 120)
        : null;
    const closureNoteRaw = last?.data?.note;
    const closureNote =
      closureNoteRaw != null && String(closureNoteRaw).trim()
        ? String(closureNoteRaw).trim().slice(0, 4000)
        : "";

    await addDoc(collection(firestore, "companies", companyId, "employee_debt_history"), {
      companyId,
      employeeId: String(data.employeeId ?? ""),
      debtId,
      originalAmount: principal,
      debtDate: String(data.date ?? ""),
      debtNote: data.note != null ? String(data.note).slice(0, 4000) : "",
      paidAt: serverTimestamp(),
      paidBy: updatedByUid,
      paidByName:
        options?.paidByDisplayName && String(options.paidByDisplayName).trim()
          ? String(options.paidByDisplayName).trim().slice(0, 200)
          : null,
      closureNote,
      settlementMethod,
      status: status === "overpaid" ? "overpaid" : "paid",
      remainingAfterClose: remainingAmount,
      createdAt: serverTimestamp(),
    });
  }
}

/**
 * Smaže dluh, navázané splátky a auditní řádky historie pro tento debtId (pouze aktivní opravy).
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
  const histQ = query(
    collection(firestore, "companies", companyId, "employee_debt_history"),
    where("debtId", "==", debtId),
    limit(500)
  );
  const histSnap = await getDocs(histQ);
  const debtRef = doc(firestore, "companies", companyId, "employee_debts", debtId);
  const refsToDelete: DocumentReference[] = [];
  paySnap.forEach((d) => refsToDelete.push(d.ref));
  histSnap.forEach((d) => refsToDelete.push(d.ref));
  refsToDelete.push(debtRef);
  let batch = writeBatch(firestore);
  let n = 0;
  for (const ref of refsToDelete) {
    batch.delete(ref);
    n += 1;
    if (n >= 450) {
      await batch.commit();
      batch = writeBatch(firestore);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}
