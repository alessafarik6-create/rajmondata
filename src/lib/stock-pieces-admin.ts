import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { STOCK_PIECE_EMPTY_THRESHOLD_MM } from "@/lib/stock-pieces";

/**
 * Reference dokumentů stockPieces seřazené podle zbývající délky (nejdelší první).
 * Použije se před `runTransaction` — uvnitř transakce se dokumenty znovu načtou.
 */
export async function getOrderedStockPieceRefsForIssue(
  db: Firestore,
  companyId: string,
  itemId: string
): Promise<DocumentReference[]> {
  const col = db
    .collection("companies")
    .doc(companyId)
    .collection("inventoryItems")
    .doc(itemId)
    .collection("stockPieces");
  const snap = await col.limit(500).get();
  const docs = snap.docs.filter((d) => {
    const x = d.data();
    const st = String(x.status || "");
    const rem = Number(x.remainingLength);
    return (
      (st === "available" || st === "partial") &&
      Number.isFinite(rem) &&
      rem >= STOCK_PIECE_EMPTY_THRESHOLD_MM
    );
  });
  docs.sort((a, b) => Number(b.data().remainingLength) - Number(a.data().remainingLength));
  return docs.map((d) => d.ref);
}
