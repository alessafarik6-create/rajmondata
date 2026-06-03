import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { assertCallerCanHandoverProtocolStaff } from "@/lib/handover-protocol-api-auth";
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
    const idToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
    }

    const body = (await request.json()) as {
      companyId?: string;
      jobId?: string;
      html?: string;
      filename?: string;
    };
    const companyId = String(body.companyId ?? "").trim();
    const jobId = String(body.jobId ?? "").trim();
    const html = String(body.html ?? "").trim();
    if (!companyId || !html) {
      return NextResponse.json({ ok: false, error: "Chybí companyId nebo HTML." }, { status: 400 });
    }

    const gate = await assertCallerCanHandoverProtocolStaff(db, caller, companyId, jobId || null);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const buffer = await renderStoredHtmlToPdfBuffer(html);
    const filename = String(body.filename ?? "predavaci-protokol.pdf").replace(/[^\w.-]+/g, "_");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}
