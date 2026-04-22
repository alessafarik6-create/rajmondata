import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData, Firestore, UpdateData } from "firebase-admin/firestore";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  employeeAssignedToJobProduction,
  lengthToMillimeters,
  millimetersToUnit,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";
import type { InventoryStockTrackingMode } from "@/lib/inventory-types";

type Body = {
  jobId?: string;
  itemId?: string;
  quantity?: number;
  note?: string | null;
  batchNumber?: string | null;
  /** U délkových materiálů: jednotka vstupu (převod na skladovou jednotku položky). */
  inputLengthUnit?: "mm" | "cm" | "m" | null;
};

function trackingModeOf(
  raw: unknown,
  unit: string
): InventoryStockTrackingMode {
  const m = String(raw || "").trim();
  if (m === "length" || m === "area" || m === "mass" || m === "generic" || m === "pieces") {
    return m;
  }
  /** Zpětná kompatibilita: bez explicitního režimu = kusy. */
  return "pieces";
}

async function canIssueMaterial(params: {
  db: Firestore;
  companyId: string;
  caller: { role: string; employeeId: string | null; globalRoles: string[] };
  jobId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { db, companyId, caller, jobId } = params;
  if (isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return { ok: true };
  }
  if (!isCompanyEmployeeRole(caller.role) || !caller.employeeId) {
    return { ok: false, status: 403, error: "Nemáte oprávnění k výdeji materiálu." };
  }
  const empSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("employees")
    .doc(caller.employeeId)
    .get();
  const emp = empSnap.data() as Record<string, unknown> | undefined;
  if (!empSnap.exists || emp?.canAccessProduction !== true) {
    return {
      ok: false,
      status: 403,
      error: "V účtu nemáte aktivní přístup k modulu Výroba.",
    };
  }
  const jobSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .get();
  if (!jobSnap.exists) {
    return { ok: false, status: 404, error: "Zakázka neexistuje." };
  }
  const settings = parseJobProductionSettings(jobSnap.data() as Record<string, unknown>);
  if (!employeeAssignedToJobProduction(settings, caller.employeeId)) {
    return {
      ok: false,
      status: 403,
      error: "Nejste přiřazeni k výrobě této zakázky.",
    };
  }
  return { ok: true };
}

/**
 * Výdej materiálu ze skladu na zakázku (transakce: sklad + pohyb + spotřeba).
 */
export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId || "").trim();
  const itemId = String(body.itemId || "").trim();
  const qtyRaw = body.quantity;
  if (!jobId || !itemId || typeof qtyRaw !== "number" || !Number.isFinite(qtyRaw) || qtyRaw <= 0) {
    return NextResponse.json(
      { error: "Vyplňte platné jobId, itemId a kladné množství." },
      { status: 400 }
    );
  }

  const inputLenRaw = body.inputLengthUnit;
  const inputLengthUnit: "mm" | "cm" | "m" | null =
    inputLenRaw === "mm" || inputLenRaw === "cm" || inputLenRaw === "m" ? inputLenRaw : null;

  const perm = await canIssueMaterial({ db, companyId: caller.companyId, caller, jobId });
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

  const userSnap = await db.collection("users").doc(caller.uid).get();
  const u = userSnap.data() as Record<string, unknown> | undefined;
  const createdByName =
    (typeof u?.displayName === "string" && u.displayName.trim()
      ? u.displayName.trim()
      : null) ||
    (typeof u?.email === "string" && u.email.includes("@")
      ? String(u.email).split("@")[0]
      : null) ||
    caller.uid;

  const jobSnap = await db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .doc(jobId)
    .get();
  const jobData = jobSnap.data() as Record<string, unknown> | undefined;
  const jobName =
    jobData && typeof jobData.name === "string" && jobData.name.trim()
      ? jobData.name.trim()
      : jobId;

  const note = body.note != null ? String(body.note).trim().slice(0, 2000) : "";
  const batchNumber =
    body.batchNumber != null ? String(body.batchNumber).trim().slice(0, 120) : "";

  try {
    const result = await db.runTransaction(async (tx) => {
      const itemRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("inventoryItems")
        .doc(itemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) throw new Error("Skladová položka neexistuje.");
      const item = itemSnap.data() as Record<string, unknown>;
      if (item.isDeleted === true) throw new Error("Položka byla odstraněna.");
      if (String(item.companyId || "") !== caller.companyId) {
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

      let qtyInStockUnit = qtyRaw;
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
        qtyInStockUnit = conv;
      }

      if (qtyInStockUnit > available + 1e-9) {
        throw new Error("Na skladě není dostatek materiálu.");
      }

      if (mode === "pieces") {
        if (!Number.isInteger(qtyInStockUnit)) {
          throw new Error("U kusové evidence odeberte celý počet kusů.");
        }
      }

      if (mode === "length" && qtyInStockUnit <= 0) {
        throw new Error("U délkového materiálu zadejte kladnou délku.");
      }

      const newAvailable = available - qtyInStockUnit;
      const movRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("inventoryMovements")
        .doc();
      const movementId = movRef.id;

      const itemName = String(item.name || itemId);
      const today = new Date().toISOString().slice(0, 10);
      const isPartialLength = mode === "length" && qtyInStockUnit < available - 1e-9;
      const movType = isPartialLength ? "partial_out" : "out_to_job";

      /**
       * Délkové položky chápeme jako konkrétní „kus materiálu“ (např. tyč 6000mm).
       * Při částečném výdeji nesmí zmizet celý kus — místo toho:
       * - původní položku vynulujeme (kus byl „rozřezán / vydán“),
       * - vytvoříme novou skladovou položku jako zbytek (remainder) se zbývající délkou,
       * - zapíšeme dva pohyby: `partial_out` + `remainder_created`.
       */
      const itemPatch: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };

      let remainderItemId: string | null = null;
      if (mode === "length") {
        // spotřebovaná část vyjde na zakázku; původní kus se tímto „uzavře“
        itemPatch.quantity = 0;
        itemPatch.currentLength = 0;
        if (item.originalLength == null && Number.isFinite(available)) {
          itemPatch.originalLength = available;
        }

        if (isPartialLength) {
          const remRef = db
            .collection("companies")
            .doc(caller.companyId)
            .collection("inventoryItems")
            .doc();
          remainderItemId = remRef.id;
          const loc =
            typeof item.warehouseLocation === "string" ? item.warehouseLocation : null;
          const sku = typeof item.sku === "string" ? item.sku : null;
          const cat =
            typeof item.materialCategory === "string" ? item.materialCategory : null;
          const supplier = typeof item.supplier === "string" ? item.supplier : null;
          const noteR =
            typeof item.note === "string" ? item.note : null;
          const img = typeof item.imageUrl === "string" ? item.imageUrl : null;

          tx.set(remRef, {
            companyId: caller.companyId,
            name: itemName,
            sku,
            materialCategory: cat,
            unit,
            quantity: newAvailable,
            stockTrackingMode: "length",
            measurementType: "length",
            /** Délka řádku po řezu (stejné významy jako currentLength u length režimu). */
            originalLength: newAvailable,
            originalQuantity: available,
            remainingQuantity: newAvailable,
            currentLength: newAvailable,
            lengthStockUnit:
              typeof item.lengthStockUnit === "string"
                ? item.lengthStockUnit
                : unit,
            parentStockItemId: itemId,
            isRemainder: true,
            remainderOfItemId: itemId,
            consumedByJobId: jobId,
            remainderAvailable: true,
            remainderFullyConsumed: false,
            remainderStatus: "free",
            warehouseLocation: loc,
            reservedForJobId: null,
            supplier,
            imageUrl: img,
            note: noteR,
            sourceStockMovementId: movementId,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: caller.uid,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        // kusy / ostatní režimy: chování kompatibilní se stávajícím skladem
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
        companyId: caller.companyId,
        type: movType,
        itemId,
        itemName,
        quantity: qtyInStockUnit,
        unit,
        date: today,
        note: note || null,
        jobId,
        jobName,
        employeeId: caller.employeeId,
        quantityBefore: available,
        quantityAfter: mode === "length" ? 0 : newAvailable,
        remainderItemId,
        batchNumber: batchNumber || null,
        destination: `job:${jobId}`,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      if (remainderItemId) {
        const remMovRef = db
          .collection("companies")
          .doc(caller.companyId)
          .collection("inventoryMovements")
          .doc();
        tx.set(remMovRef, {
          companyId: caller.companyId,
          type: "remainder_created",
          itemId: remainderItemId,
          itemName,
          quantity: newAvailable,
          unit,
          date: today,
          note: `Zbytek po výdeji na zakázku ${jobId}`,
          jobId,
          jobName,
          employeeId: caller.employeeId,
          quantityBefore: 0,
          quantityAfter: newAvailable,
          batchNumber: batchNumber || null,
          destination: `remainder_of:${itemId}`,
          parentSourceItemId: itemId,
          sourceMovementId: movementId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: caller.uid,
        });
      }

      const consRef = db
        .collection("companies")
        .doc(caller.companyId)
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

      tx.set(consRef, {
        companyId: caller.companyId,
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
        remainingQuantityAfterCut: remainderItemId ? newAvailable : mode === "length" ? 0 : newAvailable,
        unit,
        inputLengthUnit: inputLengthUnit || null,
        movementId,
        sourceStockMovementId: movementId,
        employeeId: caller.employeeId,
        authUserId: caller.uid,
        createdByName,
        note: note || null,
        batchNumber: batchNumber || null,
        quantityRemainingOnStock: remainderItemId ? newAvailable : mode === "length" ? 0 : newAvailable,
        remainderCreated: remainderItemId != null,
        remainderItemId,
        remainderId: remainderItemId,
        stockTrackingMode: mode,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        movementId,
        consumptionId: consRef.id,
        quantityAfter: remainderItemId ? newAvailable : mode === "length" ? 0 : newAvailable,
        remainderItemId,
        unit,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Výdej se nezdařil.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
