"use client";

import type { LeadImportRow } from "@/lib/lead-import-parse";
import type { InquiryOfferTemplate } from "@/lib/inquiry-offer-email";
import type { InquiryOfferReuseInitial } from "@/lib/inquiry-offer-history";
import {
  InquiryOfferComposer,
  type InquiryOfferSentInfo,
} from "@/components/leads/inquiry-offer-composer";

export function LeadInquiryOfferDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  lead: LeadImportRow;
  leadKey: string;
  templates: InquiryOfferTemplate[];
  draftOfferId?: string | null;
  initial?: InquiryOfferReuseInitial;
  onSent?: (info: {
    offerId?: string;
    subject: string;
    bodyText: string;
    to: string;
    priceGross: number | null;
    internalNote: string | null;
    templateId: string | null;
    templateName: string | null;
  }) => void;
}) {
  return (
    <InquiryOfferComposer
      open={props.open}
      onOpenChange={props.onOpenChange}
      companyId={props.companyId}
      companyName={props.companyName}
      templates={props.templates}
      mode="lead"
      lead={props.lead}
      leadKey={props.leadKey}
      draftOfferId={props.draftOfferId}
      initial={props.initial}
      onSent={(info: InquiryOfferSentInfo) => {
        props.onSent?.({
          offerId: info.offerId,
          subject: info.subject,
          bodyText: info.bodyText,
          to: info.to,
          priceGross: info.priceGross,
          internalNote: info.internalNote,
          templateId: info.templateId,
          templateName: info.templateName,
        });
      }}
    />
  );
}

export function StandaloneInquiryOfferDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  templates: InquiryOfferTemplate[];
  initial?: InquiryOfferReuseInitial;
  onSent?: (info: InquiryOfferSentInfo) => void;
}) {
  return (
    <InquiryOfferComposer
      open={props.open}
      onOpenChange={props.onOpenChange}
      companyId={props.companyId}
      companyName={props.companyName}
      templates={props.templates}
      mode="standalone"
      initial={props.initial}
      onSent={props.onSent}
    />
  );
}
