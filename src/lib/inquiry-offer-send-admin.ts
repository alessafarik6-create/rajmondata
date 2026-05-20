/**
 * Server — odeslání e-mailové nabídky k poptávce (SMTP organizace nebo Resend s reply-to na firmu).
 */

import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import {
  mergeAttachmentRefsWithResolvedSizes,
  resolveInquiryOfferAttachmentsForEmail,
} from "@/lib/inquiry-offer-attachment-resolve";
import type { InquiryOfferAttachmentRef } from "@/lib/inquiry-offer-attachments";
import {
  buildInquiryOfferEmailHtml,
  buildInquiryOfferThreadId,
  INQUIRY_OFFER_STANDALONE_LEAD_KEY,
  isValidEmailAddress,
  plainTextToHtmlParagraphs,
  readInquiryEmailIdentity,
  stripHtmlToPlain,
  type InquiryWorkflowStatus,
} from "@/lib/inquiry-offer-email";
import {
  buildInquiryOfferSentBodyPlain,
  calculateInquiryOfferPricing,
  parseInquiryPriceInput,
  type InquiryVatRate,
} from "@/lib/inquiry-offer-pricing";
import {
  INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR,
  resolveInquiryOfferCopyDelivery,
  validateOfferCopyEmailsRaw,
  type InquiryOfferCopyDelivery,
  type InquiryOfferCopyMode,
} from "@/lib/inquiry-offer-copy";
import type { SendTransactionalEmailAttachment } from "@/lib/email-notifications/resend-send";
import { isResendDomainNotVerifiedError } from "@/lib/inquiry-offer-resend";
import {
  buildInquiryOfferDeliveryHeaders,
  buildInquiryOfferHistoryFields,
  buildInquiryOfferSendPlan,
  type InquiryOfferSendPlan,
} from "@/lib/inquiry-offer-send-plan";
import {
  buildInquiryOfferAuthorHistoryFields,
  resolveInquiryOfferAuthor,
} from "@/lib/inquiry-offer-author-resolve";
import { getAdminAuth } from "@/lib/firebase-admin";
import {
  buildInquiryOfferFooterData,
  type InquiryOfferFooterData,
} from "@/lib/inquiry-offer-footer";

export type SendInquiryOfferEmailParams = {
  companyId: string;
  leadKey: string;
  importLeadId: string;
  to: string;
  subject: string;
  bodyText: string;
  priceNet?: number | null;
  vatRate?: InquiryVatRate | null;
  internalNote?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  attachments?: InquiryOfferAttachmentRef[];
  isStandalone?: boolean;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  userId: string;
  sentByEmail?: string | null;
  sentByName?: string | null;
  draftOfferId?: string | null;
};

export type SendInquiryOfferEmailResult =
  | {
      ok: true;
      offerId: string;
      messageId: string | null;
      threadId: string;
      sendNotice: string | null;
      sendPlan: InquiryOfferSendPlan;
    }
  | { ok: false; error: string; detail: string | null };

function buildMessageIdHeader(domain: string): string {
  const token = crypto.randomBytes(12).toString("hex");
  const host = domain.replace(/^@/, "") || "mail.local";
  return `<inquiry-offer-${token}@${host}>`;
}

async function deliverViaSmtp(
  plan: InquiryOfferSendPlan,
  identity: ReturnType<typeof readInquiryEmailIdentity>,
  params: {
    to: string;
    subject: string;
    html: string;
    bodyPlain: string;
    headers: Record<string, string>;
    attachments: SendTransactionalEmailAttachment[];
    copy: InquiryOfferCopyDelivery | null;
  }
): Promise<
  | { ok: true; messageId: string; copyModeUsed: InquiryOfferCopyMode | null }
  | { ok: false; error: string; detail: string | null }
