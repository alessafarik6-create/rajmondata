/**
 * Součet nákladů zakázky z podsložky `jobs/{jobId}/expenses` (klientské čtení Firestore).
 */

import type { Firestore } from "firebase/firestore";
import { collection, getDocs } from "firebase/firestore";
import { resolveExpenseAmounts, roundMoney2 } from "@/lib/vat-calculations";

export async function sumJobExpensesFromFirestore(
  firestore: Firestore,
  companyId: string,
  jobId: string
): Promise<{ net: number; gross: number }> {
  let net = 0;
  let gross = 0;
  const snap = await getDocs(
    collection(firestore, "companies", companyId, "jobs", jobId, "expenses")
  );
  snap.forEach((d) => {
    const r = resolveExpenseAmounts(d.data() as Record<string, unknown>);
    net += r.amountNet;
    gross += r.amountGross;
  });
  return { net: roundMoney2(net), gross: roundMoney2(gross) };
}
