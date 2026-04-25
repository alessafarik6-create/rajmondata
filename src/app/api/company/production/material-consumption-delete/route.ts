import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { isCompanyPrivileged, verifyCompanyBearer } from "@/lib/api-company-auth";

type Body = {
  jobId?: string;
  consumptionId?: string;
};

function trackingModeOf(raw: unknown): "pieces" | "length" | "area" | "mass" | "generic" {
  const m = String(raw || "").trim();
  if (m === "length" || m === "area" || m === "mass" || m === "generic" || m === "pieces") return m;
  return "pieces";
}

function getAvailableForItem(item: Record<string, unknown>, mode: string): number {
  const qty = Number(item.quantity ?? 0);
  if (mode === "length") {
    const cur = item.currentLength;
    const asNum = cur != null && Number.isFinite(Number(cur)) ? Number(cur) : qty;
    return asNum;
  }
  return qty;
}

function remainderIdOf(cons: Record<string, unknown>): string {
  const a =
    typeof cons.remainderItemId === "string" && cons.remainderItemId.trim()
      ? cons.remainderItemId.trim()
      : typeof cons.remainderId === "string" && cons.remainderId.trim()
        ? cons.remainderId.trim()
        : "";
  return a;
}

async function requirePrivileged(caller: { role: string; globalRoles: string[] }) {
  if (!isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return { ok: false as const, status: 403, error: "Jen admin / vedení může mazat spotřebu." };
  }
  return { ok: true as const };
}

/**
 * Admin smazání spotřeby (transakce: obnovit sklad + smazat zbytek je-li + smazat spotřeba + auditní pohyb).
 * Zahrnuje i výdeje se zbytkem (partial length) — cílový stav odpovídá řádku před výdejem.
 */
