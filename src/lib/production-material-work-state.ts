/**
 * Mutable pracovní stav skladu pro výdej (READ → CALCULATE → WRITE).
 */
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
  Transaction,
  UpdateData,
} from "firebase-admin/firestore";
import {
  STOCK_PIECE_EMPTY_THRESHOLD_MM,
  type StockPieceForPlan,
  type StockPieceStatus,
} from "@/lib/stock-pieces";

export type IssueWriteOp =
  | { kind: "update"; ref: DocumentReference; data: UpdateData<DocumentData> }
  | { kind: "set"; ref: DocumentReference; data: Record<string, unknown> };

export function applyIssueOps(tx: Transaction, ops: IssueWriteOp[]): void {
  for (const op of ops) {
    if (op.kind === "update") tx.update(op.ref, op.data);
    else tx.set(op.ref, op.data);
  }
}

export function filterSortStockPieceQueryDocsAdmin(
  docs: QueryDocumentSnapshot[]
): QueryDocumentSnapshot[] {
  const filtered = docs.filter((d) => {
    const x = d.data();
    const st = String(x.status || "");
    const rem = Number(x.remainingLength);
    return (
      (st === "available" || st === "partial") &&
      Number.isFinite(rem) &&
      rem >= STOCK_PIECE_EMPTY_THRESHOLD_MM
    );
  });
  filtered.sort((a, b) => Number(b.data().remainingLength) - Number(a.data().remainingLength));
  return filtered;
}

export type MaterialIssueInTxOptions = {
  stockPieceRefs?: DocumentReference[];
};

export type MaterialIssueInTxParams = {
  itemId: string;
  quantity: number;
  inputLengthUnit: "mm" | "cm" | "m" | null;
  note: string;
  batchNumber: string;
  repeatCount?: number;
  consumptionExtras?: Record<string, unknown>;
};

export type MaterialIssueInTxContext = {
  db: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  callerUid: string;
  callerEmployeeId: string | null;
  createdByName: string;
};

export type MaterialIssueCutAllocation = {
  pieceId: string;
  usedLengthMm: number;
  remainingAfterMm: number;
};

export type MaterialIssueInTxResult = {
  movementId: string;
  consumptionId: string;
  remainderItemId: string | null;
  unit: string;
  quantityAfter: number;
  cutIds?: string[];
  allocations?: MaterialIssueCutAllocation[];
};

type ItemRow = { ref: DocumentReference; data: Record<string, unknown> };
type PieceRow = { ref: DocumentReference; itemId: string; plan: StockPieceForPlan };

export function pieceDocToPlan(
  pieceId: string,
  data: Record<string, unknown> | undefined,
  materialId: string
): StockPieceForPlan | null {
  if (!data) return null;
  if (String(data.materialId || "") !== materialId) return null;
  const rem = Number(data.remainingLength);
  const orig = Number(data.originalLength ?? rem);
  const st = String(data.status || "available");
  if (!Number.isFinite(rem) || !Number.isFinite(orig)) return null;
  return { id: pieceId, remainingMm: rem, originalMm: orig, status: st };
}

export class BulkMaterialWorkState {
  items = new Map<string, ItemRow>();
  pieces = new Map<string, PieceRow>();

  seedItem(itemId: string, ref: DocumentReference, snap: DocumentSnapshot) {
    if (!snap.exists) throw new Error("Skladová položka neexistuje.");
    this.items.set(itemId, {
      ref,
      data: JSON.parse(JSON.stringify(snap.data())) as Record<string, unknown>,
    });
  }

  seedPieceFromDoc(pieceId: string, itemId: string, ref: DocumentReference, snap: DocumentSnapshot) {
    if (!snap.exists) return;
    const p = pieceDocToPlan(pieceId, snap.data() as Record<string, unknown>, itemId);
    if (p) this.pieces.set(pieceId, { ref, itemId, plan: p });
  }

  getItemData(itemId: string): Record<string, unknown> {
    const row = this.items.get(itemId);
    if (!row) throw new Error("Interní chyba: položka ve stavu výdeje chybí.");
    return row.data;
  }

  itemRef(itemId: string): DocumentReference {
    const row = this.items.get(itemId);
    if (!row) throw new Error("Interní chyba: položka ve stavu výdeje chybí.");
    return row.ref;
  }

  getPiecesForPlan(itemId: string, options?: MaterialIssueInTxOptions): StockPieceForPlan[] {
    if (options?.stockPieceRefs?.length) {
      const out: StockPieceForPlan[] = [];
      for (const r of options.stockPieceRefs) {
        const row = this.pieces.get(r.id);
        if (row && row.itemId === itemId) out.push({ ...row.plan });
      }
      return out;
    }
    return [...this.pieces.values()]
      .filter((x) => x.itemId === itemId)
      .map((x) => ({ ...x.plan }));
  }

  applyPieceChunk(pieceId: string, remainingAfterMm: number, newStatus: StockPieceStatus) {
    const row = this.pieces.get(pieceId);
    if (!row) return;
    row.plan.remainingMm = remainingAfterMm;
    row.plan.status = newStatus;
  }

  patchItem(itemId: string, patch: Record<string, unknown>) {
    const row = this.items.get(itemId);
    if (!row) return;
    Object.assign(row.data, patch);
  }
}

export function materialShortageError(item: Record<string, unknown>, itemId: string): Error {
  const name = String(item.name || itemId).trim() || itemId;
  return new Error(`Nedostatek materiálu: ${name}`);
}
