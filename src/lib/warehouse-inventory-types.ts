import type { InventoryStockModeMm, InventoryStockTrackingMode } from "@/lib/inventory-types";

export type WarehouseInventoryStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "closed";

export const WAREHOUSE_INVENTORY_STATUS_LABELS: Record<WarehouseInventoryStatus, string> = {
  draft: "Rozpracovaná",
  ready_for_review: "Připravená ke kontrole",
  approved: "Schválená",
  closed: "Uzavřená",
};

/** Ruční / elektronický součet u profilů — kusy + délky zbytků. */
export type WarehouseInventoryProfileCount = {
  fullBarCount: number;
  barLengthMm: number;
  partialLengthsMm: number[];
};

export type WarehouseInventoryLine = {
  itemId: string;
  name: string;
  sku?: string | null;
  unit: string;
  imageUrl?: string | null;
  categoryName?: string | null;
  stockTrackingMode?: InventoryStockTrackingMode | null;
  stockMode?: InventoryStockModeMm | null;
  unitPrice?: number | null;
  /** Snapshot systému při načtení / obnovení baseline. */
  systemQuantity: number;
  systemDisplay?: string | null;
  /** U profilů — snapshot kusů (volitelně). */
  systemProfile?: WarehouseInventoryProfileCount | null;
  /** Zadaný fyzický stav — null = nepočítáno (není 0). */
  countedQuantity: number | null;
  countedProfile?: WarehouseInventoryProfileCount | null;
  note?: string | null;
};

export type WarehouseInventoryDoc = {
  id: string;
  companyId: string;
  inventoryNumber: string;
  status: WarehouseInventoryStatus;
  warehouseName: string;
  scopeLabel: string;
  assignedWorkerName?: string | null;
  notes?: string | null;
  lines: WarehouseInventoryLine[];
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  closedAt?: unknown;
  closedBy?: string | null;
  closeMovementBatchId?: string | null;
  stats?: {
    linesTotal: number;
    counted: number;
    shortages: number;
    surpluses: number;
    matches: number;
    diffValueCzk: number;
  };
  statusHistory?: Array<{
    at: string;
    by: string;
    from: WarehouseInventoryStatus;
    to: WarehouseInventoryStatus;
    note?: string | null;
  }>;
};

export type WarehousePdfExportKind =
  | "stock_list"
  | "count_sheet"
  | "valued_list"
  | "inventory_report";
