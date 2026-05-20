/**
 * Historie nabídek — zobrazení a detekce úplnosti záznamu.
 */

import type { InquiryOfferRecord } from "@/lib/inquiry-offer-email";
import type { InquiryOfferFooterData } from "@/lib/inquiry-offer-footer";
import { authorInitialsFromName } from "@/lib/inquiry-offer-footer";
import { stripHtmlToPlain } from "@/lib/inquiry-offer-email";
import { INQUIRY_OFFER_SEND_METHOD_LABELS } from "@/lib/inquiry-offer-send-plan";
import type { InquiryOfferSendMethod } from "@/lib/inquiry-offer-email";
import {
  formatInquiryPriceCz,
  normalizeInquiryVatRate,
  type InquiryVatRate,
} from "@/lib/inquiry-offer-pricing";
import {
  formatAttachmentSizeBytes,
  INQUIRY_ATTACHMENT_SOURCE_LABELS,
  type InquiryOfferAttachmentRef,
} from "@/lib/inquiry-offer-attachments";
import {
  formatOfferCopyEmailsForDisplay,
  INQUIRY_OFFER_COPY_MODE_LABELS,
  type InquiryOfferCopyMode,
} from "@/lib/inquiry-offer-copy";

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
  return formatInquiryPriceCz(priceGross);
}

export function formatInquiryOfferPricingBlock(offer: InquiryOfferRecord): string {
  const net = offer.priceNet;
  const gross = offer.priceGross;
  if (net == null && gross == null) return "—";
  const vatRate = normalizeInquiryVatRate(offer.vatRate);
  const vat = offer.vatAmount;
  if (net != null) {
    const parts = [`bez DPH: ${formatInquiryPriceCz(net)}`];
    if (vat != null) parts.push(`DPH ${vatRate} %: ${formatInquiryPriceCz(vat)}`);
    if (gross != null) parts.push(`s DPH: ${formatInquiryPriceCz(gross)}`);
    return parts.join(" · ");
  }
  return formatInquiryPriceCz(gross);
}

export function listInquiryOfferAttachments(
  offer: InquiryOfferRecord
): InquiryOfferAttachmentRef[] {
  return Array.isArray(offer.attachments) ? offer.attachments : [];
}

export function formatInquiryOfferAttachmentLine(a: InquiryOfferAttachmentRef): string {
  const name = a.label?.trim() || a.filename;
  const size = formatAttachmentSizeBytes(a.sizeBytes);
  const source = INQUIRY_ATTACHMENT_SOURCE_LABELS[a.source] ?? a.source;
  return `${name} · ${size} · ${source}`;
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
  const copyEmails = Array.isArray(offer.offerCopyTo) ? offer.offerCopyTo.filter(Boolean) : [];
  const copyMode = (offer.offerCopyMode ?? null) as InquiryOfferCopyMode | null;
  const copyLabel =
    copyEmails.length > 0
      ? `${formatOfferCopyEmailsForDisplay(copyEmails)}${
          copyMode ? ` (${INQUIRY_OFFER_COPY_MODE_LABELS[copyMode]})` : ""
        }`
      : null;
  return { sendingMode, technicalFrom, displayFrom, replyTo, modeLabel, copyEmails, copyLabel, copyMode };
}

export type InquiryOfferReuseInitial = {
  to?: string;
  subject?: string;
  bodyText?: string;
  priceGross?: number | null;
  priceNet?: number | null;
  vatRate?: InquiryVatRate;
  internalNote?: string | null;
  templateId?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  attachments?: InquiryOfferAttachmentRef[];
};

export function parseInquiryOfferFooterFromRecord(
  offer: InquiryOfferRecord
): InquiryOfferFooterData | null {
  const raw = offer.offerFooter;
  if (!raw || typeof raw !== "object") return null;
  return raw as InquiryOfferFooterData;
}

/** Fotka autora z historie (uložená při odeslání) nebo ze snímku patičky. */
export function getInquiryOfferAuthorPhotoUrl(offer: InquiryOfferRecord): string | null {
  const direct = String(offer.authorPhotoUrl ?? "").trim();
  if (direct.startsWith("http://") || direct.startsWith("https://")) return direct;
  const footer = parseInquiryOfferFooterFromRecord(offer);
  const fromFooter = String(footer?.author?.photoUrl ?? "").trim();
  if (fromFooter.startsWith("http://") || fromFooter.startsWith("https://")) return fromFooter;
  return null;
}

export function getInquiryOfferAuthorDisplayMeta(offer: InquiryOfferRecord): {
  name: string | null;
  email: string | null;
  initials: string | null;
  photoUrl: string | null;
} {
  const name =
    String(offer.authorName ?? offer.sentByName ?? "").trim() ||
    parseInquiryOfferFooterFromRecord(offer)?.author?.displayName?.trim() ||
    null;
  const email =
    String(offer.authorEmail ?? offer.sentByEmail ?? "").trim() ||
    parseInquiryOfferFooterFromRecord(offer)?.author?.email?.trim() ||
    null;
  const photoUrl = getInquiryOfferAuthorPhotoUrl(offer);
  const initials =
    parseInquiryOfferFooterFromRecord(offer)?.author?.initials ??
    authorInitialsFromName(name);
  return { name, email, initials, photoUrl };
}

export function inquiryOfferToReuseInitial(offer: InquiryOfferRecord): InquiryOfferReuseInitial {
  return {
    to: offer.to?.trim() || undefined,
    subject: offer.subject?.trim() || undefined,
    bodyText: getInquiryOfferBodyForDisplay(offer) || undefined,
    priceNet: offer.priceNet ?? offer.priceGross ?? null,
    priceGross: offer.priceGross ?? null,
    vatRate: offer.vatRate != null ? normalizeInquiryVatRate(offer.vatRate) : undefined,
    internalNote: offer.internalNote ?? null,
    templateId: offer.templateId ?? null,
    customerName: offer.customerName?.trim() || undefined,
    customerPhone: offer.customerPhone?.trim() || undefined,
    customerAddress: offer.customerAddress?.trim() || undefined,
    attachments: listInquiryOfferAttachments(offer),
  };
}
