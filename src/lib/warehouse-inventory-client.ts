import type { WarehousePdfExportKind } from "@/lib/warehouse-inventory-types";

export async function downloadWarehouseInventoryPdf(input: {
  token: string;
  kind: WarehousePdfExportKind;
  itemIds: string[];
  warehouseName?: string;
  hideSystemQuantity?: boolean;
  showPrices?: boolean;
  inventoryId?: string;
  title?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/company/warehouse/inventory/pdf", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: input.kind,
      itemIds: input.itemIds,
      warehouseName: input.warehouseName,
      hideSystemQuantity: input.hideSystemQuantity,
      showPrices: input.showPrices,
      inventoryId: input.inventoryId,
      title: input.title,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    input.kind === "count_sheet"
      ? "inventurni-list.pdf"
      : input.kind === "valued_list"
        ? "sklad-oceneny.pdf"
        : "sklad-export.pdf";
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export function nextInventoryNumber(existing: { inventoryNumber?: string }[]): string {
  const today = new Date();
  const prefix = `INV-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const sameDay = existing.filter((x) => String(x.inventoryNumber ?? "").startsWith(prefix));
  const seq = sameDay.length + 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}
