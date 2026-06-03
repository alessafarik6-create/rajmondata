import {
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

/**
 * Atomicky alokuje číslo předávacího protokolu (PP-YYYY-NNNN).
 * companies/{companyId}/settings/handoverProtocolCounter
 */
export async function allocateNextHandoverProtocolNumber(
  firestore: Firestore,
  companyId: string
): Promise<string> {
  const ref = doc(
    firestore,
    "companies",
    companyId,
    "settings",
    "handoverProtocolCounter"
  );
  const year = new Date().getFullYear();
  const next = await runTransaction(firestore, async (transaction) => {
    const snap = await transaction.get(ref);
    let seq = 1;
    if (snap.exists()) {
      const data = snap.data() as { year?: number; seq?: number };
      if (data.year === year && typeof data.seq === "number") {
        seq = data.seq + 1;
      }
    }
    transaction.set(ref, { year, seq, updatedAt: serverTimestamp() });
    return seq;
  });
  return `PP-${year}-${String(next).padStart(4, "0")}`;
}