> {
  const smtp = identity.smtp;
  if (!smtp?.host || !smtp.user) {
    return { ok: false, error: "SMTP není nakonfigurováno.", detail: null };
  }
  const transporter = nodemailer.createTransport({
    host: String(smtp.host).trim(),
    port: Number(smtp.port) || (smtp.secure ? 465 : 587),
    secure: smtp.secure === true,
    auth: {
      user: String(smtp.user).trim(),
      pass: String(smtp.password ?? ""),
    },
  });
  try {
    const copy = params.copy;
    const mailOpts: nodemailer.SendMailOptions = {
      from: plan.fromHeader,
      to: params.to,
      replyTo: plan.replyTo,
      subject: params.subject,
      html: params.html,
      text: stripHtmlToPlain(params.bodyPlain),
      headers: params.headers,
      attachments: params.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
      envelope: {
        from: plan.fromEmailTechnical,
        to: params.to,
      },
    };
    if (copy?.emails.length) {
      if (copy.mode === "cc") {
        mailOpts.cc = copy.emails;
      } else {
        mailOpts.bcc = copy.emails;
      }
    }
    const info = await transporter.sendMail(mailOpts);
    const messageId = String(info.messageId ?? params.headers["Message-ID"] ?? "").trim();
    return {
      ok: true,
      messageId: messageId || params.headers["Message-ID"],
      copyModeUsed: copy?.emails.length ? copy.mode : null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "Odeslání přes SMTP se nezdařilo.", detail: msg };
  }
}

function resendPayloadWithCopy(
  base: {
    to: string;
    subject: string;
    html: string;
    from: string;
    replyTo: string;
    headers: Record<string, string>;
    attachments: SendTransactionalEmailAttachment[];
  },
  copy: InquiryOfferCopyDelivery | null
) {
  return {
    to: [base.to],
    subject: base.subject,
    html: base.html,
    from: base.from,
    replyTo: base.replyTo,
    headers: base.headers,
    ...(base.attachments.length > 0 ? { attachments: base.attachments } : {}),
    ...(copy?.emails.length
      ? copy.mode === "cc"
        ? { cc: copy.emails }
        : { bcc: copy.emails }
      : {}),
  };
}

async function deliverViaResend(
  plan: InquiryOfferSendPlan,
  params: {
    to: string;
    subject: string;
    html: string;
    headers: Record<string, string>;
    attachments: SendTransactionalEmailAttachment[];
    copy: InquiryOfferCopyDelivery | null;
  }
): Promise<
  | { ok: true; messageId: string | null; copyModeUsed: InquiryOfferCopyMode | null }
  | { ok: false; error: string; detail: string | null; domainNotVerified: boolean }
> {
  const base = {
    to: params.to,
    subject: params.subject,
    html: params.html,
    from: plan.fromHeader,
    replyTo: plan.replyTo,
    headers: params.headers,
    attachments: params.attachments,
  };

  let copyModeUsed: InquiryOfferCopyMode | null = params.copy?.emails.length
    ? params.copy.mode
    : null;
  let send = await sendTransactionalEmail(resendPayloadWithCopy(base, params.copy));

  if (
    !send.ok &&
    params.copy?.emails.length &&
    params.copy.mode === "bcc"
  ) {
    const fallbackCopy: InquiryOfferCopyDelivery = {
      emails: params.copy.emails,
      mode: "cc",
    };
    send = await sendTransactionalEmail(resendPayloadWithCopy(base, fallbackCopy));
    if (send.ok) copyModeUsed = "cc";
  }

  if (!send.ok) {
    const raw = `${send.error} ${send.detail ?? ""}`;
    return {
      ok: false,
      error: send.error,
      detail: send.detail,
      domainNotVerified: isResendDomainNotVerifiedError(raw),
    };
  }
  return {
    ok: true,
    messageId: send.messageId ?? params.headers["Message-ID"] ?? null,
    copyModeUsed,
  };
}

