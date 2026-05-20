"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Mail, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { InquiryOfferAttachmentRef } from "@/lib/inquiry-offer-attachments";
import type { InquiryVatRate } from "@/lib/inquiry-offer-pricing";
import { useUser } from "@/firebase";

export type InquiryOfferEmailPreviewData = {
  to: string;
  subject: string;
  bodyPlain: string;
  bodyHtml: string;
  fromHeader: string;
  replyTo: string;
  methodLabel: string;
  sendNotice: string | null;
  copyLabel: string | null;
  pricing: {
    priceNet: number | null;
    vatRate: number;
    vatAmount: number | null;
    priceGross: number | null;
    priceNetLabel: string;
    vatAmountLabel: string;
    priceGrossLabel: string;
  };
  attachments: Array<InquiryOfferAttachmentRef & { line?: string }>;
};

export function InquiryOfferEmailPreviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  payload: {
    to: string;
    subject: string;
    bodyText: string;
    priceNet: number | null;
    vatRate: InquiryVatRate;
    attachments: InquiryOfferAttachmentRef[];
  };
  onEdit: () => void;
  onSend: () => void;
  sending?: boolean;
  sendDisabled?: boolean;
}) {
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InquiryOfferEmailPreviewData | null>(null);

  useEffect(() => {
    if (!props.open || !user || !props.companyId) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/company/inquiry-offers/email-preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            companyId: props.companyId,
            to: props.payload.to,
            subject: props.payload.subject,
            bodyText: props.payload.bodyText,
            priceNet: props.payload.priceNet,
            vatRate: props.payload.vatRate,
            attachments: props.payload.attachments,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          preview?: InquiryOfferEmailPreviewData;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok || !data.preview) {
          setPreview(null);
          setError(data.error ?? "Náhled se nepodařilo načíst.");
          return;
        }
        setPreview(data.preview);
      } catch {
        if (!cancelled) {
          setPreview(null);
          setError("Náhled se nepodařilo načíst.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    props.open,
    props.companyId,
    props.payload.to,
    props.payload.subject,
    props.payload.bodyText,
    props.payload.priceNet,
    props.payload.vatRate,
    props.payload.attachments,
    user,
  ]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-left">Náhled nabídky</DialogTitle>
          <p className="text-left text-sm text-slate-600">
            Takto uvidí zákazník e-mail před odesláním.
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-100 px-3 py-4 sm:px-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Sestavuji náhled…
            </div>
          ) : error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : preview ? (
            <div className="mx-auto w-full max-w-xl space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-gray-900 sm:p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Technické údaje odeslání
                </p>
                <dl className="space-y-1.5">
                  <div>
                    <dt className="text-xs text-slate-500">Komu</dt>
                    <dd className="break-all font-medium">{preview.to || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Předmět</dt>
                    <dd className="break-words font-medium">{preview.subject || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Odesláno jako (From)</dt>
                    <dd className="break-all text-sm">{preview.fromHeader}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Reply-to</dt>
                    <dd className="break-all font-medium text-slate-900">
                      {preview.replyTo}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Způsob</dt>
                    <dd>{preview.methodLabel}</dd>
                  </div>
                  {preview.copyLabel ? (
                    <div>
                      <dt className="text-xs text-slate-500">Kopie nabídky</dt>
                      <dd className="break-all text-sm">{preview.copyLabel}</dd>
                    </div>
                  ) : null}
                </dl>
                {preview.sendNotice ? (
                  <p className="mt-2 text-xs text-amber-800">{preview.sendNotice}</p>
                ) : null}
              </div>

              {preview.pricing.priceNet != null ? (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900">
                  <p>
                    Cena bez DPH: <strong>{preview.pricing.priceNetLabel}</strong>
                  </p>
                  <p>
                    DPH ({preview.pricing.vatRate} %):{" "}
                    <strong>{preview.pricing.vatAmountLabel}</strong>
                  </p>
                  <p>
                    Cena s DPH: <strong>{preview.pricing.priceGrossLabel}</strong>
                  </p>
                </div>
              ) : null}

              {preview.attachments.length > 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Přílohy
                  </p>
                  <ul className="space-y-0.5 text-sm text-gray-900">
                    {preview.attachments.map((a) => (
                      <li key={a.id} className="break-all">
                        {a.line ?? a.filename}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <Badge variant="outline" className="text-xs">
                    Náhled těla e-mailu u zákazníka
                  </Badge>
                </div>
                {preview.bodyHtml ? (
                  <iframe
                    title="Náhled e-mailu"
                    srcDoc={preview.bodyHtml}
                    className="block h-[min(52vh,520px)] w-full max-w-full border-0 bg-white"
                    sandbox=""
                  />
                ) : (
                  <p className="p-4 text-sm text-slate-600">Vyplňte text nabídky.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => props.onOpenChange(false)}
          >
            Zavřít
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full gap-2 sm:w-auto"
            onClick={() => {
              props.onOpenChange(false);
              props.onEdit();
            }}
          >
            <Pencil className="h-4 w-4" />
            Upravit
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full gap-2 bg-orange-600 hover:bg-orange-700 sm:w-auto"
            disabled={props.sending || props.sendDisabled || loading || !preview}
            onClick={() => void props.onSend()}
          >
            {props.sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            Odeslat e-mailem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
