"use client";

import React from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Mail } from "lucide-react";
import type { LeadContactDisplay } from "@/lib/lead-contact-status";
import { cn } from "@/lib/utils";

export function LeadContactRowIndicator(props: {
  contact: LeadContactDisplay;
  className?: string;
}) {
  if (!props.contact.contacted || !props.contact.label) return null;
  const dateLabel = props.contact.lastAt
    ? format(props.contact.lastAt, "d. M. yyyy", { locale: cs })
    : null;

  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium sm:text-xs",
        props.contact.offerSent
          ? "border-emerald-300/80 bg-emerald-100/90 text-emerald-900"
          : "border-emerald-200/70 bg-emerald-50 text-emerald-800",
        props.className
      )}
      title={dateLabel ? `Poslední kontakt: ${dateLabel}` : props.contact.label}
    >
      <Mail className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{props.contact.label}</span>
      {dateLabel ? (
        <span className="shrink-0 tabular-nums text-emerald-800/90">· {dateLabel}</span>
      ) : null}
    </span>
  );
}
