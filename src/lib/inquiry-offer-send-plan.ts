/**
 * Plán odeslání nabídky — SMTP organizace, ověřená doména Resend, nebo systémový fallback.
 */

import {
  isInquirySmtpConfigured,
  readInquiryEmailIdentity,
  resolveInquiryReplyToEmail,
  resolveInquirySenderEmail,
  resolveOrganizationDisplayName,
  type InquiryEmailIdentity,
  type InquiryOfferSendMethod,
} from "@/lib/inquiry-offer-email";
import {
  isResendSenderDomainVerified,
  resolvePlatformFallbackSenderEmail,
} from "@/lib/inquiry-offer-resend";

export type InquiryOfferSendPlan = {
  method: InquiryOfferSendMethod;
  fromDisplayName: string;
  /** Skutečná adresa v hlavičce From (technický odesílatel). */
  fromEmailTechnical: string;
  /** Stejné jako technical pro historii — zobrazované jméno je fromDisplayName. */
  fromHeader: string;
  replyTo: string;
  usedPlatformFallback: boolean;
  /** Preferovaný e-mail organizace (může být neověřený). */
  orgPreferredSenderEmail: string | null;
  /** Upozornění pro UI po úspěšném odeslání (fallback). */
  sendNotice: string | null;
};

export const INQUIRY_OFFER_SEND_METHOD_LABELS: Record<InquiryOfferSendMethod, string> = {
  org_smtp: "SMTP organizace",
  org_resend_verified: "E-mail organizace (ověřená doména)",
  platform_fallback: "Systémový e-mail portálu",
};

export function formatInquiryOfferFromHeader(displayName: string, email: string): string {
  const safeName = displayName.replace(/"/g, "'").trim() || "Organizace";
  return `${safeName} <${email.trim().toLowerCase()}>`;
}

export async function buildInquiryOfferSendPlan(params: {
  company: Record<string, unknown>;
  identity?: InquiryEmailIdentity;
  /** Vynutit systémový fallback (retry po chybě Resend). */
  forcePlatformFallback?: boolean;
}): Promise<InquiryOfferSendPlan | { error: string }> {
  const identity = params.identity ?? readInquiryEmailIdentity(params.company);
  const orgName = resolveOrganizationDisplayName(params.company, identity);
  const replyTo = resolveInquiryReplyToEmail(identity, params.company);
  if (!replyTo) {
    return {
      error:
        "Chybí e-mail organizace pro odpovědi. Nastavte reply-to nebo hlavní kontaktní e-mail v Nastavení.",
    };
  }

  const orgPreferred = resolveInquirySenderEmail(identity, params.company, false);

  if (isInquirySmtpConfigured(identity) && !params.forcePlatformFallback) {
    const smtpUser = String(identity.smtp?.user ?? "").trim().toLowerCase();
    const fromEmail = smtpUser || orgPreferred;
    if (!fromEmail) {
      return { error: "SMTP: chybí platná adresa odesílatele." };
    }
    return {
      method: "org_smtp",
      fromDisplayName: orgName,
      fromEmailTechnical: fromEmail,
      fromHeader: formatInquiryOfferFromHeader(orgName, fromEmail),
      replyTo,
      usedPlatformFallback: false,
      orgPreferredSenderEmail: orgPreferred,
      sendNotice: null,
    };
  }

  const platformEmail = resolvePlatformFallbackSenderEmail();
  if (!platformEmail) {
    return {
      error: "E-mail portálu není nakonfigurován (EMAIL_FROM nebo INQUIRY_OFFER_FALLBACK_FROM).",
    };
  }

  let useOrgResend = false;
  if (!params.forcePlatformFallback && orgPreferred) {
    useOrgResend = await isResendSenderDomainVerified(orgPreferred);
  }

  if (useOrgResend && orgPreferred) {
    return {
      method: "org_resend_verified",
      fromDisplayName: orgName,
      fromEmailTechnical: orgPreferred,
      fromHeader: formatInquiryOfferFromHeader(orgName, orgPreferred),
      replyTo,
      usedPlatformFallback: false,
      orgPreferredSenderEmail: orgPreferred,
      sendNotice: null,
    };
  }

  const notice =
    orgPreferred && !params.forcePlatformFallback
      ? "Organizace nemá ověřenou e-mailovou doménu. Nabídka bude odeslána přes systémový e-mail portálu."
      : params.forcePlatformFallback
        ? "Organizace nemá ověřenou e-mailovou doménu. Nabídka byla odeslána přes systémový e-mail portálu."
        : null;

  return {
    method: "platform_fallback",
    fromDisplayName: orgName,
    fromEmailTechnical: platformEmail,
    fromHeader: formatInquiryOfferFromHeader(orgName, platformEmail),
    replyTo,
    usedPlatformFallback: true,
    orgPreferredSenderEmail: orgPreferred,
    sendNotice: notice,
  };
}
