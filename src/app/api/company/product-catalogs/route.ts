import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireProductCatalogAccess } from "@/lib/product-catalogs/require-product-catalog-access";
import { serializeProductForFirestore } from "@/lib/product-catalogs";
import type { ProductCatalogProduct } from "@/lib/product-catalogs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let companyIdForLog: string | undefined;
  try {
  const perm = await requireProductCatalogAccess(request, "write");
  companyIdForLog = perm.ok ? perm.caller.companyId : undefined;
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error, diagnostic: perm.diagnostic }, { status: perm.status });
  }

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

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Vyplňte název katalogu." }, { status: 400 });
  }

  const productsRaw = Array.isArray(body.products) ? body.products : [];
  const products = productsRaw.map((p) =>
    serializeProductForFirestore(p as ProductCatalogProduct)
  );

  const ref = perm.db.collection("companies").doc(companyId).collection("product_catalogs").doc();
  await ref.set({
    companyId,
    name,
    description: String(body.description ?? "").trim(),
    category: String(body.category ?? "").trim(),
    coverImageUrl: String(body.coverImageUrl ?? "").trim() || null,
    active: body.active !== false,
    customerVisible: body.customerVisible === true,
    archived: false,
    order: typeof body.order === "number" ? body.order : 0,
    selectionMode: body.selectionMode === "single" ? "single" : "multi",
    assignedJobIds: Array.isArray(body.assignedJobIds) ? body.assignedJobIds : [],
    assignedCustomerIds: Array.isArray(body.assignedCustomerIds) ? body.assignedCustomerIds : [],
    products,
    createdBy: perm.caller.uid,
    updatedBy: perm.caller.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, catalogId: ref.id });
  } catch (e) {
    console.error("[product-catalogs POST]", {
      companyId: companyIdForLog,
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: "Vytvoření katalogu selhalo kvůli chybě serveru." },
      { status: 500 }
    );
  }
}
