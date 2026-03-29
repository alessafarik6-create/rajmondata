export type InventoryMovementType =
  | "in"
  | "out"
  | "out_to_production"
  | "adjustment"
  | "item_edit";

export type InventoryItemRow = {
  id: string;
  companyId: string;
  name: string;
  sku?: string | null;
  /** Zařazení / kategorie materiálu (volitelné). */
  materialCategory?: string | null;
  unit: string;
  quantity: number;
  unitPrice?: number | null;
  /** Sazba DPH v % (volitelné — import CSV/PDF). */
  vatRate?: number | null;
  /** Preferovaný dodavatel u položky (volitelné). */
  supplier?: string | null;
  /** URL obrázku položky (Storage). */
  imageUrl?: string | null;
  /** csv-import | pdf-import apod. */
  source?: string | null;
  note?: string | null;
  createdAt?: unknown;
  createdBy: string;
  updatedAt?: unknown;
  /** Měkké smazání — položka zůstává ve Firestore. */
  isDeleted?: boolean;
  deletedAt?: unknown;
  deletedBy?: string | null;
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
  /** Změna množství při úpravě (kladná = přírůstek). */
  adjustmentDelta?: number | null;
  createdAt?: unknown;
  createdBy: string;
};
