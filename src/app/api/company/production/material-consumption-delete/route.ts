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

async function requirePrivileged(caller: { role: string; globalRoles: string[] }) {
  if (!isCompanyPrivileged(caller.role, caller.globalRoles)) {
    return { ok: false as const, status: 403, error: "Jen admin / vedení může mazat spotřebu." };
  }
  return { ok: true as const };
}

/**
 * Admin smazání spotřeby (transakce: vrátit na sklad + smazat spotřebu + auditní pohyb).
 * Pro délkové výdeje se zbytkem (remainderCreated) se mazání blokuje.
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

      const remainderCreated = cons.remainderCreated === true;
      if (mode === "length" && remainderCreated) {
        throw new Error("Tento výdej vytvořil zbytek — mazání nelze bezpečně provést. Použijte ruční opravu ve skladu.");
      }

      const stockItemId =
        (typeof cons.stockItemId === "string" && cons.stockItemId.trim()
          ? cons.stockItemId.trim()
          : typeof cons.inventoryItemId === "string" && cons.inventoryItemId.trim()
            ? cons.inventoryItemId.trim()
            : "") || "";
      if (!stockItemId) throw new Error("Spotřeba nemá stockItemId.");

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
      const nextAvailable = available + qty;
      if (mode === "length") {
        tx.update(itemRef, {
          quantity: nextAvailable,
          currentLength: nextAvailable,
          remainderFullyConsumed: false,
          remainderAvailable: true,
          remainderStatus: item.isRemainder === true ? "free" : item.remainderStatus ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.update(itemRef, {
          quantity: nextAvailable,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // auditní návrat na sklad
      const movRef = db
        .collection("companies")
        .doc(caller.companyId)
        .collection("inventoryMovements")
        .doc();
      const today = new Date().toISOString().slice(0, 10);
      const unit = typeof cons.unit === "string" && cons.unit.trim() ? cons.unit.trim() : String(item.unit || "ks");
      const itemName = typeof cons.itemName === "string" && cons.itemName.trim() ? cons.itemName.trim() : String(item.name || stockItemId);
      tx.set(movRef, {
        companyId: caller.companyId,
        type: "admin_adjustment",
        itemId: stockItemId,
        itemName,
        quantity: qty,
        unit,
        date: today,
        note: `Storno spotřeby na zakázce ${jobId} (smazání záznamu spotřeby)`,
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

      return { ok: true };
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Smazání se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

