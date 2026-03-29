import type { InventoryItemRow } from "@/lib/inventory-types";

/** Položka se v běžném přehledu zobrazí, pokud není měkce smazaná. */
export function isActiveInventoryItem(
  row: Pick<InventoryItemRow, "isDeleted"> | null | undefined
): boolean {
  return row?.isDeleted !== true;
}

export function inventoryLineValueCzk(row: InventoryItemRow): number {
  const q = Number(row.quantity ?? 0);
  const p = row.unitPrice != null && Number.isFinite(Number(row.unitPrice)) ? Number(row.unitPrice) : 0;
  return Math.round(q * p * 100) / 100;
}

export function formatInventoryMoneyCzk(n: number): string {
  return `${Math.round(n).toLocaleString("cs-CZ")} Kč`;
}

/** Výchozí návrhy kategorie — uživatel může zadat libovolný text. */
export const INVENTORY_MATERIAL_CATEGORY_SUGGESTIONS = [
  "Materiál",
  "Nářadí",
  "Spotřební",
  "Elektro",
  "Stavebniny",
  "Chemie",
  "Obal",
  "Ostatní",
] as const;
