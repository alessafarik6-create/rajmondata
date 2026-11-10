import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { canManagePortalInvoices } from "@/lib/portal-invoice-permissions";
import { bulkRefreshInvoicePreviewsAdmin } from "@/lib/invoice-pdf-admin";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }

    const companyId = String(caller.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí firma." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      invoiceIds?: string[];
      limit?: number;
      startAfterId?: string | null;
    };

    const result = await bulkRefreshInvoicePreviewsAdmin(db, companyId, caller.uid, {
      invoiceIds: Array.isArray(body.invoiceIds) ? body.invoiceIds : undefined,
      limit: typeof body.limit === "number" ? body.limit : 20,
      startAfterId: body.startAfterId ?? null,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
