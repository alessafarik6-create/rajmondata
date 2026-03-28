export type InventoryMovementType = "in" | "out" | "out_to_production";

export type InventoryItemRow = {
  id: string;
  companyId: string;
  name: string;
  sku?: string | null;
  unit: string;
  quantity: number;
  unitPrice?: number | null;
  note?: string | null;
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
};

export type InventoryMovementRow = {
  id: string;
  companyId: string;
  type: InventoryMovementType;
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  date: string;
  note?: string | null;
  supplier?: string | null;
  documentNo?: string | null;
  destination?: string | null;
  productionId?: string | null;
  productionTitle?: string | null;
  createdAt?: unknown;
  createdBy: string;
};
