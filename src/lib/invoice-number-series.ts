/**
 * Jednoznačné číslování dokladů podle řady (prefix + rok + pořadové číslo).
 * Ukládá se do companies/{companyId}/settings/documentCounters
 */

import type { Firestore } from "firebase/firestore";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

export type InvoiceSeriesKey = "ZF" | "DD" | "FV" | "FA";

const COUNTERS_DOC = "documentCounters";

function fieldKey(series: InvoiceSeriesKey, year: number): string {
  return `${series}_${year}`;
}

/**
 * Přidělí další číslo v řadě, např. ZF-2026-001.
 * Atomicky přes transakci — bez kolizí při paralelních požadavcích.
 */
export async function allocateNextDocumentNumber(
  firestore: Firestore,
  companyId: string,
  series: InvoiceSeriesKey
): Promise<string> {
  const y = new Date().getFullYear();
  const key = fieldKey(series, y);
  const ref = doc(
    firestore,
    "companies",
    companyId,
    "settings",
    COUNTERS_DOC
  );

  const next = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
    const cur = Number(data[key]) || 0;
    const n = cur + 1;
    tx.set(
      ref,
      {
        [key]: n,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return n;
  });

  return `${series}-${y}-${String(next).padStart(3, "0")}`;
}
