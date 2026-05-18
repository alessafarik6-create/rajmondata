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
  buildInquiryOfferEmailHtml,
  buildInquiryOfferThreadId,
  isValidEmailAddress,
  plainTextToHtmlParagraphs,
  readInquiryEmailIdentity,
  stripHtmlToPlain,
  type InquiryWorkflowStatus,
} from "@/lib/inquiry-offer-email";
import { isResendDomainNotVerifiedError } from "@/lib/inquiry-offer-resend";
import {
  buildInquiryOfferSendPlan,
  type InquiryOfferSendPlan,
} from "@/lib/inquiry-offer-send-plan";

export type SendInquiryOfferEmailParams = {
  companyId: string;
  leadKey: string;
  importLeadId: string;
  to: string;
  subject: string;
  bodyText: string;
  priceGross?: number | null;
  internalNote?: string | null;
  templateId?: string | null;
  templateName?: string | null;
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
  }
): Promise<{ ok: true; messageId: string } | { ok: false; error: string; detail: string | null }> {
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
    const info = await transporter.sendMail({
      from: plan.fromHeader,
      to: params.to,
      replyTo: plan.replyTo,
      subject: params.subject,
      html: params.html,
      text: stripHtmlToPlain(params.bodyPlain),
      headers: params.headers,
      envelope: {
        from: plan.fromEmailTechnical,
        to: params.to,
      },
    });
    const messageId = String(info.messageId ?? params.headers["Message-ID"] ?? "").trim();
    return { ok: true, messageId: messageId || params.headers["Message-ID"] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "Odeslání přes SMTP se nezdařilo.", detail: msg };
  }
}

async function deliverViaResend(
  plan: InquiryOfferSendPlan,
  params: {
    to: string;
    subject: string;
    html: string;
    headers: Record<string, string>;
  }
): Promise<
  | { ok: true; messageId: string | null }
  | { ok: false; error: string; detail: string | null; domainNotVerified: boolean }
