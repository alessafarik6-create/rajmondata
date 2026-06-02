import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { sendPortalInvoiceEmail } from "@/lib/portal-invoice-send-admin";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function canManageInvoices(role: string): boolean {
  return ["owner", "admin", "manager", "accountant"].includes(role);
}

type Body = {
  companyId?: string;
  to?: string;
  subject?: string;
  bodyHtml?: string;
  bodyPlain?: string;
};

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
    if (caller.role === "employee") {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění." }, { status: 403 });
    }
    if (!canManageInvoices(caller.role)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění k fakturám." }, { status: 403 });
    }

    const { invoiceId } = await context.params;
    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? caller.companyId ?? "").trim();
    if (!companyId || companyId !== String(caller.companyId ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
    }

    const userSnap = await db.collection("users").doc(caller.uid).get();
    const userData = (userSnap.data() ?? {}) as Record<string, unknown>;

    const result = await sendPortalInvoiceEmail(db, {
      companyId,
      invoiceId: String(invoiceId ?? "").trim(),
      to: String(body.to ?? "").trim(),
      subject: String(body.subject ?? "").trim(),
      bodyHtml: String(body.bodyHtml ?? "").trim(),
      bodyPlain: String(body.bodyPlain ?? "").trim(),
      userId: caller.uid,
      sentByEmail: String(userData.email ?? "").trim() || null,
      sentByName: String(userData.displayName ?? "").trim() || null,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, detail: result.detail }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      copyTo: result.copyTo,
      sendNotice: result.sendNotice,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}
