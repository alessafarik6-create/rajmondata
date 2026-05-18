"use client";

import React, { useMemo } from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Timestamp } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { InquiryOfferRecord } from "@/lib/inquiry-offer-email";
import { INQUIRY_OFFER_SEND_METHOD_LABELS } from "@/lib/inquiry-offer-send-plan";

function tsToDate(raw: unknown): Date | null {
  if (
    raw &&
    typeof raw === "object" &&
    "toDate" in raw &&
    typeof (raw as Timestamp).toDate === "function"
  ) {
    return (raw as Timestamp).toDate();
  }
  return null;
}

function resolveOfferSendMeta(o: InquiryOfferRecord): {
  sendingMode: InquiryOfferRecord["sendingMode"];
  technicalFrom: string | null;
  displayFrom: string | null;
  replyTo: string | null;
} {
  const sendingMode = o.sendingMode ?? o.sendMethod ?? null;
  const technicalFrom = o.technicalFrom ?? o.fromEmail ?? null;
  const displayFrom =
    o.displayFrom ??
    (o.fromDisplayName && technicalFrom
      ? `${o.fromDisplayName} <${technicalFrom}>`
      : technicalFrom);
  const replyTo = o.replyTo ?? o.replyToEmail ?? null;
  return { sendingMode, technicalFrom, displayFrom, replyTo };
}

export function LeadInquiryOfferHistory(props: {
  offers: InquiryOfferRecord[];
  leadKey: string;
}) {
  const { toast } = useToast();
  const list = useMemo(
    () =>
      [...props.offers]
        .filter((o) => o.leadKey === props.leadKey)
        .sort((a, b) => {
          const da = tsToDate(a.sentAt) ?? tsToDate(a.createdAt);
          const db = tsToDate(b.sentAt) ?? tsToDate(b.createdAt);
          return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
        }),
    [props.offers, props.leadKey]
  );

  if (list.length === 0) {
    return (
      <p className="text-xs text-slate-600">Zatím žádná nabídka k této poptávce.</p>
    );
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Zkopírováno do schránky" });
    } catch {
      toast({ variant: "destructive", title: "Kopírování se nezdařilo" });
    }
  };

  return (
    <ul className="space-y-2">
      {list.map((o) => {
        const sent = tsToDate(o.sentAt) ?? tsToDate(o.createdAt);
        const dateLabel = sent ? format(sent, "d. M. yyyy HH:mm", { locale: cs }) : "—";
        const price =
          o.priceGross != null && Number.isFinite(o.priceGross)
            ? `${Math.round(o.priceGross).toLocaleString("cs-CZ")} Kč`
            : "—";
        const meta = resolveOfferSendMeta(o);
        return (
          <li
            key={o.id ?? `${o.subject}-${dateLabel}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <OfferHistoryHeader
              status={o.status}
              dateLabel={dateLabel}
              subject={o.subject}
              price={price}
            />
            <p className="mt-1 text-xs text-slate-600">
              Komu: <span className="break-all">{o.to || "—"}</span>
            </p>
            {o.sentByName || o.sentByEmail ? (
              <p className="text-xs text-slate-600">
                Odeslal: {o.sentByName || o.sentByEmail}
              </p>
            ) : null}
            {meta.sendingMode && INQUIRY_OFFER_SEND_METHOD_LABELS[meta.sendingMode] ? (
              <p className="text-xs text-slate-600">
                Způsob: {INQUIRY_OFFER_SEND_METHOD_LABELS[meta.sendingMode]}
              </p>
            ) : o.smtpUsed ? (
              <p className="text-xs text-slate-600">Způsob: SMTP organizace</p>
            ) : o.usedPlatformFallback ? (
              <p className="text-xs text-slate-600">Způsob: Systémový e-mail portálu</p>
            ) : null}
            {meta.displayFrom ? (
              <p className="text-xs text-slate-600 break-all">Odesláno jako: {meta.displayFrom}</p>
            ) : null}
            {meta.replyTo ? (
              <p className="text-xs text-slate-600 break-all">
                Odpovědi chodí na: {meta.replyTo}
              </p>
            ) : null}
            {o.templateName ? (
              <p className="text-xs text-slate-500">Šablona: {o.templateName}</p>
            ) : null}
            <OfferBodyPreview body={o.bodyPlain || ""} onCopy={() => void copyText(o.bodyPlain || "")} />
          </li>
        );
      })}
    </ul>
  );
}

function OfferHistoryHeader(props: {
  status: string;
  dateLabel: string;
  subject: string;
  price: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium text-slate-900">{props.subject || "—"}</span>
      <span className="text-xs text-slate-500">
        {props.status === "sent" ? "Odesláno" : "Koncept"} · {props.dateLabel}
      </span>
      <span className="w-full text-xs font-semibold text-orange-800 sm:w-auto">{props.price}</span>
    </div>
  );
}

function OfferBodyPreview(props: { body: string; onCopy: () => void }) {
  if (!props.body.trim()) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="line-clamp-3 whitespace-pre-wrap text-xs text-slate-700">{props.body}</p>
      <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={props.onCopy}>
        <Copy className="h-3.5 w-3.5" />
        Kopírovat text
      </Button>
    </div>
  );
}
