"use client";

import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InquiryOfferRecord } from "@/lib/inquiry-offer-email";
import {
  formatInquiryOfferPrice,
  inquiryOfferHasFullDetail,
  INQUIRY_OFFER_STATUS_LABELS,
} from "@/lib/inquiry-offer-history";
import { contactTimestampToDate } from "@/lib/lead-contact-status";
import { LeadInquiryOfferDetailDialog } from "@/components/leads/lead-inquiry-offer-detail-dialog";

function formatOfferDate(offer: InquiryOfferRecord): string {
  const d =
    contactTimestampToDate(offer.sentAt) ??
    contactTimestampToDate(offer.updatedAt) ??
    contactTimestampToDate(offer.createdAt);
  return d ? format(d, "d. M. yyyy HH:mm", { locale: cs }) : "—";
}

export function LeadInquiryOfferHistory(props: {
  offers: InquiryOfferRecord[];
  leadKey: string;
  canResend?: boolean;
  onReuseOffer?: (offer: InquiryOfferRecord) => void;
  onResendOffer?: (offer: InquiryOfferRecord) => void;
}) {
  const [detailOffer, setDetailOffer] = useState<InquiryOfferRecord | null>(null);

  const list = useMemo(
    () =>
      [...props.offers]
        .filter((o) => o.leadKey === props.leadKey)
        .sort((a, b) => {
          const da =
            contactTimestampToDate(a.sentAt) ??
            contactTimestampToDate(a.updatedAt) ??
            contactTimestampToDate(a.createdAt);
          const db =
            contactTimestampToDate(b.sentAt) ??
            contactTimestampToDate(b.updatedAt) ??
            contactTimestampToDate(b.createdAt);
          return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
        }),
    [props.offers, props.leadKey]
  );

  if (list.length === 0) {
    return (
      <p className="text-xs text-slate-600">Zatím žádná nabídka k této poptávce.</p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {list.map((o) => {
          const dateLabel = formatOfferDate(o);
          const price = formatInquiryOfferPrice(o.priceGross);
          const statusLabel = INQUIRY_OFFER_STATUS_LABELS[o.status] ?? o.status;
          const hasDetail = inquiryOfferHasFullDetail(o);

          return (
            <li
              key={o.id ?? `${o.subject}-${dateLabel}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs tabular-nums text-slate-500">{dateLabel}</span>
                    <span
                      className={
                        o.status === "sent"
                          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900"
                          : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                      }
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <p className="break-words font-medium text-slate-900">{o.subject || "—"}</p>
                  <p className="break-all text-xs text-slate-600">Komu: {o.to || "—"}</p>
                  <p className="text-xs font-semibold text-orange-800">{price}</p>
                  {!hasDetail ? (
                    <p className="text-xs text-amber-800">
                      Detail nabídky není dostupný, protože nebyl uložen ve starší verzi.
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 w-full shrink-0 gap-1.5 sm:w-auto"
                  onClick={() => setDetailOffer(o)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Zobrazit nabídku
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <LeadInquiryOfferDetailDialog
        offer={detailOffer}
        open={!!detailOffer}
        onOpenChange={(open) => !open && setDetailOffer(null)}
        canResend={props.canResend}
        onReuse={props.onReuseOffer}
        onResend={props.onResendOffer}
      />
    </>
  );
}
