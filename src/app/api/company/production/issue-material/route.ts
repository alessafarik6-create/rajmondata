import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentData, Firestore, UpdateData } from "firebase-admin/firestore";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import {
  employeeAssignedToJobProduction,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";
import type { InventoryStockTrackingMode } from "@/lib/inventory-types";

type Body = {
  jobId?: string;
  itemId?: string;
  quantity?: number;
  note?: string | null;
  batchNumber?: string | null;
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
  if (caller.role !== "employee" || !caller.employeeId) {
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

  const perm = await canIssueMaterial({ db, companyId: caller.companyId, caller, jobId });
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

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

      const unit = String(item.unit || "ks").trim() || "ks";
      const mode = trackingModeOf(item.stockTrackingMode, unit);
      const stockQty = Number(item.quantity ?? 0);
      let available = stockQty;
      if (mode === "length") {
        const cur = item.currentLength;
        available = cur != null && Number.isFinite(Number(cur)) ? Number(cur) : stockQty;
      }

      if (qtyRaw > available + 1e-9) {
        throw new Error("Na skladě není dostatek materiálu.");
      }

      if (mode === "pieces") {
        if (!Number.isInteger(qtyRaw)) {
          throw new Error("U kusové evidence odeberte celý počet kusů.");
        }
      }

      const newAvailable = available - qtyRaw;
      const movRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("inventoryMovements")
        .doc();
      const movementId = movRef.id;

      const itemName = String(item.name || itemId);
      const today = new Date().toISOString().slice(0, 10);
      const isPartialLength = mode === "length" && qtyRaw < available - 1e-9;
      const movType = isPartialLength ? "partial_out" : "out_to_job";

      const itemPatch: Record<string, unknown> = {
        quantity: mode === "length" ? newAvailable : newAvailable,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (mode === "length") {
        itemPatch.currentLength = newAvailable;
        if (item.originalLength == null && Number.isFinite(available)) {
          itemPatch.originalLength = available;
        }
      }

      tx.update(itemRef, itemPatch as UpdateData<DocumentData>);

      tx.set(movRef, {
        companyId: caller.companyId,
        type: movType,
        itemId,
        itemName,
        quantity: qtyRaw,
        unit,
        date: today,
        note: note || null,
        jobId,
        jobName,
        employeeId: caller.employeeId,
        quantityBefore: available,
        quantityAfter: newAvailable,
        batchNumber: batchNumber || null,
        destination: `job:${jobId}`,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      const consRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("jobs")
        .doc(jobId)
        .collection("materialConsumptions")
        .doc();
      tx.set(consRef, {
        companyId: caller.companyId,
        jobId,
        jobName,
        inventoryItemId: itemId,
        itemName,
        quantity: qtyRaw,
        unit,
        movementId,
        employeeId: caller.employeeId,
        authUserId: caller.uid,
        note: note || null,
        batchNumber: batchNumber || null,
        quantityRemainingOnStock: newAvailable,
        stockTrackingMode: mode,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        movementId,
        consumptionId: consRef.id,
        quantityAfter: newAvailable,
        unit,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Výdej se nezdařil.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
