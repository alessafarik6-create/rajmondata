import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { verifyCompanyBearerFromRequest } from "@/lib/api-company-auth";
import {
  assertWarehouseInventoryAccess,
  assertWarehouseInventoryManage,
} from "@/lib/warehouse-inventory-access.server";
import { closeWarehouseInventoryWithMovements } from "@/lib/warehouse-inventory-close.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  inventoryId?: string;
  applyMovements?: boolean;
  confirm?: boolean;
  idempotencyKey?: string;
};

export async function POST(request: NextRequest) {
  const requestId = randomBytes(6).toString("hex");
  const v = await verifyCompanyBearerFromRequest(request);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error, requestId }, { status: v.status });
  }

  const access = await assertWarehouseInventoryAccess(v.db, v.caller);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error, requestId }, { status: access.status });
  }

  const userSnap = await v.db.collection("users").doc(v.caller.uid).get();
  const profile = userSnap.data() as Record<string, unknown> | undefined;
  const manage = assertWarehouseInventoryManage(v.caller, profile);
  if (!manage.ok) {
    return NextResponse.json({ ok: false, error: manage.error, requestId }, { status: manage.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON.", requestId }, { status: 400 });
  }

  const inventoryId = String(body.inventoryId ?? "").trim();
  if (!inventoryId) {
    return NextResponse.json({ ok: false, error: "Chybí inventoryId.", requestId }, { status: 400 });
  }

  const applyMovements = body.applyMovements === true;
  if (applyMovements && body.confirm !== true) {
    return NextResponse.json(
      {
        ok: false,
        error: "Pro vytvoření skladových pohybů potvrďte akci (confirm: true).",
        requestId,
      },
      { status: 400 }
    );
  }

  const idempotencyKey =
    String(body.idempotencyKey ?? "").trim() || `inv-close-${inventoryId}-${requestId}`;

  try {
    const result = await closeWarehouseInventoryWithMovements({
      db: v.db,
      companyId: v.caller.companyId,
      caller: v.caller,
      inventoryId,
      applyMovements,
      idempotencyKey,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, requestId }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      requestId,
      batchId: result.batchId,
      movementsCreated: result.movementsCreated,
      warnings: result.warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[warehouse-inventory-close]", { requestId, msg });
    return NextResponse.json(
      { ok: false, error: "Uzavření inventury selhalo.", requestId },
      { status: 500 }
    );
  }
}
