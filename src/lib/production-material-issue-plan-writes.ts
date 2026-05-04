/**
 * CALCULATE fáze: z pracovního stavu vytvoří seznam zápisů (bez DB read/write).
 */
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData, Firestore, UpdateData } from "firebase-admin/firestore";
import { lengthToMillimeters, millimetersToUnit } from "@/lib/job-production-settings";
import type { InventoryStockTrackingMode } from "@/lib/inventory-types";
import { countPiecesByStatus, planLengthAllocation, sumUsableRemainingMm } from "@/lib/stock-pieces";
import {
  materialShortageError,
  type BulkMaterialWorkState,
  type IssueWriteOp,
  type MaterialIssueCutAllocation,
  type MaterialIssueInTxContext,
  type MaterialIssueInTxOptions,
  type MaterialIssueInTxParams,
  type MaterialIssueInTxResult,
} from "@/lib/production-material-work-state";

function trackingModeOf(raw: unknown, unit: string): InventoryStockTrackingMode {
  const m = String(raw || "").trim();
  if (m === "length" || m === "area" || m === "mass" || m === "generic" || m === "pieces") {
    return m;
  }
  return "pieces";
}

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

/** Jedna řádka výdeje → výsledek + zápisy (WRITE fáze je `applyIssueOps`). */
export function planMaterialIssueWritesFromState(
  state: BulkMaterialWorkState,
  ctx: MaterialIssueInTxContext,
  input: MaterialIssueInTxParams,
  options: MaterialIssueInTxOptions | undefined,
  db: Firestore
): { result: MaterialIssueInTxResult; ops: IssueWriteOp[] } {
  const { companyId, jobId, jobName, callerUid, callerEmployeeId, createdByName } = ctx;
  const {
    itemId,
    quantity: qtyRaw,
    inputLengthUnit,
    note,
    batchNumber,
    consumptionExtras,
  } = input;
  const repeatCount = parseRepeatCount(input.repeatCount ?? 1);
  const ops: IssueWriteOp[] = [];

  const item = state.getItemData(itemId);
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

  const useStockPieces = mode === "length" && state.getPiecesForPlan(itemId, options).length > 0;

  if (useStockPieces) {
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

    const plans = state.getPiecesForPlan(itemId, options);
    const usableSum = sumUsableRemainingMm(plans);
    if (totalNeedMm > usableSum + 1e-6) {
      throw materialShortageError(item, itemId);
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
      state.applyPieceChunk(ch.pieceId, ch.remainingAfterMm, ch.newStatus);
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
    const stats = countPiecesByStatus(state.getPiecesForPlan(itemId, undefined));
    itemPatch.stockPieceStats = stats;
    itemPatch.pieceCount = stats.total;

    state.patchItem(itemId, {
      quantity: newAvailable,
      currentLength: newAvailable,
      remainingQuantity: newAvailable,
      ...(item.originalLength == null && Number.isFinite(available) ? { originalLength: available } : {}),
      stockPieceStats: stats,
      pieceCount: stats.total,
    });

    const itemRef = state.itemRef(itemId);
    ops.push({ kind: "update", ref: itemRef, data: itemPatch as UpdateData<DocumentData> });

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
      ops.push({
        kind: "update",
        ref: pRef,
        data: {
          remainingLength: ch.remainingAfterMm,
          status: ch.newStatus,
        } as UpdateData<DocumentData>,
      });

      const cutRef = db.collection("companies").doc(companyId).collection("stockCuts").doc();
      cutIds.push(cutRef.id);
      allocations.push({
        pieceId: ch.pieceId,
        usedLengthMm: ch.takeMm,
        remainingAfterMm: ch.remainingAfterMm,
      });
      ops.push({
        kind: "set",
        ref: cutRef,
        data: {
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
        },
      });
    }

    ops.push({
      kind: "set",
      ref: movRef,
      data: {
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
      },
    });

    const parentTrace =
      typeof item.remainderOfItemId === "string" && String(item.remainderOfItemId).trim()
        ? String(item.remainderOfItemId).trim()
        : typeof item.parentStockItemId === "string" && String(item.parentStockItemId).trim()
          ? String(item.parentStockItemId).trim()
          : null;

    const usedStockPieceIds = allocations.map((a) => a.pieceId);

    const consumptionBase: Record<string, unknown> = {
      organizationId: companyId,
      companyId,
      jobId,
      jobName,
      productionJobId: jobId,
      inventoryItemId: itemId,
      materialId: itemId,
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
      issuedBy: callerUid,
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
      usedStockPieceIds,
      cuts: allocations,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (consumptionExtras && Object.keys(consumptionExtras).length > 0) {
      Object.assign(consumptionBase, consumptionExtras);
    }

    ops.push({ kind: "set", ref: consRef, data: consumptionBase });

    return {
      result: {
        movementId,
        consumptionId: consRef.id,
        quantityAfter: newAvailable,
        remainderItemId: null,
        unit,
        cutIds,
        allocations,
      },
      ops,
    };
  }

  if (qtyInStockUnit > available + 1e-9) {
    throw materialShortageError(item, itemId);
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

  {
    const { updatedAt: _ts, ...mem } = itemPatch;
    void _ts;
    state.patchItem(itemId, mem as Record<string, unknown>);
  }

  const itemRef = state.itemRef(itemId);
  ops.push({ kind: "update", ref: itemRef, data: itemPatch as UpdateData<DocumentData> });

  ops.push({
    kind: "set",
    ref: movRef,
    data: {
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
    },
  });

  if (remainderItemId) {
    const remMovRef = db.collection("companies").doc(companyId).collection("inventoryMovements").doc();
    ops.push({
      kind: "set",
      ref: remMovRef,
      data: {
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
      },
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
    organizationId: companyId,
    companyId,
    jobId,
    jobName,
    productionJobId: jobId,
    inventoryItemId: itemId,
    materialId: itemId,
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
    issuedBy: callerUid,
    createdByName,
    note: note || null,
    batchNumber: batchNumber || null,
    quantityRemainingOnStock: newAvailable,
    remainderCreated: remainderItemId != null,
    remainderItemId,
    remainderId: remainderItemId,
    stockTrackingMode: mode,
    usedStockPieceIds: [],
    cuts: [],
    createdAt: FieldValue.serverTimestamp(),
  };

  if (consumptionExtras && Object.keys(consumptionExtras).length > 0) {
    Object.assign(consumptionBase, consumptionExtras);
  }

  ops.push({ kind: "set", ref: consRef, data: consumptionBase });

  return {
    result: {
      movementId,
      consumptionId: consRef.id,
      quantityAfter: newAvailable,
      remainderItemId,
      unit,
    },
    ops,
  };
}
