import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireProductCatalogAccess } from "@/lib/product-catalogs/require-product-catalog-access";
import { serializeProductForFirestore } from "@/lib/product-catalogs";
import type { ProductCatalogProduct } from "@/lib/product-catalogs";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ catalogId: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let companyIdForLog: string | undefined;
  try {
  const perm = await requireProductCatalogAccess(request, "write");
  companyIdForLog = perm.ok ? perm.caller.companyId : undefined;
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error, diagnostic: perm.diagnostic }, { status: perm.status });
  }

  const { catalogId } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const ref = perm.db.collection("companies").doc(companyId).collection("product_catalogs").doc(catalogId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "Katalog nenalezen." }, { status: 404 });
  }

  const patch: Record<string, unknown> = {
    updatedBy: perm.caller.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const scalarKeys = [
    "name",
    "description",
    "category",
    "coverImageUrl",
    "active",
    "customerVisible",
    "archived",
    "order",
    "selectionMode",
  ] as const;
  for (const k of scalarKeys) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (body.deletedAt !== undefined) {
    if (body.deletedAt === null) {
      patch.deletedAt = FieldValue.delete();
    } else if (typeof body.deletedAt === "string" && body.deletedAt.trim()) {
      patch.deletedAt = FieldValue.serverTimestamp();
    } else if (body.deletedAt === true) {
      patch.deletedAt = FieldValue.serverTimestamp();
    }
  }
  if (Array.isArray(body.assignedJobIds)) patch.assignedJobIds = body.assignedJobIds;
  if (Array.isArray(body.assignedCustomerIds)) patch.assignedCustomerIds = body.assignedCustomerIds;
  if (Array.isArray(body.products)) {
    patch.products = body.products.map((p) => serializeProductForFirestore(p as ProductCatalogProduct));
  }

  await ref.set(patch, { merge: true });
  return NextResponse.json({ ok: true, catalogId });
  } catch (e) {
    console.error("[product-catalogs PATCH]", {
      companyId: companyIdForLog,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: "Úprava katalogu selhala kvůli chybě serveru." },
      { status: 500 }
    );
  }
}
