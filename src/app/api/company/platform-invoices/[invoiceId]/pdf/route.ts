import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import { getAdminStorageBucket } from "@/lib/firebase-admin";

function canReadPlatformBilling(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant";
}

async function loadInvoicePdfBuffer(d: Record<string, unknown>): Promise<Buffer> {
  const pdfUrl = typeof d.pdfUrl === "string" && d.pdfUrl.trim() ? d.pdfUrl.trim() : "";
  if (pdfUrl) {
    const r = await fetch(pdfUrl);
    if (!r.ok) throw new Error(`Stažení PDF selhalo (HTTP ${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  }
  const path = typeof d.storagePath === "string" ? d.storagePath.trim() : "";
  const bucket = getAdminStorageBucket();
  if (!bucket || !path) throw new Error("PDF není uloženo.");
  const [buf] = await bucket.file(path).download();
  return buf;
}

/**
 * PDF faktury provozovatele — po ověření Bearer tokenu vrací binární obsah
 * (aby šel bezpečně načíst z portálu fetch + blob bez CORS na redirect).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ invoiceId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canReadPlatformBilling(v.caller.role)) {
    return NextResponse.json({ error: "Přístup jen pro vlastníka, administrátora nebo účetního." }, { status: 403 });
  }
  const { invoiceId } = await ctx.params;
  const id = String(invoiceId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí invoiceId." }, { status: 400 });
  const snap = await v.db.collection(PLATFORM_INVOICES_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Faktura neexistuje." }, { status: 404 });
  const d = snap.data() as Record<string, unknown>;
  if (String(d.organizationId || "") !== v.caller.companyId) {
    return NextResponse.json({ error: "K této faktuře nemáte přístup." }, { status: 403 });
  }
  const download = request.nextUrl.searchParams.get("download") === "1";
  try {
    const buf = await loadInvoicePdfBuffer(d);
    const rawName = String(d.invoiceNumber || id).replace(/[^\w.-]+/g, "_") || "faktura";
    const disp = download ? `attachment; filename="${rawName}.pdf"` : `inline; filename="${rawName}.pdf"`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disp,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[company platform-invoices pdf]", e);
    const msg = e instanceof Error ? e.message : "PDF nelze otevřít.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
