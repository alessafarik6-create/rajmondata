/**
 * Kopie odeslaných nabídek (BCC / CC) — parsování a validace z nastavení organizace.
 */

import {
  isValidEmailAddress,
  type InquiryEmailIdentity,
} from "@/lib/inquiry-offer-email";

export type InquiryOfferCopyMode = "bcc" | "cc";

export const INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR =
  "Některá e-mailová adresa pro kopie nabídek není platná.";

export type InquiryOfferCopyDelivery = {
  emails: string[];
  mode: InquiryOfferCopyMode;
};

/** Rozdělí vstup na části (čárka, středník, nový řádek). */
export function splitOfferCopyEmailsInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

export function validateOfferCopyEmailsRaw(
  raw: string | null | undefined
): { ok: true; emails: string[] } | { ok: false; error: string } {
  const parts = splitOfferCopyEmailsInput(String(raw ?? "").trim());
  if (parts.length === 0) return { ok: true, emails: [] };
  const emails: string[] = [];
  for (const part of parts) {
    if (!isValidEmailAddress(part)) {
      return { ok: false, error: INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR };
    }
    emails.push(part.toLowerCase());
  }
  return { ok: true, emails: [...new Set(emails)] };
}

/** Kopie z identity — bez duplicity s hlavním příjemcem. Preferuje BCC. */
export function resolveInquiryOfferCopyDelivery(
  identity: InquiryEmailIdentity,
  primaryTo: string
): InquiryOfferCopyDelivery | null {
  const validated = validateOfferCopyEmailsRaw(identity.offerCopyEmails);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const primary = primaryTo.trim().toLowerCase();
  const emails = validated.emails.filter((e) => e !== primary);
  if (emails.length === 0) return null;
  return { emails, mode: "bcc" };
}

export function formatOfferCopyEmailsForDisplay(emails: string[] | null | undefined): string {
  const list = Array.isArray(emails) ? emails.filter(Boolean) : [];
  if (list.length === 0) return "—";
  return list.join(", ");
}

export const INQUIRY_OFFER_COPY_MODE_LABELS: Record<InquiryOfferCopyMode, string> = {
  bcc: "BCC (skrytá kopie)",
  cc: "CC (viditelná kopie)",
};
