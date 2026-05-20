"use client";

import React from "react";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Copy, RotateCcw, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { InquiryOfferRecord } from "@/lib/inquiry-offer-email";
import {
  formatInquiryOfferPricingBlock,
  getInquiryOfferBodyForDisplay,
  inquiryOfferHasFullDetail,
  INQUIRY_OFFER_LEGACY_DETAIL_MESSAGE,
  INQUIRY_OFFER_STATUS_LABELS,
  formatInquiryOfferAttachmentLine,
  listInquiryOfferAttachments,
  getInquiryOfferAuthorDisplayMeta,
  parseInquiryOfferFooterFromRecord,
  resolveInquiryOfferSendMeta,
} from "@/lib/inquiry-offer-history";
import {
  InquiryOfferAuthorAvatar,
  InquiryOfferFooterPreview,
} from "@/components/leads/inquiry-offer-footer-preview";
import { contactTimestampToDate } from "@/lib/lead-contact-status";

function formatSentAt(offer: InquiryOfferRecord): string {
  const d =
    contactTimestampToDate(offer.sentAt) ??
    contactTimestampToDate(offer.updatedAt) ??
    contactTimestampToDate(offer.createdAt);
  return d ? format(d, "d. M. yyyy HH:mm", { locale: cs }) : "—";
}

function DetailRow(props: { label: string; value: React.ReactNode }) {
  if (props.value == null || props.value === "") return null;
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{props.label}</p>
      <div className="break-words text-sm text-slate-900">{props.value}</div>
    </div>
  );
}

