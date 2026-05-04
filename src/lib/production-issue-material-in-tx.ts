/**
 * Jednotný zápis výdeje materiálu na zakázku uvnitř Firestore transakce (Admin SDK).
 * READ → CALCULATE (plan) → WRITE (applyIssueOps).
 */
import type { Transaction } from "firebase-admin/firestore";
import { planMaterialIssueWritesFromState } from "@/lib/production-material-issue-plan-writes";
import {
  applyIssueOps,
  BulkMaterialWorkState,
  filterSortStockPieceQueryDocsAdmin,
  type IssueWriteOp,
  type MaterialIssueInTxContext,
  type MaterialIssueInTxOptions,
  type MaterialIssueInTxParams,
  type MaterialIssueInTxResult,
} from "@/lib/production-material-work-state";

export type {
  IssueWriteOp,
  MaterialIssueCutAllocation,
  MaterialIssueInTxContext,
  MaterialIssueInTxOptions,
  MaterialIssueInTxParams,
  MaterialIssueInTxResult,
} from "@/lib/production-material-work-state";

export { applyIssueOps, BulkMaterialWorkState };

/**
 * Jeden výdej: všechny read na začátku, potom pouze CALCULATE + WRITE.
 */
export async function executeMaterialIssueInAdminTransaction(
  tx: Transaction,
  ctx: MaterialIssueInTxContext,
  input: MaterialIssueInTxParams,
  options?: MaterialIssueInTxOptions
): Promise<MaterialIssueInTxResult> {
  const { db, companyId } = ctx;
  const { itemId } = input;
  const itemRef = db.collection("companies").doc(companyId).collection("inventoryItems").doc(itemId);
  const itemSnap = await tx.get(itemRef);
  const state = new BulkMaterialWorkState();
  state.seedItem(itemId, itemRef, itemSnap);

  const item = state.getItemData(itemId);
  const unit = String(item.unit || "ks").trim() || "ks";
  const m = String(item.stockTrackingMode || "").trim();
  if (m === "length" && options?.stockPieceRefs?.length) {
    const pieceSnaps = await Promise.all(options.stockPieceRefs.map((r) => tx.get(r)));
    for (const ps of pieceSnaps) {
      state.seedPieceFromDoc(ps.id, itemId, ps.ref, ps);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[material-issue-tx] READ done (single)", {
      itemId,
      stockMode: m || unit,
      pieceCount: options?.stockPieceRefs?.length ?? 0,
    });
  }

  const { result, ops } = planMaterialIssueWritesFromState(state, ctx, input, options, db);

  if (process.env.NODE_ENV !== "production") {
    console.log("[material-issue-tx] CALCULATE done (single)", { itemId, opCount: ops.length });
    console.log("[material-issue-tx] WRITE start (single)", { opCount: ops.length });
  }

  applyIssueOps(tx, ops);
  return result;
}

/**
 * Hromadný výdej: nejdřív všechny READ (položky + dotazy na stockPieces), pak CALCULATE řádků, nakonec WRITE.
 */
export async function executeBulkMaterialIssueInAdminTransaction(
  tx: Transaction,
  ctx: MaterialIssueInTxContext,
  lines: MaterialIssueInTxParams[],
  debugLabel?: string
): Promise<MaterialIssueInTxResult[]> {
  const { db, companyId } = ctx;
  const uniqueIds = [...new Set(lines.map((l) => l.itemId))];

  const itemRefs = uniqueIds.map((id) =>
    db.collection("companies").doc(companyId).collection("inventoryItems").doc(id)
  );
  const itemSnaps = await Promise.all(itemRefs.map((r) => tx.get(r)));

  const state = new BulkMaterialWorkState();
  for (let i = 0; i < uniqueIds.length; i++) {
    state.seedItem(uniqueIds[i], itemRefs[i], itemSnaps[i]);
  }

  for (const itemId of uniqueIds) {
    const row = state.getItemData(itemId);
    const unit = String(row.unit || "ks").trim() || "ks";
    const modeRaw = String(row.stockTrackingMode || "").trim();
    const mode =
      modeRaw === "length" || modeRaw === "area" || modeRaw === "mass" || modeRaw === "generic" || modeRaw === "pieces"
        ? modeRaw
        : "pieces";
    if (mode !== "length") continue;

    const col = db
      .collection("companies")
      .doc(companyId)
      .collection("inventoryItems")
      .doc(itemId)
      .collection("stockPieces");
    const qSnap = await tx.get(col.limit(500));
    const sorted = filterSortStockPieceQueryDocsAdmin(qSnap.docs);
    for (const d of sorted) {
      state.seedPieceFromDoc(d.id, itemId, d.ref, d);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[material-issue-tx] READ done${debugLabel ? ` ${debugLabel}` : ""}`, {
      itemIds: uniqueIds.length,
      lines: lines.length,
    });
  }

  const allOps: IssueWriteOp[] = [];
  const results: MaterialIssueInTxResult[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { result, ops } = planMaterialIssueWritesFromState(state, ctx, line, undefined, db);
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[material-issue-tx] CALCULATE done line ${i + 1}/${lines.length}${debugLabel ? ` ${debugLabel}` : ""}`,
        { itemId: line.itemId, opCount: ops.length }
      );
    }
    results.push(result);
    allOps.push(...ops);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[material-issue-tx] WRITE start${debugLabel ? ` ${debugLabel}` : ""}`, {
      opCount: allOps.length,
    });
  }

  applyIssueOps(tx, allOps);
  return results;
}
