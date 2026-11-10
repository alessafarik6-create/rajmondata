import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { canViewPortalInvoices } from "@/lib/portal-invoice-permissions";
import { buildInvoicePreviewHtmlAdmin } from "@/lib/invoice-pdf-admin";
import { INVOICE_PDF_TEMPLATE_VERSION } from "@/lib/invoice-pdf-template";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    const built = await buildInvoicePreviewHtmlAdmin(db, companyId, id);
    if (!built.ok) {
      return NextResponse.json({ ok: false, error: built.error }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        html: built.html,
        source: built.source,
        templateVersion: built.templateVersion,
        currentTemplateVersion: INVOICE_PDF_TEMPLATE_VERSION,
        hasOriginalArchive: built.hasOriginalArchive,
        outdated: built.outdated,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
