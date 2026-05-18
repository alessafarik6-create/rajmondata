/**
 * Stav kontaktu se zákazníkem u importované poptávky (nabídka / e-mail).
 */

import { Timestamp } from "firebase/firestore";
import type { InquiryOfferRecord, InquiryWorkflowStatus } from "@/lib/inquiry-offer-email";

export type LeadCustomerContactType = "offer" | "email";

export type LeadOverlayContactFields = {
  workflowStatus?: string | null;
  lastCustomerContactAt?: unknown;
  lastCustomerContactType?: string | null;
  customerContacted?: boolean | null;
};

export type LeadContactDisplay = {
  contacted: boolean;
  offerSent: boolean;
  label: string | null;
  lastAt: Date | null;
  contactType: LeadCustomerContactType | null;
};

export function contactTimestampToDate(raw: unknown): Date | null {
  if (
    raw &&
    typeof raw === "object" &&
    "toDate" in raw &&
    typeof (raw as Timestamp).toDate === "function"
  ) {
    return (raw as Timestamp).toDate();
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw);
  }
  return null;
}

function latestSentOfferDate(offers: InquiryOfferRecord[]): Date | null {
  let best: Date | null = null;
  for (const o of offers) {
    if (o.status !== "sent") continue;
    const d = contactTimestampToDate(o.sentAt) ?? contactTimestampToDate(o.updatedAt);
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

function normalizeContactType(raw: unknown): LeadCustomerContactType | null {
  const t = String(raw ?? "").trim();
  return t === "offer" || t === "email" ? t : null;
}

/** Zda má poptávka odeslanou nabídku (workflow nebo historie). */
export function isLeadOfferSent(
  overlay: LeadOverlayContactFields | undefined,
  sentOffers: InquiryOfferRecord[]
): boolean {
  if (overlay?.workflowStatus === "nabidka_odeslana") return true;
  return sentOffers.some((o) => o.status === "sent");
}

/** Zda byl zákazník kontaktován (nabídka, e-mail nebo uložený kontakt). */
export function isLeadCustomerContacted(
  overlay: LeadOverlayContactFields | undefined,
  sentOffers: InquiryOfferRecord[]
): boolean {
  if (isLeadOfferSent(overlay, sentOffers)) return true;
  if (overlay?.customerContacted === true) return true;
  if (contactTimestampToDate(overlay?.lastCustomerContactAt)) return true;
  return false;
}

export function resolveLeadContactDisplay(
  overlay: LeadOverlayContactFields | undefined,
  sentOffers: InquiryOfferRecord[]
): LeadContactDisplay {
  const offerSent = isLeadOfferSent(overlay, sentOffers);
  const overlayAt = contactTimestampToDate(overlay?.lastCustomerContactAt);
  const offerAt = latestSentOfferDate(sentOffers);
  const overlayType = normalizeContactType(overlay?.lastCustomerContactType);

  let lastAt: Date | null = null;
  let contactType: LeadCustomerContactType | null = null;

  if (offerAt && overlayAt) {
    if (offerAt.getTime() >= overlayAt.getTime()) {
      lastAt = offerAt;
      contactType = "offer";
    } else {
      lastAt = overlayAt;
      contactType = overlayType ?? "email";
    }
  } else if (offerAt) {
    lastAt = offerAt;
    contactType = "offer";
  } else if (overlayAt) {
    lastAt = overlayAt;
    contactType = overlayType ?? "email";
  }

  const contacted = offerSent || overlay?.customerContacted === true || Boolean(overlayAt);

  let label: string | null = null;
  if (offerSent) label = "Nabídka odeslána";
  else if (contacted) label = "Kontaktováno";

  return {
    contacted,
    offerSent,
    label,
    lastAt,
    contactType: offerSent ? contactType ?? "offer" : contactType,
  };
}

export type LeadContactFilter = "" | "uncontacted" | "contacted" | "offer_sent";

export function leadMatchesContactFilter(
  filter: LeadContactFilter,
  overlay: LeadOverlayContactFields | undefined,
  sentOffers: InquiryOfferRecord[]
): boolean {
  if (!filter) return true;
  const display = resolveLeadContactDisplay(overlay, sentOffers);
  if (filter === "uncontacted") return !display.contacted;
  if (filter === "contacted") return display.contacted;
  if (filter === "offer_sent") return display.offerSent;
  return true;
}

export function buildLeadContactOverlayPatch(params: {
  type: LeadCustomerContactType;
  workflowStatus?: InquiryWorkflowStatus;
}): Record<string, unknown> {
  return {
    customerContacted: true,
    lastCustomerContactType: params.type,
    ...(params.workflowStatus ? { workflowStatus: params.workflowStatus } : {}),
  };
}
