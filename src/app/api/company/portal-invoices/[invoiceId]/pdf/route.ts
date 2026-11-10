import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";
import { canViewPortalInvoices } from "@/lib/portal-invoice-permissions";
import { buildInvoicePreviewHtmlAdmin } from "@/lib/invoice-pdf-admin";
import { INVOICE_PDF_FIELD_ARCHIVE } from "@/lib/invoice-pdf-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }
    if (!canViewPortalInvoices(caller.role)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění k fakturám." }, { status: 403 });
    }

    const { invoiceId } = await context.params;
    const id = String(invoiceId ?? "").trim();
    const companyId = String(caller.companyId ?? "").trim();
    if (!id || !companyId) {
      return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
    }

    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("invoices")
      .doc(id)
      .get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Faktura nenalezena." }, { status: 404 });
    }
    const data = snap.data() as Record<string, unknown>;
    const variant = (request.nextUrl.searchParams.get("variant") || "current").toLowerCase();
    let html = "";
    if (variant === "original" || variant === "archive") {
      const archive = String(data[INVOICE_PDF_FIELD_ARCHIVE] ?? "").trim();
      html = archive || (typeof data.pdfHtml === "string" ? data.pdfHtml.trim() : "");
    } else {
      const built = await buildInvoicePreviewHtmlAdmin(db, companyId, id);
      if (built.ok && built.html.trim()) {
        html = built.html.trim();
      } else {
        html = typeof data.pdfHtml === "string" ? data.pdfHtml.trim() : "";
      }
    }
    if (!html) {
      return NextResponse.json({ ok: false, error: "Chybí HTML faktury." }, { status: 400 });
    }

    const pdf = await renderStoredHtmlToPdfBuffer(html);
    const num = String(data.invoiceNumber ?? data.documentNumber ?? id).replace(/[^\w.-]+/g, "_");
    const suffix = variant === "original" || variant === "archive" ? "_original" : "";

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${num || "faktura"}${suffix}.pdf"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}