export async function sendInquiryOfferEmail(
  db: Firestore,
  params: SendInquiryOfferEmailParams
): Promise<SendInquiryOfferEmailResult> {
  const toNorm = params.to.trim().toLowerCase();
  if (!isValidEmailAddress(toNorm)) {
    return { ok: false, error: "Neplatná e-mailová adresa příjemce.", detail: null };
  }

  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(params.companyId).get();
  if (!companySnap.exists) {
    return { ok: false, error: "Organizace nenalezena.", detail: null };
  }
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const identity = readInquiryEmailIdentity(company);

  const userBodyPlain = params.bodyText.trim();
  if (!userBodyPlain) {
    return { ok: false, error: "Text nabídky je prázdný.", detail: null };
  }

  const pricing = calculateInquiryOfferPricing(
    parseInquiryPriceInput(params.priceNet),
    params.vatRate
  );
  const bodyPlain = buildInquiryOfferSentBodyPlain(userBodyPlain, pricing);

  let planResult = await buildInquiryOfferSendPlan({ company, identity });
  if ("error" in planResult) {
    return { ok: false, error: planResult.error, detail: null };
  }
  let plan = planResult;
  let sendNotice = plan.sendNotice;

  const threadId = buildInquiryOfferThreadId(params.companyId, params.leadKey);
  const replyDomain = plan.replyTo.split("@")[1] || "local";
  const customMessageId = buildMessageIdHeader(replyDomain);
  const headers = buildInquiryOfferDeliveryHeaders({
    messageId: customMessageId,
    threadId,
    replyTo: plan.replyTo,
  });

  const author = await resolveInquiryOfferAuthor({
    db,
    auth: getAdminAuth(),
    companyId: params.companyId,
    userId: params.userId,
  });
  const offerFooter: InquiryOfferFooterData = buildInquiryOfferFooterData({
    company,
    identity,
    author,
  });
  const authorHistory = buildInquiryOfferAuthorHistoryFields(author);

  const bodyInnerHtml = plainTextToHtmlParagraphs(bodyPlain);
  const html = buildInquiryOfferEmailHtml({
    bodyHtmlContent: bodyInnerHtml,
    organizationName: plan.fromDisplayName,
    footer: offerFooter,
  });

  const subject = params.subject.trim();
  let messageId: string | null = customMessageId;
  const attachmentRefs = params.attachments ?? [];
  let emailAttachments: SendTransactionalEmailAttachment[] = [];
  try {
    emailAttachments = await resolveInquiryOfferAttachmentsForEmail(attachmentRefs);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Přílohy se nepodařilo připravit.",
      detail: null,
    };
  }

  const attachmentsForHistory = mergeAttachmentRefsWithResolvedSizes(
    attachmentRefs,
    emailAttachments
  );
  const isStandalone =
    params.isStandalone === true || params.leadKey === INQUIRY_OFFER_STANDALONE_LEAD_KEY;

  const copyValidation = validateOfferCopyEmailsRaw(identity.offerCopyEmails);
  if (!copyValidation.ok) {
    return { ok: false, error: copyValidation.error, detail: null };
  }
  let offerCopyDelivery: InquiryOfferCopyDelivery | null = null;
  try {
    offerCopyDelivery = resolveInquiryOfferCopyDelivery(identity, toNorm);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR,
      detail: null,
    };
  }
  let offerCopyModeUsed: InquiryOfferCopyMode | null = null;

  if (plan.method === "org_smtp") {
    const smtpOut = await deliverViaSmtp(plan, identity, {
      to: toNorm,
      subject,
      html,
      bodyPlain,
      headers,
      attachments: emailAttachments,
      copy: offerCopyDelivery,
    });
    if (!smtpOut.ok) {
      return { ok: false, error: smtpOut.error, detail: smtpOut.detail };
    }
    messageId = smtpOut.messageId;
    offerCopyModeUsed = smtpOut.copyModeUsed;
  } else {
    let resendOut = await deliverViaResend(plan, {
      to: toNorm,
      subject,
      html,
      headers,
      attachments: emailAttachments,
      copy: offerCopyDelivery,
    });
    if (
      !resendOut.ok &&
      resendOut.domainNotVerified &&
      plan.method !== "platform_fallback"
    ) {
      planResult = await buildInquiryOfferSendPlan({
        company,
        identity,
        forcePlatformFallback: true,
      });
      if ("error" in planResult) {
        return { ok: false, error: planResult.error, detail: null };
      }
      plan = planResult;
      sendNotice = plan.sendNotice;
      resendOut = await deliverViaResend(plan, {
        to: toNorm,
        subject,
        html,
        headers,
        attachments: emailAttachments,
        copy: offerCopyDelivery,
      });
    }
    if (!resendOut.ok) {
      if (resendOut.domainNotVerified) {
        return {
          ok: false,
          error:
            "Organizace nemá ověřenou e-mailovou doménu a systémový odesílatel portálu není dostupný.",
          detail: resendOut.detail,
        };
      }
      return { ok: false, error: resendOut.error, detail: resendOut.detail };
    }
    messageId = resendOut.messageId;
    offerCopyModeUsed = resendOut.copyModeUsed;
  }

  const offersCol = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("inquiry_offers");

  const offerPayload = {
    companyId: params.companyId,
    leadKey: params.leadKey,
    importLeadId: params.importLeadId,
    status: "sent" as const,
    isStandalone,
    customerName: params.customerName?.trim() || null,
    customerPhone: params.customerPhone?.trim() || null,
    customerAddress: params.customerAddress?.trim() || null,
    to: toNorm,
    subject,
    bodyHtml: html,
    bodyPlain,
    priceNet: pricing.priceNet,
    vatRate: pricing.vatRate,
    vatAmount: pricing.vatAmount,
    priceGross: pricing.priceGross,
    attachments: attachmentsForHistory,
    internalNote: params.internalNote?.trim() || null,
    templateId: params.templateId ?? null,
    templateName: params.templateName ?? null,
    sentByUid: params.userId,
    sentByEmail: params.sentByEmail ?? null,
    sentByName: params.sentByName ?? null,
    ...buildInquiryOfferHistoryFields(plan),
    offerCopyTo: offerCopyDelivery?.emails ?? [],
    offerCopyMode: offerCopyModeUsed ?? offerCopyDelivery?.mode ?? null,
    offerFooter,
    ...authorHistory,
    messageId,
    threadId,
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  let offerId: string;
  const draftId = params.draftOfferId?.trim();
  if (draftId) {
    await offersCol.doc(draftId).set(offerPayload, { merge: true });
    offerId = draftId;
  } else {
    const ref = await offersCol.add({
      ...offerPayload,
      createdAt: FieldValue.serverTimestamp(),
    });
    offerId = ref.id;
  }

  if (!isStandalone) {
    await markLeadCustomerContacted(db, params.companyId, params.leadKey, {
      type: "offer",
      workflowStatus: "nabidka_odeslana",
    });
  }

  return {
    ok: true,
    offerId,
    messageId,
    threadId,
    sendNotice,
    sendPlan: plan,
  };
}