export function LeadInquiryOfferDetailDialog(props: {
  offer: InquiryOfferRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canResend?: boolean;
  onReuse?: (offer: InquiryOfferRecord) => void;
  onResend?: (offer: InquiryOfferRecord) => void;
}) {
  const { toast } = useToast();
  const [resendConfirmOpen, setResendConfirmOpen] = React.useState(false);
  const offer = props.offer;
  const hasDetail = offer ? inquiryOfferHasFullDetail(offer) : false;
  const bodyText = offer ? getInquiryOfferBodyForDisplay(offer) : "";
  const meta = offer ? resolveInquiryOfferSendMeta(offer) : null;
  const storedFooter = offer ? parseInquiryOfferFooterFromRecord(offer) : null;
  const authorMeta = offer ? getInquiryOfferAuthorDisplayMeta(offer) : null;
  const storedHtml = String(offer?.bodyHtml ?? "").trim();

  const copyBody = async () => {
    if (!bodyText.trim()) return;
    try {
      await navigator.clipboard.writeText(bodyText);
      toast({ title: "Text nabídky zkopírován" });
    } catch {
      toast({ variant: "destructive", title: "Kopírování se nezdařilo" });
    }
  };

  if (!offer) return null;

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:w-full">
          <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6">
            <DialogTitle className="pr-6 text-left">Detail nabídky</DialogTitle>
            <DialogDescription className="text-left">
              {INQUIRY_OFFER_STATUS_LABELS[offer.status] ?? offer.status}
              {offer.templateName ? ` · šablona ${offer.templateName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-6">
            <div className="space-y-4">
              <DetailRow label="Datum odeslání" value={formatSentAt(offer)} />
              <DetailRow label="Hlavní příjemce" value={offer.to || "—"} />
              {meta?.copyLabel ? (
                <DetailRow label="Kopie nabídky" value={meta.copyLabel} />
              ) : null}
              <DetailRow label="Předmět" value={offer.subject || "—"} />
              <DetailRow label="Cena" value={formatInquiryOfferPricingBlock(offer)} />
              {offer.isStandalone && offer.customerName ? (
                <DetailRow label="Zákazník" value={offer.customerName} />
              ) : null}
              {offer.isStandalone && offer.customerPhone ? (
                <DetailRow label="Telefon" value={offer.customerPhone} />
              ) : null}
              {offer.isStandalone && offer.customerAddress ? (
                <DetailRow label="Adresa" value={offer.customerAddress} />
              ) : null}
              {listInquiryOfferAttachments(offer).length > 0 ? (
                <DetailRow
                  label="Přílohy"
                  value={
                    <ul className="list-disc pl-4 space-y-0.5">
                      {listInquiryOfferAttachments(offer).map((a) => (
                        <li key={a.id}>{formatInquiryOfferAttachmentLine(a)}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}
              <DetailRow
                label="Stav"
                value={INQUIRY_OFFER_STATUS_LABELS[offer.status] ?? offer.status}
              />
              {authorMeta?.name || authorMeta?.email || offer.sentByName || offer.sentByEmail ? (
                <DetailRow
                  label="Autor nabídky"
                  value={
                    <div className="flex min-w-0 items-center gap-3">
                      <InquiryOfferAuthorAvatar
                        photoUrl={authorMeta?.photoUrl}
                        initials={authorMeta?.initials}
                        displayName={authorMeta?.name}
                        className="h-10 w-10 shrink-0 border border-slate-200"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium text-slate-900">
                          {authorMeta?.name || offer.sentByName || "—"}
                        </p>
                        {(authorMeta?.email || offer.sentByEmail) ? (
                          <p className="break-all text-sm text-slate-700">
                            {authorMeta?.email || offer.sentByEmail}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  }
                />
              ) : null}
              {meta?.displayFrom ? (
                <DetailRow label="Odesláno jako (odesílatel)" value={meta.displayFrom} />
              ) : null}
              {meta?.replyTo ? (
                <DetailRow label="Reply-to" value={meta.replyTo} />
              ) : null}
              {meta?.modeLabel ? <DetailRow label="Způsob odeslání" value={meta.modeLabel} /> : null}
              {offer.messageId ? (
                <DetailRow label="Message-ID" value={<span className="font-mono text-xs">{offer.messageId}</span>} />
              ) : null}
              {offer.threadId ? (
                <DetailRow label="Thread-ID" value={<span className="font-mono text-xs break-all">{offer.threadId}</span>} />
              ) : null}
              {offer.internalNote?.trim() ? (
                <DetailRow
                  label="Interní poznámka"
                  value={<p className="whitespace-pre-wrap">{offer.internalNote}</p>}
                />
              ) : null}
              {storedFooter ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Firemní podpis při odeslání
                  </p>
                  <InquiryOfferFooterPreview footer={storedFooter} />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Náhled e-mailu u zákazníka
                </p>
                {hasDetail && storedHtml.length > 80 ? (
                  <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                    <iframe
                      title="Odeslaná nabídka"
                      srcDoc={storedHtml}
                      className="block h-[min(50vh,480px)] w-full max-w-full border-0"
                      sandbox=""
                    />
                  </div>
                ) : hasDetail ? (
                  <div className="max-w-full rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{bodyText}</p>
                  </div>
                ) : (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-gray-900">
                    {INQUIRY_OFFER_LEGACY_DETAIL_MESSAGE}
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-col sm:px-6">
            {hasDetail ? (
              <Button type="button" variant="secondary" className="w-full min-h-11 gap-2" onClick={() => void copyBody()}>
                <Copy className="h-4 w-4" />
                Kopírovat celý text
              </Button>
            ) : null}
            {hasDetail && props.onReuse ? (
              <Button
                type="button"
                variant="outline"
                className="w-full min-h-11 gap-2"
                onClick={() => {
                  props.onReuse?.(offer);
                  props.onOpenChange(false);
                }}
              >
                <RotateCcw className="h-4 w-4" />
                Použít text v nové nabídce
              </Button>
            ) : null}
            {offer.status === "sent" && props.canResend && props.onResend && hasDetail ? (
              <Button
                type="button"
                className="w-full min-h-11 gap-2 bg-orange-600 hover:bg-orange-700"
                onClick={() => setResendConfirmOpen(true)}
              >
                <Send className="h-4 w-4" />
                Znovu odeslat nabídku
              </Button>
            ) : null}
            <Button type="button" variant="ghost" className="w-full min-h-11" onClick={() => props.onOpenChange(false)}>
              Zavřít
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resendConfirmOpen} onOpenChange={setResendConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Znovu odeslat nabídku?</AlertDialogTitle>
            <AlertDialogDescription>
              Zákazníkovi <strong>{offer.to}</strong> bude znovu odeslán e-mail s obsahem této nabídky.
              Před odesláním můžete text ještě upravit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="mt-0 w-full sm:w-auto">Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="w-full bg-orange-600 hover:bg-orange-700 sm:w-auto"
              onClick={() => {
                setResendConfirmOpen(false);
                props.onResend?.(offer);
                props.onOpenChange(false);
              }}
            >
              Pokračovat k odeslání
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
