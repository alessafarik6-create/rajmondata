"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { InquiryOfferFooterData } from "@/lib/inquiry-offer-footer";

export function InquiryOfferFooterPreview(props: {
  footer: InquiryOfferFooterData | null;
  loading?: boolean;
}) {
  const footer = props.footer;
  if (props.loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Načítám firemní podpis…
      </div>
    );
  }
  if (!footer) return null;

  const author = footer.author;

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-4 sm:px-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Firemní podpis v e-mailu
      </p>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        {footer.logoUrl ? (
          <div className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={footer.logoUrl}
              alt={footer.companyName}
              className="max-h-14 max-w-[140px] object-contain"
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 gap-3">
          {author ? (
            <Avatar className="h-12 w-12 shrink-0 border border-slate-200">
              {author.photoUrl ? (
                <AvatarImage src={author.photoUrl} alt={author.displayName ?? ""} />
              ) : null}
              <AvatarFallback className="bg-slate-100 text-sm font-semibold text-slate-700">
                {author.initials ?? "?"}
              </AvatarFallback>
            </Avatar>
          ) : null}
          <div className="min-w-0 flex-1 space-y-1 text-sm leading-relaxed text-gray-900">
            <p className="text-base font-semibold text-gray-950">{footer.companyName}</p>
            {footer.ico ? <p className="text-gray-800">IČO: {footer.ico}</p> : null}
            {footer.addressMultiline ? (
              <p className="whitespace-pre-wrap break-words text-gray-800">
                {footer.addressMultiline}
              </p>
            ) : null}
            {footer.contactEmail ? (
              <p className="break-all text-gray-800">{footer.contactEmail}</p>
            ) : null}
            {footer.phone ? <p className="text-gray-800">{footer.phone}</p> : null}
            {footer.web ? (
              <p className="break-all text-gray-800">{footer.web}</p>
            ) : null}
            {author?.displayName ? (
              <>
                <p className="pt-2 text-xs text-slate-500">—</p>
                <p className="font-semibold text-gray-950">{author.displayName}</p>
                {author.jobTitle ? (
                  <p className="text-gray-700">{author.jobTitle}</p>
                ) : null}
                {author.email ? (
                  <p className="break-all text-gray-800">{author.email}</p>
                ) : null}
                {author.phone ? <p className="text-gray-800">{author.phone}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Tento podpis se zobrazí dole v odeslaném e-mailu pod textem nabídky.
      </p>
    </div>
  );
}
