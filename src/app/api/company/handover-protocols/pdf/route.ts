import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import {
  assertCallerCanHandoverProtocolCustomer,
  assertCallerCanHandoverProtocolStaff,
} from "@/lib/handover-protocol-api-auth";
import { loadHandoverProtocolPdfHtml } from "@/lib/handover-protocol-load-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
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

    const body = (await request.json()) as { companyId?: string; protocolId?: string };
    const companyId = String(body.companyId ?? "").trim();
    const protocolId = String(body.protocolId ?? "").trim();
    if (!companyId || !protocolId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId nebo protocolId." }, { status: 400 });
    }

    const built = await loadHandoverProtocolPdfHtml(db, companyId, protocolId);
    if (!built.ok) {
      return NextResponse.json({ ok: false, error: built.error }, { status: 404 });
    }

    const jobId = String(built.protocol.jobId ?? "").trim();
    const staffGate = await assertCallerCanHandoverProtocolStaff(db, caller, companyId, jobId);
    if (!staffGate.ok) {
      const pref = db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("handoverProtocols")
        .doc(protocolId);
      const snap = await pref.get();
      const custGate = await assertCallerCanHandoverProtocolCustomer(
        db,
        caller,
        companyId,
        (snap.data() ?? {}) as Record<string, unknown>
      );
      if (!custGate.ok) {
        return NextResponse.json({ ok: false, error: custGate.error }, { status: custGate.status });
      }
    }

    const buffer = await renderStoredHtmlToPdfBuffer(built.html);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${built.filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessageFromUnknown(e) },
      { status: 500 }
    );
  }
}
