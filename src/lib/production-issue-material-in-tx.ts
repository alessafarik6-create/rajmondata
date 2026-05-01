/**
 * Jednotný zápis výdeje materiálu na zakázku uvnitř Firestore transakce (Admin SDK).
 * Používá `issue-material` i dávkové potvrzení z CSV.
 */
import { FieldValue } from "firebase-admin/firestore";
import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Transaction,
  UpdateData,
} from "firebase-admin/firestore";
import { lengthToMillimeters, millimetersToUnit } from "@/lib/job-production-settings";
import type { InventoryStockTrackingMode } from "@/lib/inventory-types";
import {
  countPiecesByStatus,
  planLengthAllocation,
  sumUsableRemainingMm,
  type StockPieceForPlan,
} from "@/lib/stock-pieces";

function trackingModeOf(raw: unknown, unit: string): InventoryStockTrackingMode {
  const m = String(raw || "").trim();
  if (m === "length" || m === "area" || m === "mass" || m === "generic" || m === "pieces") {
    return m;
  }
  return "pieces";
}

export type MaterialIssueInTxParams = {
  itemId: string;
  /** Délka jednoho řezu ve vstupní jednotce (inputLengthUnit) nebo ve skladové jednotce. */
  quantity: number;
  inputLengthUnit: "mm" | "cm" | "m" | null;
  note: string;
  batchNumber: string;
  /** Kolikrát odebrat quantity (např. 3× stejná délka). Výchozí 1. */
  repeatCount?: number;
  /** Doplňková pole na záznam spotřeby (např. vazba na CSV). */
  consumptionExtras?: Record<string, unknown>;
};

export type MaterialIssueInTxContext = {
  db: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  callerUid: string;
  callerEmployeeId: string | null;
  createdByName: string;
};

export type MaterialIssueCutAllocation = {
  pieceId: string;
  usedLengthMm: number;
  remainingAfterMm: number;
};

export type MaterialIssueInTxResult = {
  movementId: string;
  consumptionId: string;
  remainderItemId: string | null;
  unit: string;
  quantityAfter: number;
  /** Pouze u délkového materiálu s evidencí kusů. */
  cutIds?: string[];
  allocations?: MaterialIssueCutAllocation[];
};

export type MaterialIssueInTxOptions = {
  /** Přednačtené reference dokumentů stockPieces (stejná firma + item). */
  stockPieceRefs?: DocumentReference[];
};

function parseRepeatCount(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : Number.parseInt(String(raw ?? "1"), 10);
  if (!Number.isFinite(n) || n < 1 || n > 10_000) {
    throw new Error("Počet kusů (opakování) musí být celé číslo od 1 do 10 000.");
  }
  if (Math.floor(n) !== n) {
    throw new Error("Počet kusů (opakování) musí být celé číslo.");
  }
  return n;
}

function pieceDocToPlan(
  pieceId: string,
  data: Record<string, unknown> | undefined,
  materialId: string
): StockPieceForPlan | null {
  if (!data) return null;
  if (String(data.materialId || "") !== materialId) return null;
  const rem = Number(data.remainingLength);
  const orig = Number(data.originalLength ?? rem);
  const st = String(data.status || "available");
  if (!Number.isFinite(rem) || !Number.isFinite(orig)) return null;
  return { id: pieceId, remainingMm: rem, originalMm: orig, status: st };
}

/**
 * Předpoklad: voláno z `runTransaction`; všechny čtení/zápisy přes předané `tx`.
 */
