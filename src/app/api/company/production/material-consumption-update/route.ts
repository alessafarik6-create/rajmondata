import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { isCompanyPrivileged, verifyCompanyBearer } from "@/lib/api-company-auth";

type Body = {
  jobId?: string;
  consumptionId?: string;
  quantity?: number;
  note?: string | null;
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

async function requirePrivileged(caller: { role: string; globalRoles: string[] }) {
  if (!isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return { ok: false as const, status: 403, error: "Jen admin / vedení může upravovat spotřebu." };
  }
  return { ok: true as const };
}

/**
 * Admin úprava spotřeby materiálu (transakce: spotřeba + skladová položka).
 * Pozn.: pro složité scénáře délkových položek se zbytkem je úprava zablokována (použijte storno + nový výdej).
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
  const qtyRaw = body.quantity;
  const note = body.note != null ? String(body.note).trim().slice(0, 2000) : "";

  if (!jobId || !consumptionId) {
    return NextResponse.json({ error: "Chybí jobId nebo consumptionId." }, { status: 400 });
  }
  if (typeof qtyRaw !== "number" || !Number.isFinite(qtyRaw) || qtyRaw <= 0) {
    return NextResponse.json({ error: "Zadejte kladné množství." }, { status: 400 });
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

      const stockItemId =
        (typeof cons.stockItemId === "string" && cons.stockItemId.trim()
          ? cons.stockItemId.trim()
          : typeof cons.inventoryItemId === "string" && cons.inventoryItemId.trim()
            ? cons.inventoryItemId.trim()
            : "") || "";
      if (!stockItemId) throw new Error("Spotřeba nemá stockItemId.");

      const mode = trackingModeOf(cons.stockTrackingMode);
      const oldQty = Number(cons.quantity ?? cons.quantityUsed ?? 0);
      if (!Number.isFinite(oldQty) || oldQty <= 0) throw new Error("Spotřeba má neplatné množství.");

      const remainderCreated = cons.remainderCreated === true;
      if (mode === "length" && remainderCreated) {
        throw new Error("Tento výdej vytvořil zbytek — úpravu nelze bezpečně provést. Použijte storno a nový výdej.");
      }

      const delta = qtyRaw - oldQty;
      if (Math.abs(delta) <= 1e-9) {
        tx.update(consRef, {
          note: note || null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.uid,
        });
        return { ok: true, newQuantity: oldQty };
      }

      if (mode === "pieces" && (!Number.isInteger(qtyRaw) || !Number.isInteger(oldQty))) {
        throw new Error("U kusové evidence musí být množství celé číslo.");
      }

      if (mode === "length" && delta > 1e-9) {
        throw new Error("Nelze navýšit délkovou spotřebu úpravou — proveďte nový výdej.");
      }

      const itemRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("inventoryItems")
        .doc(stockItemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) throw new Error("Skladová položka neexistuje.");
      const item = itemSnap.data() as Record<string, unknown>;
      if (item.isDeleted === true) throw new Error("Skladová položka byla odstraněna.");

      const available = getAvailableForItem(item, mode);
      if (delta > 1e-9 && delta > available + 1e-9) {
        throw new Error("Na skladě není dostatek materiálu pro navýšení spotřeby.");
      }

      // delta>0 => odebrat víc (snížit sklad), delta<0 => vrátit na sklad
      const nextAvailable = available - delta;
      if (nextAvailable < -1e-9) throw new Error("Úprava by vedla k zápornému stavu skladu.");

      if (mode === "length") {
        tx.update(itemRef, {
          quantity: nextAvailable,
          currentLength: nextAvailable,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.update(itemRef, {
          quantity: nextAvailable,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(consRef, {
        quantity: qtyRaw,
        quantityUsed: qtyRaw,
        quantityIssued: qtyRaw,
        note: note || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      });

      return { ok: true, newQuantity: qtyRaw };
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Uložení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

