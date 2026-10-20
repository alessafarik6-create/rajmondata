import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerFromRequest } from "@/lib/api-company-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import {
  buildWarehouseInventoryPdfHtml,
  type WarehousePdfItemRow,
} from "@/lib/warehouse-inventory-pdf-html";
import type { WarehousePdfExportKind } from "@/lib/warehouse-inventory-types";
import { assertWarehouseInventoryAccess } from "@/lib/warehouse-inventory-access.server";
import { formatInventorySystemDisplay } from "@/lib/warehouse-inventory-diff";
import type { InventoryItemRow } from "@/lib/inventory-types";
import { isActiveInventoryItem } from "@/lib/inventory-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  kind?: WarehousePdfExportKind;
  warehouseName?: string;
  hideSystemQuantity?: boolean;
  showPrices?: boolean;
  itemIds?: string[];
  inventoryId?: string;
  title?: string;
};

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearerFromRequest(request);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }

  const access = await assertWarehouseInventoryAccess(v.db, v.caller);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const kind = (body.kind ?? "stock_list") as WarehousePdfExportKind;
  const warehouseName = String(body.warehouseName ?? "Hlavní sklad").trim() || "Hlavní sklad";

  const companySnap = await v.db.collection("companies").doc(v.caller.companyId).get();
  const companyMeta = handoverCompanyPdfMeta(companySnap.data() as Record<string, unknown>);
  const createdAtLabel = new Date().toLocaleString("cs-CZ");

  let items: WarehousePdfItemRow[] = [];
  let inventoryDoc: Body & { inventoryNumber?: string; lines?: unknown[]; assignedWorkerName?: string; notes?: string } | null =
    null;

  if (body.inventoryId) {
    const invSnap = await v.db
      .collection("companies")
      .doc(v.caller.companyId)
      .collection("warehouseInventories")
      .doc(String(body.inventoryId).trim())
      .get();
    if (!invSnap.exists) {
      return NextResponse.json({ ok: false, error: "Inventura nenalezena." }, { status: 404 });
    }
    const inv = invSnap.data() as Record<string, unknown>;
    inventoryDoc = {
      inventoryNumber: String(inv.inventoryNumber ?? ""),
      lines: Array.isArray(inv.lines) ? inv.lines : [],
      assignedWorkerName: String(inv.assignedWorkerName ?? ""),
      notes: String(inv.notes ?? ""),
    };
    items = (inventoryDoc.lines as WarehousePdfItemRow[]).map((line) => ({
      name: String((line as { name?: string }).name ?? ""),
      sku: (line as { sku?: string }).sku,
      unit: String((line as { unit?: string }).unit ?? "ks"),
      quantity: Number((line as { systemQuantity?: number }).systemQuantity ?? 0),
      unitPrice: (line as { unitPrice?: number }).unitPrice,
      systemDisplay: (line as { systemDisplay?: string }).systemDisplay,
    }));
  } else {
    const ids = Array.isArray(body.itemIds)
      ? body.itemIds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!ids.length) {
      return NextResponse.json({ ok: false, error: "Vyberte alespoň jednu položku." }, { status: 400 });
    }
    if (ids.length > 2000) {
      return NextResponse.json({ ok: false, error: "Příliš mnoho položek (max 2000)." }, { status: 400 });
    }

    const catSnap = await v.db
      .collection("companies")
      .doc(v.caller.companyId)
      .collection("stockCategories")
      .limit(500)
      .get();
    const catById = new Map<string, string>();
    for (const d of catSnap.docs) {
      catById.set(d.id, String(d.data().name ?? ""));
    }

    const chunkSize = 30;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (id) => {
          const snap = await v.db
            .collection("companies")
            .doc(v.caller.companyId)
            .collection("inventoryItems")
            .doc(id)
            .get();
          if (!snap.exists) return;
          const row = { ...(snap.data() as InventoryItemRow), id: snap.id };
          if (!isActiveInventoryItem(row)) return;
          const categoryName = row.categoryId ? catById.get(String(row.categoryId)) : row.categoryName;
          items.push({
            name: row.name,
            sku: row.sku,
            unit: row.unit || "ks",
            quantity: Number(row.quantity ?? 0),
            unitPrice: row.unitPrice,
            categoryName: categoryName ?? null,
            systemDisplay: formatInventorySystemDisplay(row),
          });
        })
      );
    }
    items.sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }

  if (!items.length) {
    return NextResponse.json({ ok: false, error: "Žádné položky k exportu." }, { status: 400 });
  }

  const titles: Record<WarehousePdfExportKind, string> = {
    stock_list: "Skladové položky",
    count_sheet: "Inventurní list",
    valued_list: "Oceněný skladový soupis",
    inventory_report: "Inventura — výsledný protokol",
  };

  const html = buildWarehouseInventoryPdfHtml({
    kind: body.inventoryId ? "inventory_report" : kind,
    meta: {
      companyName: companyMeta.contractorCompanyName,
      logoUrl: companyMeta.logoUrl,
      warehouseName,
      createdAtLabel,
      title: body.title?.trim() || titles[body.inventoryId ? "inventory_report" : kind],
      subtitle: body.inventoryId && inventoryDoc?.inventoryNumber
        ? `Číslo inventury: ${inventoryDoc.inventoryNumber}`
        : undefined,
    },
    items,
    hideSystemQuantity: body.hideSystemQuantity === true,
    showPrices: kind === "valued_list" || body.showPrices === true,
    inventory: body.inventoryId && inventoryDoc
      ? {
          inventoryNumber: inventoryDoc.inventoryNumber ?? "",
          lines: inventoryDoc.lines as never,
          assignedWorkerName: inventoryDoc.assignedWorkerName,
          notes: inventoryDoc.notes,
        }
      : undefined,
  });

  const pdf = await renderStoredHtmlToPdfBuffer(html);
  const filename =
    kind === "count_sheet"
      ? "inventurni-list.pdf"
      : kind === "valued_list"
        ? "sklad-oceneny.pdf"
        : "sklad-export.pdf";

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
