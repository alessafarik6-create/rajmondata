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
  isInquirySmtpConfigured,
  isValidEmailAddress,
  plainTextToHtmlParagraphs,
  readInquiryEmailIdentity,
  resolveInquiryReplyToEmail,
  resolveInquirySenderEmail,
  resolveOrganizationDisplayName,
  stripHtmlToPlain,
  type InquiryWorkflowStatus,
} from "@/lib/inquiry-offer-email";

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
  /** Existující koncept — aktualizovat místo nového záznamu */
  draftOfferId?: string | null;
};

export type SendInquiryOfferEmailResult =
  | { ok: true; offerId: string; messageId: string | null; threadId: string }
  | { ok: false; error: string; detail: string | null };

function formatFromHeader(displayName: string, email: string): string {
  const safeName = displayName.replace(/"/g, "'").trim() || "Organizace";
  return `${safeName} <${email}>`;
}

function buildMessageIdHeader(domain: string): string {
  const token = crypto.randomBytes(12).toString("hex");
  const host = domain.replace(/^@/, "") || "mail.local";
  return `<inquiry-offer-${token}@${host}>`;
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
  const orgName = resolveOrganizationDisplayName(company, identity);
  const replyTo = resolveInquiryReplyToEmail(identity, company);
  if (!replyTo) {
    return {
      ok: false,
      error: "Chybí e-mail organizace pro odpovědi.",
      detail: "Nastavte v Nastavení → E-mailový podpis a identita pole Reply-to nebo Hlavní kontaktní e-mail.",
    };
  }

  const smtpUsed = isInquirySmtpConfigured(identity);
  const senderEmail = resolveInquirySenderEmail(identity, company, smtpUsed);
  const threadId = buildInquiryOfferThreadId(params.companyId, params.leadKey);

  const bodyPlain = params.bodyText.trim();
  if (!bodyPlain) {
    return { ok: false, error: "Text nabídky je prázdný.", detail: null };
  }

  const bodyInnerHtml = plainTextToHtmlParagraphs(bodyPlain);
  const html = buildInquiryOfferEmailHtml({
    bodyHtmlContent: bodyInnerHtml,
    organizationName: orgName,
    logoUrl: String(company.organizationLogoUrl ?? "").trim() || null,
    signatureHtml: identity.emailSignatureHtml,
    phone: identity.phone ?? (String(company.phone ?? "").trim() || null),
    web: identity.web ?? (String(company.web ?? "").trim() || null),
    contactEmail: replyTo,
  });

  const replyDomain = replyTo.split("@")[1] || "local";
  const customMessageId = buildMessageIdHeader(replyDomain);
  const headers: Record<string, string> = {
    "Message-ID": customMessageId,
    "X-Inquiry-Thread": threadId,
    "X-Entity-Ref-ID": threadId,
  };

  let messageId: string | null = customMessageId;
  let fromEmailUsed = senderEmail;
  let fromDisplayName = orgName;

  if (smtpUsed && identity.smtp) {
    const smtp = identity.smtp;
    const fromAddr =
      senderEmail ||
      String(smtp.user ?? "")
        .trim()
        .toLowerCase();
    if (!fromAddr || !isValidEmailAddress(fromAddr)) {
      return {
        ok: false,
        error: "SMTP: chybí platná adresa odesílatele.",
        detail: null,
      };
    }
    fromEmailUsed = fromAddr;
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
        from: formatFromHeader(orgName, fromAddr),
        to: toNorm,
        replyTo,
        subject: params.subject.trim(),
        html,
        text: stripHtmlToPlain(bodyPlain),
        headers: {
          ...headers,
        },
        envelope: {
          from: fromAddr,
          to: toNorm,
        },
      });
      messageId = String(info.messageId ?? customMessageId).trim() || customMessageId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: "Odeslání přes SMTP se nezdařilo.", detail: msg };
    }
  } else {
    const platformFrom = String(process.env.EMAIL_FROM ?? "").trim();
    if (!platformFrom) {
      return {
        ok: false,
        error: "E-mail není na serveru nakonfigurován.",
        detail: "EMAIL_FROM chybí.",
      };
    }
    const fromHeader = senderEmail
      ? formatFromHeader(orgName, senderEmail)
      : formatFromHeader(orgName, platformFrom.includes("<") ? platformFrom : platformFrom);

    const send = await sendTransactionalEmail({
      to: [toNorm],
      subject: params.subject.trim(),
      html,
      from: fromHeader.includes("<") ? fromHeader : formatFromHeader(orgName, platformFrom),
      replyTo,
      headers,
    });
    if (!send.ok) {
      return { ok: false, error: send.error, detail: send.detail };
    }
    messageId = send.messageId ?? customMessageId;
    fromEmailUsed = senderEmail || platformFrom.replace(/.*<([^>]+)>.*/, "$1").trim() || platformFrom;
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
    fromEmail: fromEmailUsed,
    fromDisplayName,
    replyToEmail: replyTo,
    messageId,
    threadId,
    smtpUsed,
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

  return { ok: true, offerId, messageId, threadId };
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
  const orgName = resolveOrganizationDisplayName(company, identity);
  const replyTo = resolveInquiryReplyToEmail(identity, company);
  const bodyPlain = params.bodyText.trim();
  const bodyInnerHtml = bodyPlain ? plainTextToHtmlParagraphs(bodyPlain) : "";
  const html =
    params.bodyHtml?.trim() ||
    (bodyPlain
      ? buildInquiryOfferEmailHtml({
          bodyHtmlContent: bodyInnerHtml,
          organizationName: orgName,
          logoUrl: String(company.organizationLogoUrl ?? "").trim() || null,
          signatureHtml: identity.emailSignatureHtml,
          phone: identity.phone ?? (String(company.phone ?? "").trim() || null),
          web: identity.web ?? (String(company.web ?? "").trim() || null),
          contactEmail: replyTo,
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
    replyToEmail: replyTo,
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