export async function executeMaterialIssueInAdminTransaction(
  tx: Transaction,
  ctx: MaterialIssueInTxContext,
  input: MaterialIssueInTxParams,
  options?: MaterialIssueInTxOptions
): Promise<MaterialIssueInTxResult> {
  const { db, companyId, jobId, jobName, callerUid, callerEmployeeId, createdByName } = ctx;
  const {
    itemId,
    quantity: qtyRaw,
    inputLengthUnit,
    note,
    batchNumber,
    consumptionExtras,
  } = input;
  const repeatCount = parseRepeatCount(input.repeatCount ?? 1);

  const itemRef = db.collection("companies").doc(companyId).collection("inventoryItems").doc(itemId);
  const itemSnap = await tx.get(itemRef);
  if (!itemSnap.exists) throw new Error("Skladová položka neexistuje.");
  const item = itemSnap.data() as Record<string, unknown>;
  if (item.isDeleted === true) throw new Error("Položka byla odstraněna.");
  if (String(item.companyId || "") !== companyId) {
    throw new Error("Položka nepatří do této organizace.");
  }
  if (item.remainderFullyConsumed === true) {
    throw new Error("Tento zbytek byl již plně spotřebován a nelze z něj znovu vydávat.");
  }
  if (item.isRemainder === true && item.remainderAvailable === false) {
    throw new Error("Tento zbytek není označen jako volný k dalšímu výdeji.");
  }

  const unit = String(item.unit || "ks").trim() || "ks";
  const mode = trackingModeOf(item.stockTrackingMode, unit);
  const stockQty = Number(item.quantity ?? 0);
  let available = stockQty;
  if (mode === "length") {
    const cur = item.currentLength;
    available = cur != null && Number.isFinite(Number(cur)) ? Number(cur) : stockQty;
  }

  let perCutStockUnit = qtyRaw;
  if (mode === "length" && inputLengthUnit) {
    const mm = lengthToMillimeters(qtyRaw, inputLengthUnit);
    if (mm == null) {
      throw new Error("Neplatná délka nebo jednotka.");
    }
    const stockU = String(item.lengthStockUnit || unit || "mm").trim().toLowerCase();
    const conv = millimetersToUnit(mm, stockU);
    if (conv == null) {
      throw new Error(
        `Nelze převést na skladovou jednotku (${stockU}). Zadejte množství přímo ve stejné jednotce jako na skladě, nebo doplňte lengthStockUnit u položky.`
      );
    }
    perCutStockUnit = conv;
  }

  const qtyInStockUnit = perCutStockUnit * repeatCount;

  if (mode === "pieces") {
    if (!Number.isInteger(qtyInStockUnit)) {
      throw new Error("U kusové evidence odeberte celý počet kusů.");
    }
  }

  if (mode === "length" && qtyInStockUnit <= 0) {
    throw new Error("U délkového materiálu zadejte kladnou délku a počet kusů.");
  }

  const stockPieceRefs = options?.stockPieceRefs;
  const useStockPieces =
    mode === "length" && Array.isArray(stockPieceRefs) && stockPieceRefs.length > 0;

  if (useStockPieces) {
    const pieceSnaps = await Promise.all(stockPieceRefs!.map((r) => tx.get(r)));
    const plans: StockPieceForPlan[] = [];
    for (const ps of pieceSnaps) {
      if (!ps.exists) continue;
      const p = pieceDocToPlan(ps.id, ps.data() as Record<string, unknown>, itemId);
      if (p) plans.push(p);
    }

    const stockU = String(item.lengthStockUnit || unit || "mm").trim().toLowerCase();
    let perCutMm: number | null = null;
    if (inputLengthUnit) {
      perCutMm = lengthToMillimeters(qtyRaw, inputLengthUnit);
    } else {
      perCutMm = lengthToMillimeters(qtyRaw, stockU);
    }
    if (perCutMm == null || perCutMm <= 0) {
      throw new Error("Neplatná délka řezu.");
    }
    const totalNeedMm = perCutMm * repeatCount;

    const usableSum = sumUsableRemainingMm(plans);
    if (totalNeedMm > usableSum + 1e-6) {
      throw new Error("Na skladě není dostatek materiálu.");
    }

    const planned = planLengthAllocation(plans, totalNeedMm);
    if (!planned.ok) {
      throw new Error(planned.error);
    }

    const byId = new Map(plans.map((p) => [p.id, { ...p }]));
    for (const ch of planned.chunks) {
      const row = byId.get(ch.pieceId);
      if (row) {
        row.remainingMm = ch.remainingAfterMm;
        row.status = ch.newStatus;
      }
    }

    const totalAvailMmAfter = sumUsableRemainingMm([...byId.values()]);
    const newAvailableConv = millimetersToUnit(totalAvailMmAfter, stockU);
    if (newAvailableConv == null) {
      throw new Error("Nelze převést zbývající zásobu do skladové jednotky.");
    }
    const newAvailable = newAvailableConv;

    const movRef = db.collection("companies").doc(companyId).collection("inventoryMovements").doc();
    const movementId = movRef.id;
    const consRef = db
      .collection("companies")
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("materialConsumptions")
      .doc();
    const consumptionId = consRef.id;

    const itemName = String(item.name || itemId);
    const today = new Date().toISOString().slice(0, 10);
    const isPartialLength = newAvailable > 1e-9;
    const movType = isPartialLength ? "partial_out" : "out_to_job";

    const itemPatch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      quantity: newAvailable,
      currentLength: newAvailable,
      remainingQuantity: newAvailable,
    };
    if (item.originalLength == null && Number.isFinite(available)) {
      itemPatch.originalLength = available;
    }
    const stats = countPiecesByStatus(byId.values());
    itemPatch.stockPieceStats = stats;

    tx.update(itemRef, itemPatch as UpdateData<DocumentData>);

    const cutIds: string[] = [];
    const allocations: MaterialIssueCutAllocation[] = [];

    for (const ch of planned.chunks) {
      const pRef = db
        .collection("companies")
        .doc(companyId)
        .collection("inventoryItems")
        .doc(itemId)
        .collection("stockPieces")
        .doc(ch.pieceId);
      tx.update(pRef, {
        remainingLength: ch.remainingAfterMm,
        status: ch.newStatus,
      } as UpdateData<DocumentData>);

      const cutRef = db.collection("companies").doc(companyId).collection("stockCuts").doc();
      cutIds.push(cutRef.id);
      allocations.push({
        pieceId: ch.pieceId,
        usedLengthMm: ch.takeMm,
        remainingAfterMm: ch.remainingAfterMm,
      });
      tx.set(cutRef, {
        companyId,
        pieceId: ch.pieceId,
        materialId: itemId,
        usedLength: ch.takeMm,
        jobId,
        userId: callerUid,
        date: today,
        movementId,
        consumptionId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(movRef, {
      companyId,
      type: movType,
      itemId,
      itemName,
      quantity: qtyInStockUnit,
      unit,
      date: today,
      note: note || null,
      jobId,
      jobName,
      employeeId: callerEmployeeId,
      quantityBefore: available,
      quantityAfter: newAvailable,
      remainderItemId: null,
      batchNumber: batchNumber || null,
      destination: `job:${jobId}`,
      stockCutIds: cutIds,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
    });

    const parentTrace =
      typeof item.remainderOfItemId === "string" && String(item.remainderOfItemId).trim()
        ? String(item.remainderOfItemId).trim()
        : typeof item.parentStockItemId === "string" && String(item.parentStockItemId).trim()
          ? String(item.parentStockItemId).trim()
          : null;

    const consumptionBase: Record<string, unknown> = {
      companyId,
      jobId,
      jobName,
      productionJobId: jobId,
      inventoryItemId: itemId,
      stockItemId: itemId,
      sourceStockItemId: itemId,
      parentStockItemId: parentTrace,
      itemName,
      quantity: qtyInStockUnit,
      quantityUsed: qtyInStockUnit,
      quantityIssued: qtyInStockUnit,
      quantityBeforeOnHand: available,
      originalQuantity: available,
      remainingQuantityAfterCut: newAvailable,
      unit,
      inputLengthUnit: inputLengthUnit || null,
      repeatCount,
      perCutQuantityStockUnit: perCutStockUnit,
      movementId,
      sourceStockMovementId: movementId,
      employeeId: callerEmployeeId,
      authUserId: callerUid,
      createdByName,
      note: note || null,
      batchNumber: batchNumber || null,
      quantityRemainingOnStock: newAvailable,
      remainderCreated: false,
      remainderItemId: null,
      remainderId: null,
      stockTrackingMode: mode,
      stockCutIds: cutIds,
      stockPieceAllocations: allocations,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (consumptionExtras && Object.keys(consumptionExtras).length > 0) {
      Object.assign(consumptionBase, consumptionExtras);
    }

    tx.set(consRef, consumptionBase);

    return {
      movementId,
      consumptionId: consRef.id,
      quantityAfter: newAvailable,
      remainderItemId: null,
      unit,
      cutIds,
      allocations,
    };
  }

  if (qtyInStockUnit > available + 1e-9) {
    throw new Error("Na skladě není dostatek materiálu.");
  }

  const newAvailable = available - qtyInStockUnit;
  const movRef = db.collection("companies").doc(companyId).collection("inventoryMovements").doc();
  const movementId = movRef.id;

  const itemName = String(item.name || itemId);
  const today = new Date().toISOString().slice(0, 10);
  const isPartialLength = mode === "length" && qtyInStockUnit < available - 1e-9;
  const movType = isPartialLength ? "partial_out" : "out_to_job";

  const itemPatch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  let remainderItemId: string | null = null;
  if (mode === "length") {
    if (item.originalLength == null && Number.isFinite(available)) {
      itemPatch.originalLength = available;
    }
    if (isPartialLength) {
      itemPatch.quantity = newAvailable;
      itemPatch.currentLength = newAvailable;
      itemPatch.remainingQuantity = newAvailable;
      remainderItemId = null;
    } else {
      itemPatch.quantity = 0;
      itemPatch.currentLength = 0;
      itemPatch.remainingQuantity = 0;
    }
  } else {
    itemPatch.quantity = newAvailable;
  }

  if (item.isRemainder === true && newAvailable <= 1e-9) {
    itemPatch.remainderFullyConsumed = true;
    itemPatch.remainderAvailable = false;
    itemPatch.remainderStatus = "used";
    itemPatch.remainingQuantity = 0;
    itemPatch.currentLength = 0;
    itemPatch.quantity = 0;
  }

  tx.update(itemRef, itemPatch as UpdateData<DocumentData>);

  tx.set(movRef, {
    companyId,
    type: movType,
    itemId,
    itemName,
    quantity: qtyInStockUnit,
    unit,
    date: today,
    note: note || null,
    jobId,
    jobName,
    employeeId: callerEmployeeId,
    quantityBefore: available,
    quantityAfter: mode === "length" ? (isPartialLength ? newAvailable : 0) : newAvailable,
    remainderItemId,
    batchNumber: batchNumber || null,
    destination: `job:${jobId}`,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: callerUid,
  });

  if (remainderItemId) {
    const remMovRef = db.collection("companies").doc(companyId).collection("inventoryMovements").doc();
    tx.set(remMovRef, {
      companyId,
      type: "remainder_created",
      itemId: remainderItemId,
      itemName,
      quantity: newAvailable,
      unit,
      date: today,
      note: `Zbytek po výdeji na zakázku ${jobId}`,
      jobId,
      jobName,
      employeeId: callerEmployeeId,
      quantityBefore: 0,
      quantityAfter: newAvailable,
      batchNumber: batchNumber || null,
      destination: `remainder_of:${itemId}`,
      parentSourceItemId: itemId,
      sourceMovementId: movementId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
    });
  }

  const consRef = db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("materialConsumptions")
    .doc();
  const parentTrace =
    typeof item.remainderOfItemId === "string" && String(item.remainderOfItemId).trim()
      ? String(item.remainderOfItemId).trim()
      : typeof item.parentStockItemId === "string" && String(item.parentStockItemId).trim()
        ? String(item.parentStockItemId).trim()
        : null;

  const consumptionBase: Record<string, unknown> = {
    companyId,
    jobId,
    jobName,
    productionJobId: jobId,
    inventoryItemId: itemId,
    stockItemId: itemId,
    sourceStockItemId: itemId,
    parentStockItemId: parentTrace,
    itemName,
    quantity: qtyInStockUnit,
    quantityUsed: qtyInStockUnit,
    quantityIssued: qtyInStockUnit,
    quantityBeforeOnHand: available,
    originalQuantity: available,
    remainingQuantityAfterCut: newAvailable,
    unit,
    inputLengthUnit: inputLengthUnit || null,
    repeatCount,
    perCutQuantityStockUnit: mode === "length" ? perCutStockUnit : null,
    movementId,
    sourceStockMovementId: movementId,
    employeeId: callerEmployeeId,
    authUserId: callerUid,
    createdByName,
    note: note || null,
    batchNumber: batchNumber || null,
    quantityRemainingOnStock: newAvailable,
    remainderCreated: remainderItemId != null,
    remainderItemId,
    remainderId: remainderItemId,
    stockTrackingMode: mode,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (consumptionExtras && Object.keys(consumptionExtras).length > 0) {
    Object.assign(consumptionBase, consumptionExtras);
  }

  tx.set(consRef, consumptionBase);

  return {
    movementId,
    consumptionId: consRef.id,
    quantityAfter: newAvailable,
    remainderItemId,
    unit,
  };
}
