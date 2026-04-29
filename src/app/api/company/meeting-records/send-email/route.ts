import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { assertCallerCanMeetingRecordsStaffActions } from "@/lib/meeting-records-api-auth";
import { sendMeetingRecordPdfEmailToCustomer } from "@/lib/meeting-records-send-pdf-email-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  recordId?: string;
  to?: string;
  cc?: string;
  subject?: string;
  bodyPlain?: string;
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
      return NextResponse.json({ ok: false, error: "Neplatné přihlášení." }, { status: 401 });
    }

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json({ ok: false, error: "Neplatné tělo požadavku." }, { status: 400 });
    }
    const companyId = String(body.companyId ?? "").trim();
    const recordId = String(body.recordId ?? "").trim();
    const toRaw = String(body.to ?? "").trim();
    const ccRaw = String(body.cc ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const bodyPlain = String(body.bodyPlain ?? "").trim();

    if (!companyId || !recordId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId nebo recordId." }, { status: 400 });
    }

    const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const send = await sendMeetingRecordPdfEmailToCustomer({
      db,
      caller,
      companyId,
      recordId,
      to: toRaw,
      cc: ccRaw,
      subject,
      bodyPlain,
      updateLegacySentFields: true,
    });

    if (!send.ok) {
      return NextResponse.json({ ok: false, error: send.error, detail: send.detail ?? null }, { status: 502 });
    }

    return NextResponse.json({ ok: true as const });
  } catch (e) {
    const msg = errorMessageFromUnknown(e);
    console.error("[meeting-records/send-email]", e);
    return NextResponse.json({ ok: false, error: msg || "Odeslání se nezdařilo." }, { status: 500 });
  }
}