export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  const perm = await requirePrivileged(caller);
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "").trim();
  const consumptionId = String(body.consumptionId ?? "").trim();
  if (!jobId || !consumptionId) {
    return NextResponse.json({ error: "Chybí jobId nebo consumptionId." }, { status: 400 });
  }

  try {
    const result = await (db as Firestore).runTransaction(async (tx) => {
      const consRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("jobs")
        .doc(jobId)
        .collection("materialConsumptions")
        .doc(consumptionId);
      const consSnap = await tx.get(consRef);
      if (!consSnap.exists) throw new Error("Záznam spotřeby neexistuje.");
      const cons = consSnap.data() as Record<string, unknown>;

      const mode = trackingModeOf(cons.stockTrackingMode);
      const qty = Number(cons.quantity ?? cons.quantityUsed ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("Spotřeba má neplatné množství.");
      if (mode === "pieces" && !Number.isInteger(qty)) {
        throw new Error("U kusové evidence musí být množství celé číslo.");
      }

      const primaryId =
        (typeof cons.stockItemId === "string" && cons.stockItemId.trim()
          ? cons.stockItemId.trim()
          : typeof cons.inventoryItemId === "string" && cons.inventoryItemId.trim()
            ? cons.inventoryItemId.trim()
            : "") || "";
      if (!primaryId) throw new Error("Spotřeba nemá vazbu na skladovou položku.");

      const remainderCreated = cons.remainderCreated === true;
      const remainderId = remainderIdOf(cons);
      const beforeOnHand = Number(cons.quantityBeforeOnHand ?? cons.originalQuantity ?? NaN);

      const itemCol = db.collection("companies").doc(caller.companyId).collection("inventoryItems");
      const primaryRef = itemCol.doc(primaryId);
      const primarySnap = await tx.get(primaryRef);
      if (!primarySnap.exists) throw new Error("Skladová položka neexistuje.");
      const primary = primarySnap.data() as Record<string, unknown>;
      if (primary.isDeleted === true) throw new Error("Skladová položka byla odstraněna.");

      const unit =
        typeof cons.unit === "string" && cons.unit.trim() ? cons.unit.trim() : String(primary.unit || "ks");
      const itemName =
        typeof cons.itemName === "string" && cons.itemName.trim()
          ? cons.itemName.trim()
          : String(primary.name || primaryId);

      let warnings: string[] = [];

      if (mode === "length" && remainderCreated && remainderId) {
        const remRef = itemCol.doc(remainderId);
        const remSnap = await tx.get(remRef);
        let merged: number;
        if (remSnap.exists) {
          const rem = remSnap.data() as Record<string, unknown>;
          if (rem.isDeleted === true) {
            warnings.push("Zbytek byl ve skladu označen jako smazaný — použita záložní obnova z předchozího stavu.");
            merged =
              Number.isFinite(beforeOnHand) && beforeOnHand >= 0 ? beforeOnHand : getAvailableForItem(primary, "length") + qty;
          } else {
            merged = getAvailableForItem(rem, "length") + qty;
          }
          tx.delete(remRef);
        } else {
          if (Number.isFinite(beforeOnHand) && beforeOnHand >= 0) {
            merged = beforeOnHand;
            warnings.push("Záznam zbytku ve skladu už neexistoval — obnovena původní délka z předvýdejového údaje.");
          } else {
            merged = qty;
            warnings.push("Chybí zbytek i předchozí stav — vráceno alespoň spotřebované množství.");
          }
        }

        const lenUnit =
          typeof primary.lengthStockUnit === "string" && primary.lengthStockUnit.trim()
            ? primary.lengthStockUnit.trim()
            : unit;

        tx.update(primaryRef, {
          quantity: merged,
          currentLength: merged,
          originalLength: Number.isFinite(beforeOnHand) && beforeOnHand > 0 ? beforeOnHand : merged,
          lengthStockUnit: lenUnit,
          stockTrackingMode: "length",
          measurementType: "length",
          isRemainder: false,
          remainderOfItemId: null,
          parentStockItemId: null,
          consumedByJobId: null,
          remainderAvailable: null,
          remainderFullyConsumed: false,
          remainderStatus: null,
          remainingQuantity: null,
          sourceStockMovementId: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (mode === "length" && !remainderCreated) {
        const restore =
          Number.isFinite(beforeOnHand) && beforeOnHand >= 0 ? beforeOnHand : getAvailableForItem(primary, "length") + qty;
        const lenUnit =
          typeof primary.lengthStockUnit === "string" && primary.lengthStockUnit.trim()
            ? primary.lengthStockUnit.trim()
            : unit;
        tx.update(primaryRef, {
          quantity: restore,
          currentLength: restore,
          originalLength: restore,
          lengthStockUnit: lenUnit,
          stockTrackingMode: "length",
          measurementType: "length",
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const available = getAvailableForItem(primary, mode);
        const nextAvailable = available + qty;
        if (mode === "length") {
          tx.update(primaryRef, {
            quantity: nextAvailable,
            currentLength: nextAvailable,
            remainderFullyConsumed: false,
            remainderAvailable: true,
            remainderStatus: primary.isRemainder === true ? "free" : primary.remainderStatus ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          tx.update(primaryRef, {
            quantity: nextAvailable,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const movRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("inventoryMovements")
        .doc();
      const today = new Date().toISOString().slice(0, 10);
      tx.set(movRef, {
        companyId: caller.companyId,
        type: "admin_adjustment",
        itemId: primaryId,
        itemName,
        quantity: qty,
        unit,
        date: today,
        note:
          remainderCreated && remainderId
            ? `Storno spotřeby zakázka ${jobId}: vráceno včetně sloučení se zbytkem (${remainderId})`
            : `Storno spotřeby na zakázce ${jobId} (smazání záznamu spotřeby)`,
        adjustmentDelta: qty,
        destination: `job:${jobId}`,
        jobId,
        jobName: typeof cons.jobName === "string" ? cons.jobName : null,
        employeeId: typeof cons.employeeId === "string" ? cons.employeeId : null,
        sourceMovementId: typeof cons.movementId === "string" ? cons.movementId : null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: caller.uid,
      });

      tx.delete(consRef);

      return { ok: true, warnings };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[material-consumption-delete]", e);
    const msg = e instanceof Error ? e.message : "Smazání se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
