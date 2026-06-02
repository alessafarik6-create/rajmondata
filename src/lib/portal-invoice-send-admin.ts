import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { readInquiryEmailIdentity, isValidEmailAddress } from "@/lib/inquiry-offer-email";
import { buildInquiryOfferSendPlan } from "@/lib/inquiry-offer-send-plan";
import {
  resolveInquiryOfferCopyDelivery,
  validateOfferCopyEmailsRaw,
} from "@/lib/inquiry-offer-copy";
import { PORTAL_MANUAL_INVOICE_TYPE } from "@/lib/portal-manual-invoice";

export type SendPortalInvoiceEmailParams = {
  companyId: string;
  invoiceId: string;
  to: string;
  subject: string;
  bodyHtml: string;
  bodyPlain: string;
  userId: string;
  sentByEmail?: string | null;
  sentByName?: string | null;
  copyEmailsRaw?: string | null;
};

export type SendPortalInvoiceEmailResult =
  | { ok: true; messageId: string | null; copyTo: string[] }
  | { ok: false; error: string; detail: string | null };

function safePdfFilename(invoiceNumber: string): string {
  const base = String(invoiceNumber || "faktura")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return `${base || "faktura"}.pdf`;
}

export async function sendPortalInvoiceEmail(
  db: Firestore,
  params: SendPortalInvoiceEmailParams
): Promise<SendPortalInvoiceEmailResult> {
  const companyId = String(params.companyId || "").trim();
  const invoiceId = String(params.invoiceId || "").trim();
  const to = String(params.to || "").trim().toLowerCase();
  if (!companyId || !invoiceId) {
    return { ok: false, error: "Chybí identifikátor faktury.", detail: null };
  }
  if (!isValidEmailAddress(to)) {
    return { ok: false, error: "Neplatná e-mailová adresa příjemce.", detail: null };
  }

  const invRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("invoices")
    .doc(invoiceId);
  const invSnap = await invRef.get();
  if (!invSnap.exists) {
    return { ok: false, error: "Faktura nebyla nalezena.", detail: null };
  }
  const inv = (invSnap.data() ?? {}) as Record<string, unknown>;
  if (String(inv.type ?? "") !== PORTAL_MANUAL_INVOICE_TYPE) {
    return { ok: false, error: "Tento typ faktury nelze odeslat z portálu.", detail: null };
  }
  const pdfHtml = typeof inv.pdfHtml === "string" ? inv.pdfHtml.trim() : "";
  if (!pdfHtml) {
    return { ok: false, error: "Faktura nemá uložený náhled pro PDF.", detail: null };
  }

  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const identity = readInquiryEmailIdentity(company);
  const plan = buildInquiryOfferSendPlan(identity);
  const orgEmail = String(company.email ?? "").trim() || null;

  const copyValidation = validateOfferCopyEmailsRaw(params.copyEmailsRaw ?? "");
  if (!copyValidation.ok) {
    return { ok: false, error: copyValidation.error, detail: null };
  }
  const copyDelivery = resolveInquiryOfferCopyDelivery({
    orgEmail,
    identity,
    manualCopyEmails: copyValidation.emails,
    autoCopyOrganization: true,
    to,
  });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderStoredHtmlToPdfBuffer(pdfHtml);
  } catch (e) {
    return {
      ok: false,
      error: "Nepodařilo se vygenerovat PDF faktury.",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const invoiceNumber = String(inv.invoiceNumber ?? invoiceId).trim();
  const pdfFilename = safePdfFilename(invoiceNumber);
  const attachments = [
    {
      filename: pdfFilename,
      content: pdfBuffer,
      contentType: "application/pdf",
    },
  ];

  const cc = copyDelivery?.mode === "cc" ? copyDelivery.emails : [];
  const bcc = copyDelivery?.mode === "bcc" ? copyDelivery.emails : [];

  const sendResult = await sendTransactionalEmail({
    to,
    subject: params.subject.trim(),
    html: params.bodyHtml,
    text: params.bodyPlain,
    from: plan.from,
    replyTo: plan.replyTo,
    cc,
    bcc,
    attachments,
  });

  if (!sendResult.ok) {
    await invRef.collection("emailOutboundHistory").add({
      to,
      cc,
      bcc,
      subject: params.subject.trim(),
      status: "error",
      errorMessage: sendResult.error ?? "Odeslání selhalo.",
      pdfFilename,
      sentByUid: params.userId,
      sentByEmail: params.sentByEmail ?? null,
      sentByName: params.sentByName ?? null,
      sentAt: FieldValue.serverTimestamp(),
    });
    return { ok: false, error: sendResult.error ?? "E-mail se nepodařilo odeslat.", detail: null };
  }

  await invRef.collection("emailOutboundHistory").add({
    to,
    cc,
    bcc,
    subject: params.subject.trim(),
    status: "sent",
    messageId: sendResult.messageId ?? null,
    pdfFilename,
    sentByUid: params.userId,
    sentByEmail: params.sentByEmail ?? null,
    sentByName: params.sentByName ?? null,
    sentAt: FieldValue.serverTimestamp(),
  });

  await invRef.set(
    {
      lastOutboundEmailAt: FieldValue.serverTimestamp(),
      lastOutboundEmailTo: to,
      lastOutboundEmailStatus: "sent",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const jobId = typeof inv.jobId === "string" ? inv.jobId.trim() : "";
  if (jobId) {
    await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("jobs")
      .doc(jobId)
      .collection("documentEmailLogs")
      .add({
        companyId,
        jobId,
        type: "invoice",
        to,
        cc,
        subject: params.subject.trim(),
        status: "sent",
        invoiceId,
        sentByUid: params.userId,
        sentByEmail: params.sentByEmail ?? null,
        mainDocumentFilename: pdfFilename,
        sentAt: FieldValue.serverTimestamp(),
      });
  }

  return {
    ok: true,
    messageId: sendResult.messageId ?? null,
    copyTo: [...cc, ...bcc],
  };
}
