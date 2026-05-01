/**
 * Evidence délkového materiálu po jednotlivých tyčích / kusech (stockPieces).
 * Délky jsou v milimetrech (remainingLength, originalLength).
 *
 * Bez firebase-admin — bezpečné pro import z klientských komponent.
 */

export const STOCK_PIECE_EMPTY_THRESHOLD_MM = 50;

export type StockPieceStatus = "available" | "partial" | "empty";

export function pieceStatusFromLengths(
  remainingMm: number,
  originalMm: number
): StockPieceStatus {
  if (!Number.isFinite(remainingMm) || remainingMm < STOCK_PIECE_EMPTY_THRESHOLD_MM) {
    return "empty";
  }
  if (Math.abs(remainingMm - originalMm) < 1e-6) return "available";
  return "partial";
}

export type StockPieceForPlan = {
  id: string;
  remainingMm: number;
  originalMm: number;
  status: string;
};

export type PlannedCutChunk = {
  pieceId: string;
  takeMm: number;
  remainingAfterMm: number;
  newStatus: StockPieceStatus;
};

/**
 * Nejdelší dostupné kusy první — stejná logika jako ve výrobě.
 */
export function planLengthAllocation(
  pieces: StockPieceForPlan[],
  needMm: number
): { ok: true; chunks: PlannedCutChunk[] } | { ok: false; error: string } {
  if (!Number.isFinite(needMm) || needMm <= 0) {
    return { ok: false, error: "Požadovaná délka musí být kladné číslo." };
  }
  const usable = pieces
    .filter(
      (p) =>
        (p.status === "available" || p.status === "partial") &&
        Number.isFinite(p.remainingMm) &&
        p.remainingMm >= STOCK_PIECE_EMPTY_THRESHOLD_MM
    )
    .sort((a, b) => b.remainingMm - a.remainingMm);

  let need = needMm;
  const chunks: PlannedCutChunk[] = [];
  for (const p of usable) {
    if (need <= 1e-9) break;
    const take = Math.min(p.remainingMm, need);
    const remAfter = p.remainingMm - take;
    const newStatus = pieceStatusFromLengths(remAfter, p.originalMm);
    chunks.push({
      pieceId: p.id,
      takeMm: take,
      remainingAfterMm: remAfter,
      newStatus,
    });
    need -= take;
  }
  if (need > 1e-6) {
    return { ok: false, error: "Na skladě není dostatek materiálu." };
  }
  return { ok: true, chunks };
}

export function sumUsableRemainingMm(pieces: StockPieceForPlan[]): number {
  return pieces.reduce((s, p) => {
    if (
      (p.status === "available" || p.status === "partial") &&
      Number.isFinite(p.remainingMm) &&
      p.remainingMm >= STOCK_PIECE_EMPTY_THRESHOLD_MM
    ) {
      return s + p.remainingMm;
    }
    return s;
  }, 0);
}

export function countPiecesByStatus(pieces: Iterable<StockPieceForPlan>): {
  full: number;
  partial: number;
  empty: number;
  total: number;
} {
  let full = 0;
  let partial = 0;
  let empty = 0;
  let total = 0;
  for (const p of pieces) {
    total++;
    if (p.status === "available") full++;
    else if (p.status === "partial") partial++;
    else empty++;
  }
  return { full, partial, empty, total };
}
