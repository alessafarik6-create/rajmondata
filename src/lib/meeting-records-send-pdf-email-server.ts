import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-verify-company-user";
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
import { resolveMeetingTitle } from "@/lib/meeting-records-types";

export type SendMeetingRecordPdfEmailResult =
  | { ok: true }
  | { ok: false; error: string; detail: string | null };

function slugFileBase(title: string): string {
  const t = title
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 72);
  return t || "zapis-schuzky";
}

/**
 * Odešle zápis ze schůzky jako PDF v příloze (stejná logika jako
 * POST /api/company/meeting-records/send-email).
 */
export async function sendMeetingRecordPdfEmailToCustomer(params: {
  db: Firestore;
  caller: VerifiedCompanyCaller;
  companyId: string;
  recordId: string;
  to: string;
  cc?: string;
  subject: string;
  bodyPlain: string;
  /** Po úspěchu zapíše sentAt / sentToEmails / lastSentBy (legacy chování send-email). */
  updateLegacySentFields: boolean;
}): Promise<SendMeetingRecordPdfEmailResult> {
  const companyId = params.companyId.trim();
  const recordId = params.recordId.trim();
  const toRaw = params.to.trim();
  const ccRaw = String(params.cc ?? "").trim();
  const subject = params.subject.trim();
  const bodyPlain = params.bodyPlain.trim();

  if (!companyId || !recordId) {
    return { ok: false, error: "Chybí companyId nebo recordId.", detail: null };
  }
  if (!isValidEmailAddress(toRaw)) {
    return { ok: false, error: "Neplatná adresa příjemce.", detail: null };
  }
  if (!hasNonEmptyTextSubjectAndBody({ subject, bodyPlain })) {
    return { ok: false, error: "Vyplňte předmět i text e-mailu.", detail: null };
  }

  const db = params.db;
  const recordRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("meetingRecords")
    .doc(recordId);
  const userSnap = await db.collection("users").doc(params.caller.uid).get();
  const sentByEmail =
    String((userSnap.data() as Record<string, unknown> | undefined)?.email ?? "").trim() || null;

  const [recordSnap, companySnap] = await Promise.all([
    recordRef.get(),
    db.collection(COMPANIES_COLLECTION).doc(companyId).get(),
  ]);
  if (!recordSnap.exists) {
    return { ok: false, error: "Záznam neexistuje.", detail: null };
  }
  const rec = (recordSnap.data() ?? {}) as Record<string, unknown>;
  const recCompany = String(rec.companyId ?? "").trim();
  if (recCompany && recCompany !== companyId) {
    return { ok: false, error: "Záznam nepatří k této organizaci.", detail: null };
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
    const jobSnap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("jobs")
      .doc(jid)
      .get();
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
  const send = await sendDocumentEmail(params.db, {
    companyId,
    jobId: jid || null,
    type: "meeting_record",
    to: toRaw,
    ccExtra,
    subject,
    html: bodyFinalHtml,
    documentUrl: null,
    userId: params.caller.uid,
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
    return { ok: false, error: send.error, detail: send.detail ?? null };
  }

  if (params.updateLegacySentFields) {
    const toNorm = toRaw.trim().toLowerCase();
    const ccNorm = ccExtra.map((e) => e.trim().toLowerCase()).filter(Boolean);
    const sentList = [toNorm, ...ccNorm].filter((v, i, a) => v && a.indexOf(v) === i);
    await recordRef.set(
      {
        sentAt: FieldValue.serverTimestamp(),
        sentToEmails: sentList,
        lastSentBy: params.caller.uid,
      },
      { merge: true }
    );
  }

  return { ok: true };
}
