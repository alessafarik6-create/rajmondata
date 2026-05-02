/**
 * Zobrazení souhrnu a řazení kusů délkového materiálu (stockPieces) ve skladu.
 */

import { STOCK_PIECE_EMPTY_THRESHOLD_MM } from "@/lib/stock-pieces";
import type { InventoryItemRow, StockPieceRow } from "@/lib/inventory-types";

export const STOCK_DISPLAY_EPS_MM = 0.05;

export type StockPieceUiKind = "plný" | "načatý" | "zbytek" | "spotřebovaný";

/** Stav kusu pro UI — viz zadání (4 typy). */
export function pieceUiKind(
  remainingMm: number,
  originalMm: number,
  status: string
): StockPieceUiKind {
  const rem = Number(remainingMm);
  const orig = Number(originalMm);
  if (!Number.isFinite(rem) || !Number.isFinite(orig)) return "spotřebovaný";
  if (rem <= 0 || status === "empty") return "spotřebovaný";
  if (Math.abs(rem - orig) <= STOCK_DISPLAY_EPS_MM) return "plný";
  if (rem < STOCK_PIECE_EMPTY_THRESHOLD_MM) return "zbytek";
  if (rem < orig - STOCK_DISPLAY_EPS_MM) return "načatý";
  return "plný";
}

/** Počty přesně dle zadání (bod 3). */
export function countPiecesExact(
  pieces: Pick<StockPieceRow, "remainingLength" | "originalLength" | "status">[]
): { full: number; partial: number; consumed: number } {
  let full = 0;
  let partial = 0;
  let consumed = 0;
  for (const p of pieces) {
    const rem = Number(p.remainingLength);
    const orig = Number(p.originalLength);
    const st = String(p.status || "");
    if (!Number.isFinite(rem) || !Number.isFinite(orig)) {
      consumed++;
      continue;
    }
    if (rem <= 0 || st === "empty") {
      consumed++;
      continue;
    }
    if (Math.abs(rem - orig) <= STOCK_DISPLAY_EPS_MM) full++;
    else if (rem > 0 && rem < orig - STOCK_DISPLAY_EPS_MM) partial++;
    else full++;
  }
  return { full, partial, consumed };
}

export type StockPieceWithSort = StockPieceRow & {
  _ui: StockPieceUiKind;
  _sortGroup: number;
};

/**
 * Řazení: načaté (nejdelší zbytek) → plné → zbytek (krátký) → spotřebované dole.
 */
export function sortStockPiecesForDisplay(pieces: StockPieceRow[]): StockPieceWithSort[] {
  const withMeta = pieces.map((p) => {
    const rem = Number(p.remainingLength);
    const orig = Number(p.originalLength);
    const ui = pieceUiKind(rem, orig, String(p.status || ""));
    let sortGroup = 3;
    if (ui === "načatý") sortGroup = 0;
    else if (ui === "zbytek") sortGroup = 1;
    else if (ui === "plný") sortGroup = 2;
    else sortGroup = 4;
    return { ...p, _ui: ui, _sortGroup: sortGroup };
  });
  return withMeta.sort((a, b) => {
    if (a._sortGroup !== b._sortGroup) return a._sortGroup - b._sortGroup;
    const ra = Number(a.remainingLength);
    const rb = Number(b.remainingLength);
    if (a._sortGroup === 0 || a._sortGroup === 2) return rb - ra;
    return ra - rb;
  });
}

export function formatMmCs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("cs-CZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function isInventoryPiecesLengthRow(row: InventoryItemRow): boolean {
  const unitMm = String(row.unit || "")
    .trim()
    .toLowerCase() === "mm";
  if (!unitMm || String(row.stockTrackingMode) !== "length") return false;
  const sm = String(row.stockMode || "").trim();
  const legacy = !row.stockMode && (row.stockPieceStats?.total ?? 0) > 0;
  return sm === "piecesLength" || legacy;
}

/** Délky načatých kusů (pro víceřádkový souhrn). */
export function partialRemainderLengthsMm(pieces: StockPieceRow[]): number[] {
  const out: number[] = [];
  for (const p of pieces) {
    const rem = Number(p.remainingLength);
    const orig = Number(p.originalLength);
    const st = String(p.status || "");
    if (rem <= 0 || st === "empty") continue;
    if (Math.abs(rem - orig) <= STOCK_DISPLAY_EPS_MM) continue;
    if (rem > 0 && rem < orig - STOCK_DISPLAY_EPS_MM) out.push(rem);
  }
  return out.sort((a, b) => b - a);
}
