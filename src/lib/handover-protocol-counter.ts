import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export async function allocateHandoverProtocolNumber(
  db: Firestore,
  companyId: string
): Promise<string> {
  const year = new Date().getFullYear();
  const settingsRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("settings")
    .doc("handoverProtocolCounter");

  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(settingsRef);
    const data = (snap.data() ?? {}) as { year?: number; seq?: number };
    let seq = typeof data.seq === "number" ? data.seq : 0;
    let y = typeof data.year === "number" ? data.year : year;
    if (y !== year) {
      y = year;
      seq = 0;
    }
    seq += 1;
    tx.set(
      settingsRef,
      { year: y, seq, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return seq;
  });

  return `PP-${year}-${String(next).padStart(4, "0")}`;
}
