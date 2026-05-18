/**
 * Historie nabídek — zobrazení a detekce úplnosti záznamu.
 */

import type { InquiryOfferRecord } from "@/lib/inquiry-offer-email";
import { stripHtmlToPlain } from "@/lib/inquiry-offer-email";
import { INQUIRY_OFFER_SEND_METHOD_LABELS } from "@/lib/inquiry-offer-send-plan";
import type { InquiryOfferSendMethod } from "@/lib/inquiry-offer-email";

export const INQUIRY_OFFER_LEGACY_DETAIL_MESSAGE =
  "Detail nabídky není dostupný, protože nebyl uložen ve starší verzi.";

export const INQUIRY_OFFER_STATUS_LABELS: Record<InquiryOfferRecord["status"], string> = {
  sent: "Odesláno",
  draft: "Koncept",
};

export function inquiryOfferHasFullDetail(offer: InquiryOfferRecord): boolean {
  const plain = String(offer.bodyPlain ?? "").trim();
  if (plain.length > 0) return true;
  const html = String(offer.bodyHtml ?? "").trim();
  return html.length > 24;
}

export function getInquiryOfferBodyForDisplay(offer: InquiryOfferRecord): string {
  const plain = String(offer.bodyPlain ?? "").trim();
  if (plain) return plain;
  return stripHtmlToPlain(String(offer.bodyHtml ?? ""));
}

export function formatInquiryOfferPrice(priceGross: number | null | undefined): string {
  if (priceGross == null || !Number.isFinite(priceGross)) return "—";
  return `${Math.round(priceGross).toLocaleString("cs-CZ")} Kč`;
}

export function resolveInquiryOfferSendMeta(offer: InquiryOfferRecord) {
  const sendingMode = (offer.sendingMode ?? offer.sendMethod ?? null) as InquiryOfferSendMethod | null;
  const technicalFrom = offer.technicalFrom ?? offer.fromEmail ?? null;
  const displayFrom =
    offer.displayFrom ??
    (offer.fromDisplayName && technicalFrom
      ? `${offer.fromDisplayName} <${technicalFrom}>`
      : technicalFrom);
  const replyTo = offer.replyTo ?? offer.replyToEmail ?? null;
  const modeLabel = sendingMode ? INQUIRY_OFFER_SEND_METHOD_LABELS[sendingMode] : null;
  return { sendingMode, technicalFrom, displayFrom, replyTo, modeLabel };
}

export type InquiryOfferReuseInitial = {
  to?: string;
  subject?: string;
  bodyText?: string;
  priceGross?: number | null;
  internalNote?: string | null;
  templateId?: string | null;
};

export function inquiryOfferToReuseInitial(offer: InquiryOfferRecord): InquiryOfferReuseInitial {
  return {
    to: offer.to?.trim() || undefined,
    subject: offer.subject?.trim() || undefined,
    bodyText: getInquiryOfferBodyForDisplay(offer) || undefined,
    priceGross: offer.priceGross ?? null,
    internalNote: offer.internalNote ?? null,
    templateId: offer.templateId ?? null,
  };
}
