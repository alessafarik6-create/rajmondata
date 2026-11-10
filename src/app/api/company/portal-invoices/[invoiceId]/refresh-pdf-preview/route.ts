import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { canManagePortalInvoices } from "@/lib/portal-invoice-permissions";
import { persistInvoicePdfPreviewAdmin } from "@/lib/invoice-pdf-admin";
import { INVOICE_PDF_TEMPLATE_VERSION } from "@/lib/invoice-pdf-template";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
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
    if (!canManagePortalInvoices(caller.role)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění upravovat faktury." }, { status: 403 });
    }

    const { invoiceId } = await context.params;
    const id = String(invoiceId ?? "").trim();
    const companyId = String(caller.companyId ?? "").trim();
    if (!id || !companyId) {
      return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
    }

    const saved = await persistInvoicePdfPreviewAdmin(db, companyId, id, caller.uid);
    if (!saved.ok) {
      return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      html: saved.html,
      templateVersion: INVOICE_PDF_TEMPLATE_VERSION,
      archivedOriginal: saved.archivedOriginal,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
