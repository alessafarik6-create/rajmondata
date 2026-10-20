import type { InventoryItemRow } from "@/lib/inventory-types";
import { isInventoryPiecesLengthRow } from "@/lib/stock-pieces-display";
import type {
  WarehouseInventoryLine,
  WarehouseInventoryProfileCount,
} from "@/lib/warehouse-inventory-types";

export type InventoryLineDiffStatus = "unset" | "match" | "shortage" | "surplus";

export function computeLineDiff(
  systemQuantity: number,
  countedQuantity: number | null | undefined
): { diff: number | null; status: InventoryLineDiffStatus } {
  if (
    countedQuantity === null ||
    countedQuantity === undefined ||
    !Number.isFinite(Number(countedQuantity))
  ) {
    return { diff: null, status: "unset" };
  }
  const sys = Number(systemQuantity);
  const counted = Number(countedQuantity);
  const diff = Math.round((counted - sys) * 1000) / 1000;
  if (Math.abs(diff) < 1e-9) return { diff: 0, status: "match" };
  if (diff < 0) return { diff, status: "shortage" };
  return { diff, status: "surplus" };
}

export function computeProfileTotalMm(profile: WarehouseInventoryProfileCount | null | undefined): number {
  if (!profile) return 0;
  const full = Math.max(0, Math.floor(Number(profile.fullBarCount) || 0));
  const len = Number(profile.barLengthMm);
  const barLen = Number.isFinite(len) && len > 0 ? len : 0;
  const partials = Array.isArray(profile.partialLengthsMm)
    ? profile.partialLengthsMm
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    : [];
  return full * barLen + partials.reduce((a, b) => a + b, 0);
}

export function formatInventorySystemDisplay(row: InventoryItemRow): string {
  if (
    isInventoryPiecesLengthRow(row) &&
    row.pieceLengthMm != null &&
    Number(row.pieceLengthMm) > 0
  ) {
    const pcs = row.stockPieceStats?.total ?? row.pieceCount ?? 0;
    return `${pcs} ks × ${Number(row.pieceLengthMm).toLocaleString("cs-CZ")} mm (celkem ${Number(row.quantity ?? 0).toLocaleString("cs-CZ")} mm)`;
  }
  return `${Number(row.quantity ?? 0).toLocaleString("cs-CZ")} ${row.unit || "ks"}`;
}

export function inventoryLineFromItem(row: InventoryItemRow, categoryName?: string): WarehouseInventoryLine {
  const profile: WarehouseInventoryProfileCount | null =
    isInventoryPiecesLengthRow(row) && row.pieceLengthMm
      ? {
          fullBarCount: Number(row.stockPieceStats?.full ?? row.pieceCount ?? 0),
          barLengthMm: Number(row.pieceLengthMm),
          partialLengthsMm: [],
        }
      : null;

  return {
    itemId: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit || "ks",
    imageUrl: row.imageUrl,
    categoryName: categoryName ?? row.categoryName,
    stockTrackingMode: row.stockTrackingMode,
    stockMode: row.stockMode,
    unitPrice: row.unitPrice,
    systemQuantity: Number(row.quantity ?? 0),
    systemDisplay: formatInventorySystemDisplay(row),
    systemProfile: profile,
    countedQuantity: null,
    countedProfile: profile ? { ...profile, partialLengthsMm: [] } : null,
    note: null,
  };
}

export function recomputeInventoryStats(lines: WarehouseInventoryLine[]): {
  linesTotal: number;
  counted: number;
  shortages: number;
  surpluses: number;
  matches: number;
  diffValueCzk: number;
} {
  let counted = 0;
  let shortages = 0;
  let surpluses = 0;
  let matches = 0;
  let diffValueCzk = 0;
  for (const line of lines) {
    const { diff, status } = computeLineDiff(line.systemQuantity, line.countedQuantity);
    if (status === "unset") continue;
    counted++;
    if (status === "match") matches++;
    else if (status === "shortage") shortages++;
    else if (status === "surplus") surpluses++;
    if (diff != null) {
      const price =
        line.unitPrice != null && Number.isFinite(Number(line.unitPrice))
          ? Number(line.unitPrice)
          : 0;
      diffValueCzk += diff * price;
    }
  }
  return {
    linesTotal: lines.length,
    counted,
    shortages,
    surpluses,
    matches,
    diffValueCzk: Math.round(diffValueCzk * 100) / 100,
  };
}

export function diffStatusClass(status: InventoryLineDiffStatus): string {
  switch (status) {
    case "match":
      return "text-emerald-700 bg-emerald-50";
    case "shortage":
      return "text-red-700 bg-red-50";
    case "surplus":
      return "text-orange-700 bg-orange-50";
    default:
      return "text-slate-600 bg-slate-50";
  }
}
