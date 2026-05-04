import { lengthToMillimeters, millimetersToUnit } from "@/lib/job-production-settings";
import type { InventoryItemRow, StockPieceRow } from "@/lib/inventory-types";
import { STOCK_DISPLAY_EPS_MM, countPiecesExact, formatMmCs } from "@/lib/stock-pieces-display";
import type { StockPiecesSummary } from "@/hooks/use-stock-pieces-summaries";

/** Minimální data řádku fronty výdeje pro export A4 (shodné s IssueQueueLine na stránce výroby). */
export type IssueLineForA4Material = {
  key: string;
  itemId: string;
  qtyStr: string;
  repeatCountStr: string;
  note: string;
  batchNumber: string;
  inputLengthUnit: "mm" | "cm" | "m" | null;
  productionDrawingKey?: string | null;
};

export type ProductionA4MaterialRow = {
  cells: string[];
  /** Legacy pole pro PDF styler */
  boldRemainder: boolean;
  boldLineTotal: boolean;
  /** Oranžové zvýraznění — doporučení „Použít zbytek“ */
  highlightUseScrap?: boolean;
};

function stockUnitLower(item: InventoryItemRow): string {
  return String(item.lengthStockUnit || item.unit || "mm")
    .trim()
    .toLowerCase();
}

function effectiveInputLengthUnit(item: InventoryItemRow, ln: IssueLineForA4Material): "mm" | "cm" | "m" | null {
  if (String(item.stockTrackingMode) !== "length") return null;
  if (ln.inputLengthUnit) return ln.inputLengthUnit;
  const u = stockUnitLower(item);
  if (u === "mm" || u === "cm" || u === "m") return u;
  return "mm";
}

function quantityInStockUnitsForExport(item: InventoryItemRow, qtyInput: number, ln: IssueLineForA4Material): number | null {
  const mode = String(item.stockTrackingMode || "pieces");
  const input = effectiveInputLengthUnit(item, ln);
  if (mode !== "length" || !input) return qtyInput;
  const mm = lengthToMillimeters(qtyInput, input);
  if (mm == null) return null;
  return millimetersToUnit(mm, stockUnitLower(item));
}

/**
 * Rozdělí opakované řezy po „standardních“ kusech délky P mm (plné tyče).
 * Každý výstupní řádek = jeden fyzický kus po řezu.
 */
export function splitLengthCutsAcrossStandardPieces(
  pieceLenMm: number,
  cutLenMm: number,
  repeatCuts: number
): { cutsOnThisPiece: number; remainderMm: number }[] {
  const P = pieceLenMm;
  const C = cutLenMm;
  const rep = Math.floor(repeatCuts);
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(C) || C <= 0 || !Number.isFinite(rep) || rep < 1) {
    return [];
  }
  let cutsLeft = rep;
  const rows: { cutsOnThisPiece: number; remainderMm: number }[] = [];
  const maxCutsOneBar = Math.floor((P + STOCK_DISPLAY_EPS_MM) / C);

  if (maxCutsOneBar < 1) {
    for (let i = 0; i < cutsLeft; i++) {
      rows.push({ cutsOnThisPiece: 1, remainderMm: Math.max(0, P - C) });
    }
    return rows;
  }

  while (cutsLeft > 0) {
    const n = Math.min(cutsLeft, maxCutsOneBar);
    const usedMm = n * C;
    const rem = Math.max(0, P - usedMm);
    rows.push({ cutsOnThisPiece: n, remainderMm: rem });
    cutsLeft -= n;
  }
  return rows;
}

function perCutLengthMm(item: InventoryItemRow, ln: IssueLineForA4Material): number | null {
  const q = Number(String(ln.qtyStr).replace(",", "."));
  if (!Number.isFinite(q) || q <= 0) return null;
  const stockU = stockUnitLower(item);
  const conv = quantityInStockUnitsForExport(item, q, ln);
  if (conv == null || !Number.isFinite(conv)) return null;
  const mm = lengthToMillimeters(conv, stockU === "cm" ? "cm" : stockU === "m" ? "m" : "mm");
  return mm != null && Number.isFinite(mm) ? mm : null;
}

function sumRemainingStockMm(pieces: StockPieceRow[]): number {
  let s = 0;
  for (const p of pieces) {
    const rem = Number(p.remainingLength);
    if (!Number.isFinite(rem) || rem <= 0) continue;
    if (String(p.status) === "empty") continue;
    s += rem;
  }
  return s;
}

function stockAvailablePiecesCount(pieces: StockPieceRow[]): number {
  const c = countPiecesExact(pieces);
  return c.full + c.partial;
}

