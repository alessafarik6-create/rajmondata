import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { readInquiryEmailIdentity } from "@/lib/inquiry-offer-email";
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
};

export type SendPortalInvoiceEmailResult =
  | { ok: true; messageId: string | null; copyTo: string[]; sendNotice: string | null }
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
  if (!to || !to.includes("@")) {
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

  const copyValidation = validateOfferCopyEmailsRaw(identity.offerCopyEmails);
  if (!copyValidation.ok) {
    return { ok: false, error: copyValidation.error, detail: null };
  }
  let offerCopyDelivery: ReturnType<typeof resolveInquiryOfferCopyDelivery> = null;
  try {
    offerCopyDelivery = resolveInquiryOfferCopyDelivery(identity, to);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neplatné kopie v nastavení.",
      detail: null,
    };
  }

  const planResult = await buildInquiryOfferSendPlan({ company, identity });
  if ("error" in planResult) {
    return { ok: false, error: planResult.error, detail: null };
  }

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
  const attachments = [{ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" }];

  const offerCopyTo = offerCopyDelivery?.emails ?? [];
  const send = await sendTransactionalEmail({
    to: [to],
    ...(offerCopyDelivery?.mode === "cc" && offerCopyTo.length ? { cc: offerCopyTo } : {}),
    ...(offerCopyDelivery?.mode === "bcc" && offerCopyTo.length ? { bcc: offerCopyTo } : {}),
    from: planResult.fromHeader,
    replyTo: planResult.replyTo,
    subject: params.subject.trim(),
    html: params.bodyHtml,
    attachments,
  });

  if (!send.ok) {
    await invRef.collection("emailOutboundHistory").add({
      to,
      cc: offerCopyDelivery?.mode === "cc" ? offerCopyTo : [],
      bcc: offerCopyDelivery?.mode === "bcc" ? offerCopyTo : [],
      subject: params.subject.trim(),
      status: "error",
      errorMessage: send.error ?? "Odeslání selhalo.",
      pdfFilename,
      sentByUid: params.userId,
      sentByEmail: params.sentByEmail ?? null,
      sentByName: params.sentByName ?? null,
      sentAt: FieldValue.serverTimestamp(),
    });
    return { ok: false, error: send.error ?? "E-mail se nepodařilo odeslat.", detail: send.detail ?? null };
  }

  await invRef.collection("emailOutboundHistory").add({
    to,
    cc: offerCopyDelivery?.mode === "cc" ? offerCopyTo : [],
    bcc: offerCopyDelivery?.mode === "bcc" ? offerCopyTo : [],
    subject: params.subject.trim(),
    status: "sent",
    messageId: send.messageId ?? null,
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
        cc: offerCopyDelivery?.mode === "cc" ? offerCopyTo : [],
        subject: params.subject.trim(),
        status: "sent",
        invoiceId,
        sentByUid: params.userId,
        sentByEmail: params.sentByEmail ?? null,
        mainDocumentFilename: pdfFilename,
        offerCopyTo,
        offerCopyMode: offerCopyDelivery?.mode ?? null,
        sentAt: FieldValue.serverTimestamp(),
      });
  }

  return {
    ok: true,
    messageId: send.messageId ?? null,
    copyTo: offerCopyTo,
    sendNotice: planResult.sendNotice,
  };
}
