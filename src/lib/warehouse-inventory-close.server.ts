import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { computeLineDiff } from "@/lib/warehouse-inventory-diff";
import type { WarehouseInventoryDoc, WarehouseInventoryLine } from "@/lib/warehouse-inventory-types";
import type { InventoryItemRow } from "@/lib/inventory-types";

export type CloseWarehouseInventoryResult =
  | {
      ok: true;
      batchId: string;
      movementsCreated: number;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

export async function closeWarehouseInventoryWithMovements(input: {
  db: Firestore;
  companyId: string;
  caller: VerifiedCompanyCaller;
  inventoryId: string;
  applyMovements: boolean;
  idempotencyKey: string;
}): Promise<CloseWarehouseInventoryResult> {
  const invRef = input.db
    .collection("companies")
    .doc(input.companyId)
    .collection("warehouseInventories")
    .doc(input.inventoryId);

  return input.db.runTransaction(async (tx) => {
    const invSnap = await tx.get(invRef);
    if (!invSnap.exists) {
      return { ok: false as const, status: 404, error: "Inventura neexistuje." };
    }
    const inv = invSnap.data() as WarehouseInventoryDoc;
    if (inv.companyId && inv.companyId !== input.companyId) {
      return { ok: false as const, status: 403, error: "Neplatná organizace inventury." };
    }
    if (inv.status === "closed") {
      if (inv.closeMovementBatchId === input.idempotencyKey) {
        return {
          ok: true as const,
          batchId: inv.closeMovementBatchId,
          movementsCreated: 0,
          warnings: ["Inventura už byla uzavřena (idempotentní opakování)."],
        };
      }
      return { ok: false as const, status: 409, error: "Inventura je již uzavřená." };
    }
    if (inv.status !== "approved" && inv.status !== "ready_for_review" && input.applyMovements) {
      return {
        ok: false as const,
        status: 400,
        error: "Před uzavřením s pohyby schvalte inventuru (stav Schválená).",
      };
    }

    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const warnings: string[] = [];
    let movementsCreated = 0;
    const batchId = input.idempotencyKey.trim() || invRef.id;

    if (input.applyMovements) {
      for (const line of lines) {
        const { diff, status } = computeLineDiff(line.systemQuantity, line.countedQuantity);
        if (status === "unset" || diff == null || Math.abs(diff) < 1e-9) continue;

        const itemRef = input.db
          .collection("companies")
          .doc(input.companyId)
          .collection("inventoryItems")
          .doc(line.itemId);
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists) {
          warnings.push(`Položka ${line.name} ve skladu chybí — přeskočeno.`);
          continue;
        }
        const item = itemSnap.data() as InventoryItemRow;
        if (item.isDeleted) {
          warnings.push(`Položka ${line.name} je smazaná — přeskočeno.`);
          continue;
        }
        const currentQty = Number(item.quantity ?? 0);
        if (Math.abs(currentQty - line.systemQuantity) > 1e-6) {
          warnings.push(
            `${line.name}: sklad se od načtení inventury změnil (${line.systemQuantity} → ${currentQty}). Korekce vůči aktuálnímu stavu.`
          );
        }
        const targetQty = line.countedQuantity as number;
        const delta = targetQty - currentQty;
        if (Math.abs(delta) < 1e-9) continue;

        const nextQty = Math.round((currentQty + delta) * 1000) / 1000;
        tx.update(itemRef, {
          quantity: nextQty,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const movRef = input.db
          .collection("companies")
          .doc(input.companyId)
          .collection("inventoryMovements")
          .doc();
        tx.set(movRef, {
          companyId: input.companyId,
          type: "admin_adjustment",
          itemId: line.itemId,
          itemName: line.name,
          quantity: Math.abs(delta),
          unit: line.unit || item.unit || "ks",
          date: new Date().toISOString().slice(0, 10),
          note: `Inventura ${inv.inventoryNumber} — ${delta < 0 ? "manko" : "přebytek"}`,
          adjustmentDelta: delta,
          quantityBefore: currentQty,
          quantityAfter: nextQty,
          batchNumber: batchId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: input.caller.uid,
        });
        movementsCreated++;
      }
    }

    const history = Array.isArray(inv.statusHistory) ? [...inv.statusHistory] : [];
    history.push({
      at: new Date().toISOString(),
      by: input.caller.uid,
      from: inv.status,
      to: "closed",
      note: input.applyMovements ? `Uzavřeno s ${movementsCreated} pohyby` : "Uzavřeno bez pohybů",
    });

    tx.update(invRef, {
      status: "closed",
      closedAt: FieldValue.serverTimestamp(),
      closedBy: input.caller.uid,
      closeMovementBatchId: batchId,
      statusHistory: history,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true as const, batchId, movementsCreated, warnings };
  });
}
