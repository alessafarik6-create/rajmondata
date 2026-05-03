import { lengthToMillimeters, millimetersToUnit } from "@/lib/job-production-settings";
import type { InventoryItemRow } from "@/lib/inventory-types";
import { STOCK_DISPLAY_EPS_MM, formatMmCs } from "@/lib/stock-pieces-display";
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
  /** Tučné zvýraznění ve sloupcích „Zbytek z kusu“ a „Celk. zbytek (řádek)“. */
  boldRemainder: boolean;
  boldLineTotal: boolean;
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

/**
 * Sestaví řádky tabulky materiálu pro výrobní list A4 (včetně více řádků u metráže přes více kusů).
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
    const unit = inv?.unit || "ks";
    const stLabel = statusOf(ln);

    if (!inv || String(inv.stockTrackingMode) !== "length") {
      const note = [ln.note, ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean).join(" · ");
      out.push({
        cells: [
          String(inv?.name ?? ln.itemId),
          `${ln.qtyStr}`.trim(),
          unit,
          "—",
          "—",
          "—",
          "—",
          "—",
          note,
          stLabel,
        ],
        boldRemainder: false,
        boldLineTotal: false,
      });
      continue;
    }

    const sp = stockPiecesSummaryByItem[ln.itemId];
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
      const note = [ln.note, ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean).join(" · ");
      out.push({
        cells: [
          String(inv.name ?? ln.itemId),
          `${ln.qtyStr} (${ln.repeatCountStr}×)`.trim(),
          unit,
          pieceLenMm != null ? `${formatMmCs(pieceLenMm)} mm` : "—",
          "—",
          "—",
          "—",
          "—",
          note,
          stLabel,
        ],
        boldRemainder: false,
        boldLineTotal: false,
      });
      continue;
    }

    const totalCutMm = cutMm * rep;
    const removedSummary = `${formatMmCs(totalCutMm)} mm (${rep}× ${formatMmCs(cutMm)} mm)`;

    if (pieceLenMm == null) {
      const cutsLabel = `${rep}× ${formatMmCs(cutMm)} mm`;
      const note = [ln.note, ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean).join(" · ");
      out.push({
        cells: [
          String(inv.name ?? ln.itemId),
          removedSummary,
          unit,
          "—",
          cutsLabel,
          "—",
          "—",
          "—",
          note,
          stLabel,
        ],
        boldRemainder: false,
        boldLineTotal: false,
      });
      continue;
    }

    const dist = splitLengthCutsAcrossStandardPieces(pieceLenMm, cutMm, rep);
    const totalRem = dist.reduce((a, r) => a + r.remainderMm, 0);
    const note = [ln.note, ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean).join(" · ");

    if (dist.length === 0) {
      out.push({
        cells: [
          String(inv.name ?? ln.itemId),
          removedSummary,
          unit,
          `${formatMmCs(pieceLenMm)} mm`,
          `${rep}× ${formatMmCs(cutMm)} mm`,
          "—",
          "—",
          "—",
          note,
          stLabel,
        ],
        boldRemainder: false,
        boldLineTotal: false,
      });
      continue;
    }

    dist.forEach((row, idx) => {
      const cutsLabel = `${row.cutsOnThisPiece}× ${formatMmCs(cutMm)} mm`;
      const remLabel = `${formatMmCs(row.remainderMm)} mm`;
      const pieceCountLabel = "1";
      const lineTotalLabel = idx === 0 ? `${formatMmCs(totalRem)} mm` : "";
      out.push({
        cells: [
          idx === 0 ? String(inv.name ?? ln.itemId) : "",
          idx === 0 ? removedSummary : "",
          idx === 0 ? unit : "",
          `${formatMmCs(pieceLenMm)} mm`,
          cutsLabel,
          remLabel,
          pieceCountLabel,
          lineTotalLabel,
          idx === 0 ? note : "",
          idx === 0 ? stLabel : "",
        ],
        boldRemainder: true,
        boldLineTotal: idx === 0,
      });
    });
  }

  return out;
}