/** Nižší = výš v seznamu: nejdřív délky vhodné na řez (rem ≥ řez), pak ostatní načaté, pak plné. */
function remainderBucketSortRank(p: StockPieceRow, cutMm: number): number {
  const rem = Number(p.remainingLength);
  const orig = Number(p.originalLength);
  if (!Number.isFinite(rem) || rem <= 0 || String(p.status) === "empty") return 99;
  if (rem + STOCK_DISPLAY_EPS_MM >= cutMm) return 0;
  const isFull = Math.abs(rem - orig) <= STOCK_DISPLAY_EPS_MM;
  if (!isFull) return 1;
  return 2;
}

/** Popis zbytků; použitelné délky první. */
function formatStockRemainderDetail(pieces: StockPieceRow[], cutMm: number): string {
  type Bucket = { mm: number; count: number; minRank: number; maxSortMm: number };
  const map = new Map<number, Bucket>();
  for (const p of pieces) {
    const rem = Number(p.remainingLength);
    if (!Number.isFinite(rem) || rem <= 0 || String(p.status) === "empty") continue;
    const mm = Math.round(rem * 100) / 100;
    const r = remainderBucketSortRank(p, cutMm);
    const cur = map.get(mm);
    if (!cur) {
      map.set(mm, { mm, count: 1, minRank: r, maxSortMm: mm });
    } else {
      cur.count++;
      cur.minRank = Math.min(cur.minRank, r);
      cur.maxSortMm = Math.max(cur.maxSortMm, mm);
    }
  }
  const list = Array.from(map.values()).sort((a, b) => {
    if (a.minRank !== b.minRank) return a.minRank - b.minRank;
    return b.maxSortMm - a.maxSortMm;
  });
  if (list.length === 0) return "—";
  return list.map((b) => `${formatMmCs(b.mm)} mm × ${b.count} ks`).join("\n");
}

/**
 * Doporučení: pokud existuje kus s remainingLength ≥ délka řezu → „Použít zbytek“ (oranžový řádek).
 * Pro text volíme nejdelší takový kus (typicky nejvýhodnější zbytek).
 */
function recommendationForCut(pieces: StockPieceRow[], cutMm: number): { text: string; highlight: boolean } {
  const EPS = STOCK_DISPLAY_EPS_MM;
  let best: number | null = null;
  for (const p of pieces) {
    const rem = Number(p.remainingLength);
    if (!Number.isFinite(rem) || rem <= 0) continue;
    if (String(p.status) === "empty") continue;
    if (rem + EPS < cutMm) continue;
    if (best == null || rem > best) best = rem;
  }
  if (best != null) {
    return {
      text: `♻ Použít zbytek\n⚠ Použij zbytek ze skladu\nZbytek ${formatMmCs(best)} mm – vhodné použít`,
      highlight: true,
    };
  }
  return { text: "Nový kus", highlight: false };
}

type StockCols = {
  zbKs: string;
  plné: string;
  načaté: string;
  celkMm: string;
  zbytky: string;
  recText: string;
  highlight: boolean;
};

function buildStockCols(pieces: StockPieceRow[], cutMm: number): StockCols {
  const c = countPiecesExact(pieces);
  const zbKs = String(stockAvailablePiecesCount(pieces));
  const plné = String(c.full);
  const načaté = String(c.partial);
  const celkMm = `${formatMmCs(sumRemainingStockMm(pieces))} mm`;
  const zbytky = formatStockRemainderDetail(pieces, cutMm);
  const rec = recommendationForCut(pieces, cutMm);
  return {
    zbKs,
    plné,
    načaté,
    celkMm,
    zbytky,
    recText: rec.text,
    highlight: rec.highlight,
  };
}

function materiálBlock(name: string, ln: IssueLineForA4Material, stLabel: string): string {
  const noteLine =
    [ln.note?.trim(), ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean).join(" · ") || "";
  if (noteLine) return `${name}\n${noteLine}\nStav výkresu: ${stLabel}`;
  return `${name}\nStav výkresu: ${stLabel}`;
}

/**
 * Sloupce: Materiál, Výdej, Zbytek po řezu, Zbývá ks, Plné ks, Načaté ks, Celkem zbývá (mm), Zbytky, Doporučení
 */
