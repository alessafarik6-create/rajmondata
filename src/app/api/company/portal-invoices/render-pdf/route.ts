import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function canManageInvoices(role: string): boolean {
  return ["owner", "admin", "manager", "accountant"].includes(role);
}

type Body = {
  html?: string;
  filename?: string;
};

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
    if (!canManageInvoices(caller.role)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění k fakturám." }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const html = String(body.html ?? "").trim();
    if (!html) {
      return NextResponse.json({ ok: false, error: "Chybí HTML faktury." }, { status: 400 });
    }

    const pdf = await renderStoredHtmlToPdfBuffer(html);
    const filename = String(body.filename ?? "faktura.pdf").replace(/[^\w.-]+/g, "_");

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}
