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
    return { ok: false as const, status: 403, error: "Jen admin / vedení může upravovat spotřebu." };
  }
  return { ok: true as const };
}

/**
 * Admin úprava spotřeby (transakce).
 * U výdeje se zbytkem se mění množství na řádku zbytku (původní tyč zůstává na 0).
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

      const primaryId =
        (typeof cons.stockItemId === "string" && cons.stockItemId.trim()
          ? cons.stockItemId.trim()
          : typeof cons.inventoryItemId === "string" && cons.inventoryItemId.trim()
            ? cons.inventoryItemId.trim()
            : "") || "";
      if (!primaryId) throw new Error("Spotřeba nemá vazbu na skladovou položku.");

      const mode = trackingModeOf(cons.stockTrackingMode);
      const oldQty = Number(cons.quantity ?? cons.quantityUsed ?? 0);
      if (!Number.isFinite(oldQty) || oldQty <= 0) throw new Error("Spotřeba má neplatné množství.");

      const delta = qtyRaw - oldQty;
      const warnings: string[] = [];

      if (Math.abs(delta) <= 1e-9) {
        tx.update(consRef, {
          note: note || null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.uid,
        });
        return { ok: true, newQuantity: oldQty, warnings };
      }

      if (mode === "pieces" && (!Number.isInteger(qtyRaw) || !Number.isInteger(oldQty))) {
        throw new Error("U kusové evidence musí být množství celé číslo.");
      }

      const itemCol = db.collection("companies").doc(caller.companyId).collection("inventoryItems");
      const primaryRef = itemCol.doc(primaryId);
      const primarySnap = await tx.get(primaryRef);
      if (!primarySnap.exists) throw new Error("Skladová položka neexistuje.");
      const primary = primarySnap.data() as Record<string, unknown>;
      if (primary.isDeleted === true) throw new Error("Skladová položka byla odstraněna.");

      const remainderCreated = cons.remainderCreated === true;
      const remainderId = remainderIdOf(cons);

      if (mode === "length" && remainderCreated && remainderId) {
        const remRef = itemCol.doc(remainderId);
        const remSnap = await tx.get(remRef);
        const remDeletedOrMissing = !remSnap.exists || (remSnap.data() as Record<string, unknown> | undefined)?.isDeleted === true;
        if (remDeletedOrMissing) {
          if (remSnap.exists) {
            warnings.push(
              "Zbytek je ve skladu označen jako odstraněný — úprava se aplikuje na původní řádku (kontrola záporného stavu)."
            );
          } else {
            warnings.push(
              "Zbytek ve skladu chybí — úprava množství se aplikuje na původní skladovou řádku (může se lišit od ideálního stavu po řezu)."
            );
          }
          const available = getAvailableForItem(primary, mode);
          if (delta > 1e-9 && delta > available + 1e-9) {
            throw new Error("Na skladě není dostatek materiálu pro navýšení spotřeby.");
          }
          const nextAvailable = available - delta;
          if (nextAvailable < -1e-9) throw new Error("Úprava by vedla k zápornému stavu skladu.");
          tx.update(primaryRef, {
            quantity: nextAvailable,
            currentLength: nextAvailable,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          const rem = remSnap.data() as Record<string, unknown>;
          const remAvail = getAvailableForItem(rem, "length");
          const nextRem = remAvail - delta;
          if (nextRem < -1e-9) {
            throw new Error("Na zbytku není dostatek materiálu pro tuto úpravu spotřeby.");
          }
          tx.update(remRef, {
            quantity: nextRem,
            currentLength: nextRem,
            remainingQuantity: nextRem,
            originalLength: typeof rem.originalLength === "number" ? rem.originalLength : nextRem,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        const available = getAvailableForItem(primary, mode);
        if (delta > 1e-9 && delta > available + 1e-9) {
          throw new Error("Na skladě není dostatek materiálu pro navýšení spotřeby.");
        }
        const nextAvailable = available - delta;
        if (nextAvailable < -1e-9) throw new Error("Úprava by vedla k zápornému stavu skladu.");

        if (mode === "length") {
          tx.update(primaryRef, {
            quantity: nextAvailable,
            currentLength: nextAvailable,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          tx.update(primaryRef, {
            quantity: nextAvailable,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      tx.update(consRef, {
        quantity: qtyRaw,
        quantityUsed: qtyRaw,
        quantityIssued: qtyRaw,
        note: note || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
      });

      return { ok: true, newQuantity: qtyRaw, warnings };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[material-consumption-update]", e);
    const msg = e instanceof Error ? e.message : "Uložení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
