export type InventoryMovementType =
  | "in"
  | "out"
  | "out_to_production"
  /** Výdej přímo na zakázku (výroba / montáž). */
  | "out_to_job"
  /** Částečný výdej (např. řez materiálu) — doprovází záznam o zbytku. */
  | "partial_out"
  /** Vznik samostatné skladové řádky jako zbytek po řezu. */
  | "remainder_created"
  /** Vrácení / sloučení zbytku. */
  | "remainder_return"
  | "transfer_internal"
  | "admin_adjustment"
  | "adjustment"
  | "item_edit";

/** Doplňková evidence — u „kusů“ se chová jako dosud (quantity = počet kusů). */
export type InventoryStockTrackingMode =
  | "pieces"
  | "length"
  | "area"
  | "mass"
  | "generic";

export type InventoryItemRow = {
  id: string;
  companyId: string;
  name: string;
  sku?: string | null;
  /** Zařazení / kategorie materiálu (volitelné). */
  materialCategory?: string | null;
  unit: string;
  quantity: number;
  /** Režim evidence (výchozí pieces = kompatibilní se stávajícími záznamy). */
  stockTrackingMode?: InventoryStockTrackingMode | null;
  /** U délkových materiálů: původní délka v `lengthStockUnit`. */
  originalLength?: number | null;
  /** Aktuální dostupná délka / množství ve skladu ve stejné jednotce jako `unit` u length. */
  currentLength?: number | null;
  /** Jednotka pro délkovou evidenci (mm, cm, m) — měla by odpovídat `unit` pro length režim. */
  lengthStockUnit?: string | null;
  /** Nadřazená skladová položka (např. původní tyč před řezem). */
  parentStockItemId?: string | null;
  isRemainder?: boolean | null;
  remainderOfItemId?: string | null;
  /** Umístění ve skladu (volitelné). */
  warehouseLocation?: string | null;
  /** Rezervace na zakázku (volitelné). */
  reservedForJobId?: string | null;
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
  jobId?: string | null;
  jobName?: string | null;
  employeeId?: string | null;
  /** Množství na skladě před pohybem (stejná jednotka jako quantity pohybu). */
  quantityBefore?: number | null;
  /** Množství na skladě po pohybu. */
  quantityAfter?: number | null;
  /** Nová skladová položka (zbytek) vzniklá řezem. */
  remainderItemId?: string | null;
  batchNumber?: string | null;
  /** Změna množství při úpravě (kladná = přírůstek). */
  adjustmentDelta?: number | null;
  createdAt?: unknown;
  createdBy: string;
};
