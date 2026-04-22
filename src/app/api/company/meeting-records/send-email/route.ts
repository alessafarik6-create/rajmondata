import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { buildMeetingRecordPdfHtml } from "@/lib/meeting-record-pdf-html";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { sendDocumentEmail } from "@/lib/document-email-outbound-admin";
import {
  hasNonEmptyTextSubjectAndBody,
  isValidEmailAddress,
  normalizeEmailBodyToHtml,
  parseCommaSeparatedEmails,
} from "@/lib/document-email-outbound";
import { assertCallerCanMeetingRecordsStaffActions } from "@/lib/meeting-records-api-auth";
import { resolveMeetingTitle } from "@/lib/meeting-records-types";
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

function slugFileBase(title: string): string {
  const t = title
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 72);
  return t || "zapis-schuzky";
}

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
    if (!isValidEmailAddress(toRaw)) {
      return NextResponse.json({ ok: false, error: "Neplatná adresa příjemce (Komu)." }, { status: 400 });
    }
    if (!hasNonEmptyTextSubjectAndBody({ subject, bodyPlain })) {
      return NextResponse.json({ ok: false, error: "Vyplňte předmět i text e-mailu." }, { status: 400 });
    }

    const gate = await assertCallerCanMeetingRecordsStaffActions(db, caller, companyId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const recordRef = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("meetingRecords").doc(recordId);
    const userSnap = await db.collection("users").doc(caller.uid).get();
    const sentByEmail =
      String((userSnap.data() as Record<string, unknown> | undefined)?.email ?? "").trim() || null;

    const [recordSnap, companySnap] = await Promise.all([
      recordRef.get(),
      db.collection(COMPANIES_COLLECTION).doc(companyId).get(),
    ]);
    if (!recordSnap.exists) {
      return NextResponse.json({ ok: false, error: "Záznam neexistuje." }, { status: 404 });
    }
    const rec = (recordSnap.data() ?? {}) as Record<string, unknown>;
    const recCompany = String(rec.companyId ?? "").trim();
    if (recCompany && recCompany !== companyId) {
      return NextResponse.json({ ok: false, error: "Záznam nepatří k této organizaci." }, { status: 403 });
    }

    const company = (companySnap.data() ?? {}) as Record<string, unknown>;
    const companyName =
      String(company.name ?? company.displayName ?? company.companyName ?? "").trim() || "Organizace";
    const orgSigObj = company.organizationSignature as
      | { url?: string | null; signedByName?: string | null }
      | undefined;
    const orgSigUrl = orgSigObj?.url != null ? String(orgSigObj.url).trim() : "";
    const signedByName = orgSigObj?.signedByName != null ? String(orgSigObj.signedByName).trim() : "";

    let jobDisplayName: string | null = null;
    const jid = typeof rec.jobId === "string" ? rec.jobId.trim() : "";
    if (jid) {
      const jobSnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs").doc(jid).get();
      if (jobSnap.exists) {
        const jd = jobSnap.data() as Record<string, unknown>;
        jobDisplayName =
          (typeof jd.name === "string" && jd.name.trim() ? jd.name.trim() : null) ||
          (typeof rec.jobName === "string" && String(rec.jobName).trim() ? String(rec.jobName).trim() : null);
      }
    }

    const meetingTitle = resolveMeetingTitle({
      title: typeof rec.title === "string" ? rec.title : "",
      meetingTitle: typeof rec.meetingTitle === "string" ? rec.meetingTitle : null,
    });
    const subjectFinal = subject;
    const bodyFinalHtml = normalizeEmailBodyToHtml(bodyPlain);

    const html = buildMeetingRecordPdfHtml({
      record: rec,
      companyName,
      organizationSignatureUrl: orgSigUrl || null,
      organizationStampName: companyName,
      electronicSignatureDateLabel: null,
      electronicSignatureSignerName: signedByName || null,
      jobDisplayName,
    });
    const pdf = await renderStoredHtmlToPdfBuffer(html);
    const filename = `${slugFileBase(meetingTitle || "zapis-schuzky")}.pdf`;

    const ccExtra = parseCommaSeparatedEmails(ccRaw);
    const send = await sendDocumentEmail(db, {
      companyId,
      jobId: jid || null,
      type: "meeting_record",
      to: toRaw,
      ccExtra,
      subject: subjectFinal,
      html: bodyFinalHtml,
      documentUrl: null,
      userId: caller.uid,
      sentByEmail,
      invoiceId: null,
      contractId: null,
      documentId: null,
      attachments: [
        {
          filename,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });

    if (!send.ok) {
      return NextResponse.json({ ok: false, error: send.error, detail: send.detail ?? null }, { status: 502 });
    }

    const toNorm = toRaw.trim().toLowerCase();
    const ccNorm = ccExtra.map((e) => e.trim().toLowerCase()).filter(Boolean);
    const sentList = [toNorm, ...ccNorm].filter((v, i, a) => v && a.indexOf(v) === i);

    await recordRef.set(
      {
        sentAt: FieldValue.serverTimestamp(),
        sentToEmails: sentList,
        lastSentBy: caller.uid,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true as const });
  } catch (e) {
    const msg = errorMessageFromUnknown(e);
    console.error("[meeting-records/send-email]", e);
    return NextResponse.json({ ok: false, error: msg || "Odeslání se nezdařilo." }, { status: 500 });
  }
}
