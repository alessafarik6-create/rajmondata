import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { assertCallerCanHandoverProtocolStaff } from "@/lib/handover-protocol-api-auth";
import { loadHandoverProtocolPdfHtml } from "@/lib/handover-protocol-load-admin";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { sendDocumentEmail } from "@/lib/document-email-outbound-admin";
import {
  normalizeEmailBodyToHtml,
  substituteDocumentEmailVariables,
} from "@/lib/document-email-outbound";
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
      protocolId?: string;
      to?: string;
      ccExtra?: string[];
      subject?: string;
      message?: string;
      origin?: string;
    };
    const companyId = String(body.companyId ?? "").trim();
    const protocolId = String(body.protocolId ?? "").trim();
    const to = String(body.to ?? "").trim();
    if (!companyId || !protocolId || !to) {
      return NextResponse.json({ ok: false, error: "Chybí údaje." }, { status: 400 });
    }

    const built = await loadHandoverProtocolPdfHtml(db, companyId, protocolId);
    if (!built.ok) {
      return NextResponse.json({ ok: false, error: built.error }, { status: 404 });
    }
    const jobId = String(built.protocol.jobId ?? "").trim();
    const gate = await assertCallerCanHandoverProtocolStaff(db, caller, companyId, jobId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
    const companyName = String(
      (companySnap.data() ?? {}).name ??
        (companySnap.data() ?? {}).companyName ??
        "Organizace"
    ).trim();

    const buffer = await renderStoredHtmlToPdfBuffer(built.html);
    const jobName = String(built.protocol.jobName ?? "Zakázka");
    const jobNumber = String(built.protocol.jobNumber ?? "");
    const form = built.protocol.form as { documentTitle?: string } | undefined;
    const docTitle = String(form?.documentTitle ?? "Předávací protokol");
    const protocolNumber = String(built.protocol.protocolNumber ?? protocolId);

    const origin = String(body.origin ?? request.nextUrl.origin).replace(/\/$/, "");
    const link =
      origin && jobId
        ? `${origin}/portal/customer/jobs/${encodeURIComponent(jobId)}`
        : origin || "";

    const vars = {
      nazev_firmy: companyName,
      jmeno_zakaznika: String(built.protocol.customerName ?? ""),
      cislo_dokladu: protocolNumber,
      datum: new Intl.DateTimeFormat("cs-CZ").format(new Date()),
      castka: "",
      odkaz_na_dokument: link,
    };

    const subject =
      String(body.subject ?? "").trim() ||
      substituteDocumentEmailVariables(
        `Předávací protokol — ${docTitle}${jobNumber ? ` (${jobNumber})` : ""}`,
        vars
      );
    const messagePlain =
      String(body.message ?? "").trim() ||
      `Dobrý den,\n\nv příloze zasíláme předávací protokol k zakázce ${jobName}${jobNumber ? ` (${jobNumber})` : ""}.\n\n${link ? `Odkaz: ${link}\n\n` : ""}S pozdravem\n${companyName}`;
    const html = normalizeEmailBodyToHtml(substituteDocumentEmailVariables(messagePlain, vars));

    const ccExtra = Array.isArray(body.ccExtra)
      ? body.ccExtra.map((c) => String(c).trim()).filter(Boolean)
      : [];

    const callerUserSnap = await db.collection("users").doc(caller.uid).get();
    const callerEmail = String((callerUserSnap.data() ?? {}).email ?? "").trim() || null;
    const callerDisplayName =
      String((callerUserSnap.data() ?? {}).displayName ?? "").trim() || null;

    const send = await sendDocumentEmail(db, {
      companyId,
      jobId,
      type: "handover_protocol",
      to,
      ccExtra,
      subject,
      html,
      documentUrl: link || null,
      userId: caller.uid,
      sentByEmail: callerEmail,
      attachments: [{ filename: built.filename, content: buffer }],
      mainDocumentFilename: built.filename,
    });

    if (!send.ok) {
      return NextResponse.json({ ok: false, error: send.error }, { status: 500 });
    }

    const pref = db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("handoverProtocols")
      .doc(protocolId);
    await pref.set(
      {
        sharedWithCustomer: true,
        sentToCustomer: true,
        status: "sent",
        updatedAt: FieldValue.serverTimestamp(),
        emailSendHistory: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "email_sent",
          byUserId: caller.uid,
          byDisplayName: callerDisplayName,
          detail: `Komu: ${to} · ${built.filename}`,
        }),
        activityHistory: FieldValue.arrayUnion({
          at: new Date().toISOString(),
          action: "email_sent",
          byUserId: caller.uid,
          byDisplayName: callerDisplayName,
          detail: `Odesláno na ${to}`,
        }),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessageFromUnknown(e) }, { status: 500 });
  }
}