export function buildProductionA4MaterialRows(
  lines: IssueLineForA4Material[],
  inventoryById: Map<string, InventoryItemRow>,
  stockPiecesSummaryByItem: Record<string, StockPiecesSummary>,
  getStatusLabel?: (ln: IssueLineForA4Material) => string
): ProductionA4MaterialRow[] {
  const out: ProductionA4MaterialRow[] = [];
  const statusOf = getStatusLabel ?? (() => "—");

  for (const ln of lines) {
    const inv = inventoryById.get(ln.itemId);
    const stLabel = statusOf(ln);
    const name = String(inv?.name ?? ln.itemId);

    if (!inv || String(inv.stockTrackingMode) !== "length") {
      const pieces = stockPiecesSummaryByItem[ln.itemId]?.pieces ?? [];
      const sc = pieces.length ? buildStockCols(pieces, Number.POSITIVE_INFINITY) : null;
      out.push({
        cells: [
          materiálBlock(name, ln, stLabel),
          `${ln.qtyStr}`.trim(),
          "—",
          sc?.zbKs ?? "—",
          sc?.plné ?? "—",
          sc?.načaté ?? "—",
          sc?.celkMm ?? "—",
          sc?.zbytky ?? "—",
          "—",
        ],
        boldRemainder: false,
        boldLineTotal: false,
        highlightUseScrap: false,
      });
      continue;
    }

    const sp = stockPiecesSummaryByItem[ln.itemId];
    const pieces: StockPieceRow[] = sp?.pieces ?? [];

    const pieceLenMm =
      sp?.pieceLengthMm != null && Number.isFinite(sp.pieceLengthMm) && sp.pieceLengthMm > 0
        ? sp.pieceLengthMm
        : inv.pieceLengthMm != null && Number.isFinite(Number(inv.pieceLengthMm)) && Number(inv.pieceLengthMm) > 0
          ? Number(inv.pieceLengthMm)
          : null;

    const rep = Number(String(ln.repeatCountStr ?? "1").replace(",", "."));
    const repOk = Number.isFinite(rep) && rep >= 1 && Math.floor(rep) === rep;
    const cutMm = perCutLengthMm(inv, ln);

    if (!repOk || cutMm == null || cutMm <= 0) {
      const sc = buildStockCols(pieces, Number.POSITIVE_INFINITY);
      out.push({
        cells: [
          materiálBlock(String(inv.name ?? ln.itemId), ln, stLabel),
          `${ln.qtyStr} (${ln.repeatCountStr}×)`.trim(),
          "—",
          sc.zbKs,
          sc.plné,
          sc.načaté,
          sc.celkMm,
          sc.zbytky,
          "—",
        ],
        boldRemainder: false,
        boldLineTotal: false,
        highlightUseScrap: false,
      });
      continue;
    }

    const sc = buildStockCols(pieces, cutMm);
    const removedSummary = `${formatMmCs(cutMm * rep)} mm (${rep}× ${formatMmCs(cutMm)} mm)`;

    if (pieceLenMm == null) {
      const cutsLabel = `${rep}× ${formatMmCs(cutMm)} mm`;
      out.push({
        cells: [
          materiálBlock(String(inv.name ?? ln.itemId), ln, stLabel),
          removedSummary,
          "—",
          sc.zbKs,
          sc.plné,
          sc.načaté,
          sc.celkMm,
          sc.zbytky,
          `${sc.recText}\nŘez: ${cutsLabel}`,
        ],
        boldRemainder: false,
        boldLineTotal: false,
        highlightUseScrap: sc.highlight,
      });
      continue;
    }

    const dist = splitLengthCutsAcrossStandardPieces(pieceLenMm, cutMm, rep);

    if (dist.length === 0) {
      out.push({
        cells: [
          materiálBlock(String(inv.name ?? ln.itemId), ln, stLabel),
          removedSummary,
          "—",
          sc.zbKs,
          sc.plné,
          sc.načaté,
          sc.celkMm,
          sc.zbytky,
          sc.recText,
        ],
        boldRemainder: false,
        boldLineTotal: false,
        highlightUseScrap: sc.highlight,
      });
      continue;
    }

    dist.forEach((row, idx) => {
      const výdejNaKusu = `${formatMmCs(row.cutsOnThisPiece * cutMm)} mm`;
      const cutsLabel = `${row.cutsOnThisPiece}× ${formatMmCs(cutMm)} mm`;
      const remLabel = `${formatMmCs(row.remainderMm)} mm`;
      out.push({
        cells: [
          idx === 0 ? materiálBlock(String(inv.name ?? ln.itemId), ln, stLabel) : "",
          idx === 0 ? removedSummary : `${výdejNaKusu}\n(${cutsLabel})`,
          remLabel,
          idx === 0 ? sc.zbKs : "",
          idx === 0 ? sc.plné : "",
          idx === 0 ? sc.načaté : "",
          idx === 0 ? sc.celkMm : "",
          idx === 0 ? sc.zbytky : "",
          idx === 0 ? sc.recText : "",
        ],
        boldRemainder: true,
        boldLineTotal: idx === 0,
        highlightUseScrap: sc.highlight && idx === 0,
      });
    });
  }

  return out;
}