export async function saveInquiryOfferDraft(
  db: Firestore,
  params: Omit<SendInquiryOfferEmailParams, "draftOfferId"> & {
    draftOfferId?: string | null;
    bodyHtml?: string;
  }
): Promise<{ ok: true; offerId: string } | { ok: false; error: string }> {
  const toNorm = params.to.trim().toLowerCase();
  if (toNorm && !isValidEmailAddress(toNorm)) {
    return { ok: false, error: "Neplatná e-mailová adresa příjemce." };
  }

  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(params.companyId).get();
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const identity = readInquiryEmailIdentity(company);
  const planResult = await buildInquiryOfferSendPlan({ company, identity });
  const plan = "error" in planResult ? null : planResult;

  const pricing = calculateInquiryOfferPricing(
    parseInquiryPriceInput(params.priceNet),
    params.vatRate
  );
  const userBodyPlain = params.bodyText.trim();
  const bodyPlain = userBodyPlain
    ? buildInquiryOfferSentBodyPlain(userBodyPlain, pricing)
    : "";
  const author = await resolveInquiryOfferAuthor({
    db,
    auth: getAdminAuth(),
    companyId: params.companyId,
    userId: params.userId,
  });
  const offerFooter = buildInquiryOfferFooterData({ company, identity, author });
  const authorHistory = buildInquiryOfferAuthorHistoryFields(author);

  const bodyInnerHtml = bodyPlain ? plainTextToHtmlParagraphs(bodyPlain) : "";
  const html =
    params.bodyHtml?.trim() ||
    (bodyPlain && plan
      ? buildInquiryOfferEmailHtml({
          bodyHtmlContent: bodyInnerHtml,
          organizationName: plan.fromDisplayName,
          footer: offerFooter,
        })
      : "");

  const offersCol = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("inquiry_offers");

  const isStandalone =
    params.isStandalone === true || params.leadKey === INQUIRY_OFFER_STANDALONE_LEAD_KEY;

  const payload = {
    companyId: params.companyId,
    leadKey: params.leadKey,
    importLeadId: params.importLeadId,
    status: "draft" as const,
    isStandalone,
    customerName: params.customerName?.trim() || null,
    customerPhone: params.customerPhone?.trim() || null,
    customerAddress: params.customerAddress?.trim() || null,
    to: toNorm,
    subject: params.subject.trim(),
    bodyHtml: html,
    bodyPlain,
    priceNet: pricing.priceNet,
    vatRate: pricing.vatRate,
    vatAmount: pricing.vatAmount,
    priceGross: pricing.priceGross,
    attachments: params.attachments ?? [],
    internalNote: params.internalNote?.trim() || null,
    templateId: params.templateId ?? null,
    templateName: params.templateName ?? null,
    sentByUid: params.userId,
    sentByEmail: params.sentByEmail ?? null,
    sentByName: params.sentByName ?? null,
    ...(plan ? buildInquiryOfferHistoryFields(plan) : {}),
    offerFooter,
    ...authorHistory,
    threadId: buildInquiryOfferThreadId(params.companyId, params.leadKey),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const draftId = params.draftOfferId?.trim();
  if (draftId) {
    await offersCol.doc(draftId).set(payload, { merge: true });
    if (!isStandalone) {
      await updateLeadWorkflowStatus(db, params.companyId, params.leadKey, "nabidka_pripravena");
    }
    return { ok: true, offerId: draftId };
  }

  const ref = await offersCol.add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!isStandalone) {
    await updateLeadWorkflowStatus(db, params.companyId, params.leadKey, "nabidka_pripravena");
  }
  return { ok: true, offerId: ref.id };
}

async function updateLeadWorkflowStatus(
  db: Firestore,
  companyId: string,
  leadKey: string,
  status: InquiryWorkflowStatus
): Promise<void> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .doc(leadKey);
  await ref.set(
    {
      workflowStatus: status,
      workflowStatusUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function markLeadCustomerContacted(
  db: Firestore,
  companyId: string,
  leadKey: string,
  params: {
    type: "offer" | "email";
    workflowStatus?: InquiryWorkflowStatus;
  }
): Promise<void> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("import_lead_overlays")
    .doc(leadKey);
  const patch: Record<string, unknown> = {
    customerContacted: true,
    lastCustomerContactAt: FieldValue.serverTimestamp(),
    lastCustomerContactType: params.type,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (params.workflowStatus) {
    patch.workflowStatus = params.workflowStatus;
    patch.workflowStatusUpdatedAt = FieldValue.serverTimestamp();
  }
  await ref.set(patch, { merge: true });
}