> {
  const send = await sendTransactionalEmail({
    to: [params.to],
    subject: params.subject,
    html: params.html,
    from: plan.fromHeader,
    replyTo: plan.replyTo,
    headers: params.headers,
  });
  if (!send.ok) {
    const raw = `${send.error} ${send.detail ?? ""}`;
    return {
      ok: false,
      error: send.error,
      detail: send.detail,
      domainNotVerified: isResendDomainNotVerifiedError(raw),
    };
  }
  return { ok: true, messageId: send.messageId ?? params.headers["Message-ID"] ?? null };
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

  const bodyPlain = params.bodyText.trim();
  if (!bodyPlain) {
    return { ok: false, error: "Text nabídky je prázdný.", detail: null };
  }

  let planResult = await buildInquiryOfferSendPlan({ company, identity });
  if ("error" in planResult) {
    return { ok: false, error: planResult.error, detail: null };
  }
  let plan = planResult;
  let sendNotice = plan.sendNotice;

  const threadId = buildInquiryOfferThreadId(params.companyId, params.leadKey);
  const replyDomain = plan.replyTo.split("@")[1] || "local";
  const customMessageId = buildMessageIdHeader(replyDomain);
  const headers: Record<string, string> = {
    "Message-ID": customMessageId,
    "X-Inquiry-Thread": threadId,
    "X-Entity-Ref-ID": threadId,
  };

  const bodyInnerHtml = plainTextToHtmlParagraphs(bodyPlain);
  const html = buildInquiryOfferEmailHtml({
    bodyHtmlContent: bodyInnerHtml,
    organizationName: plan.fromDisplayName,
    logoUrl: String(company.organizationLogoUrl ?? "").trim() || null,
    signatureHtml: identity.emailSignatureHtml,
    phone: identity.phone ?? (String(company.phone ?? "").trim() || null),
    web: identity.web ?? (String(company.web ?? "").trim() || null),
    contactEmail: plan.replyTo,
  });

  const subject = params.subject.trim();
  let messageId: string | null = customMessageId;

  if (plan.method === "org_smtp") {
    const smtpOut = await deliverViaSmtp(plan, identity, {
      to: toNorm,
      subject,
      html,
      bodyPlain,
      headers,
    });
    if (!smtpOut.ok) {
      return { ok: false, error: smtpOut.error, detail: smtpOut.detail };
    }
    messageId = smtpOut.messageId;
  } else {
    let resendOut = await deliverViaResend(plan, { to: toNorm, subject, html, headers });
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
      resendOut = await deliverViaResend(plan, { to: toNorm, subject, html, headers });
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
    to: toNorm,
    subject,
    bodyHtml: html,
    bodyPlain,
    priceGross:
      params.priceGross != null && Number.isFinite(Number(params.priceGross))
        ? Math.round(Number(params.priceGross) * 100) / 100
        : null,
    internalNote: params.internalNote?.trim() || null,
    templateId: params.templateId ?? null,
    templateName: params.templateName ?? null,
    sentByUid: params.userId,
    sentByEmail: params.sentByEmail ?? null,
    sentByName: params.sentByName ?? null,
    fromEmail: plan.fromEmailTechnical,
    fromDisplayName: plan.fromDisplayName,
    replyToEmail: plan.replyTo,
    messageId,
    threadId,
    smtpUsed: plan.method === "org_smtp",
    sendMethod: plan.method,
    usedPlatformFallback: plan.usedPlatformFallback,
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

  await updateLeadWorkflowStatus(db, params.companyId, params.leadKey, "nabidka_odeslana");

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

  const bodyPlain = params.bodyText.trim();
  const bodyInnerHtml = bodyPlain ? plainTextToHtmlParagraphs(bodyPlain) : "";
  const html =
    params.bodyHtml?.trim() ||
    (bodyPlain && plan
      ? buildInquiryOfferEmailHtml({
          bodyHtmlContent: bodyInnerHtml,
          organizationName: plan.fromDisplayName,
          logoUrl: String(company.organizationLogoUrl ?? "").trim() || null,
          signatureHtml: identity.emailSignatureHtml,
          phone: identity.phone ?? (String(company.phone ?? "").trim() || null),
          web: identity.web ?? (String(company.web ?? "").trim() || null),
          contactEmail: plan.replyTo,
        })
      : "");

  const offersCol = db
    .collection(COMPANIES_COLLECTION)
    .doc(params.companyId)
    .collection("inquiry_offers");

  const payload = {
    companyId: params.companyId,
    leadKey: params.leadKey,
    importLeadId: params.importLeadId,
    status: "draft" as const,
    to: toNorm,
    subject: params.subject.trim(),
    bodyHtml: html,
    bodyPlain,
    priceGross:
      params.priceGross != null && Number.isFinite(Number(params.priceGross))
        ? Math.round(Number(params.priceGross) * 100) / 100
        : null,
    internalNote: params.internalNote?.trim() || null,
    templateId: params.templateId ?? null,
    templateName: params.templateName ?? null,
    sentByUid: params.userId,
    sentByEmail: params.sentByEmail ?? null,
    sentByName: params.sentByName ?? null,
    replyToEmail: plan?.replyTo ?? null,
    fromEmail: plan?.fromEmailTechnical ?? null,
    fromDisplayName: plan?.fromDisplayName ?? null,
    sendMethod: plan?.method ?? null,
    usedPlatformFallback: plan?.usedPlatformFallback ?? false,
    threadId: buildInquiryOfferThreadId(params.companyId, params.leadKey),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const draftId = params.draftOfferId?.trim();
  if (draftId) {
    await offersCol.doc(draftId).set(payload, { merge: true });
    await updateLeadWorkflowStatus(db, params.companyId, params.leadKey, "nabidka_pripravena");
    return { ok: true, offerId: draftId };
  }

  const ref = await offersCol.add({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
  });
  await updateLeadWorkflowStatus(db, params.companyId, params.leadKey, "nabidka_pripravena");
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
