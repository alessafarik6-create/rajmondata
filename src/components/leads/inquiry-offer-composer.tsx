"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Save, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import {
  applyInquiryTemplateVariables,
  buildInquiryTemplateVariables,
  INQUIRY_OFFER_MISSING_REPLY_ERROR,
  INQUIRY_OFFER_STANDALONE_LEAD_KEY,
  isValidEmailAddress,
  type InquiryOfferTemplate,
} from "@/lib/inquiry-offer-email";
import {
  calculateInquiryOfferPricing,
  formatInquiryPriceCz,
  INQUIRY_VAT_RATES,
  type InquiryVatRate,
} from "@/lib/inquiry-offer-pricing";
import type { InquiryOfferAttachmentRef } from "@/lib/inquiry-offer-attachments";
import { InquiryOfferAttachmentsField } from "@/components/leads/inquiry-offer-attachments-field";
import type { InquiryOfferReuseInitial } from "@/lib/inquiry-offer-history";

export type InquiryOfferSentInfo = {
  offerId?: string;
  subject: string;
  bodyText: string;
  to: string;
  priceNet: number | null;
  vatRate: InquiryVatRate;
  vatAmount: number | null;
  priceGross: number | null;
  internalNote: string | null;
  templateId: string | null;
  templateName: string | null;
  attachments: InquiryOfferAttachmentRef[];
  isStandalone: boolean;
};

export type InquiryOfferComposerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  templates: InquiryOfferTemplate[];
  mode: "lead" | "standalone";
  lead?: LeadImportRow;
  leadKey?: string;
  draftOfferId?: string | null;
  initial?: InquiryOfferReuseInitial & {
    customerName?: string;
    customerPhone?: string;
    customerAddress?: string;
    vatRate?: InquiryVatRate;
    priceNet?: number | null;
    attachments?: InquiryOfferAttachmentRef[];
  };
  onSent?: (info: InquiryOfferSentInfo) => void;
};

function parsePriceInput(raw: string): number | null {
  const t = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function newUploadSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function InquiryOfferComposer(props: InquiryOfferComposerProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const isStandalone = props.mode === "standalone";

  const [to, setTo] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [vatRate, setVatRate] = useState<InquiryVatRate>(21);
  const [internalNote, setInternalNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [attachments, setAttachments] = useState<InquiryOfferAttachmentRef[]>([]);
  const [uploadSessionId, setUploadSessionId] = useState(newUploadSessionId);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sendPreview, setSendPreview] = useState<{
    methodLabel: string;
    fromHeader: string;
    replyTo: string;
    notice: string | null;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const activeTemplates = useMemo(
    () => props.templates.filter((t) => t.active !== false),
    [props.templates]
  );

  const priceNet = useMemo(() => parsePriceInput(priceInput), [priceInput]);
  const pricing = useMemo(
    () => calculateInquiryOfferPricing(priceNet, vatRate),
    [priceNet, vatRate]
  );

  const templateLead = useMemo((): LeadImportRow => {
    if (!isStandalone && props.lead) return props.lead;
    return {
      id: "",
      jmeno: customerName,
      email: to,
      telefon: customerPhone,
      adresa: customerAddress,
      typ: "",
      zprava: "",
    };
  }, [isStandalone, props.lead, customerName, to, customerPhone, customerAddress]);

  const applyTemplate = (tpl: InquiryOfferTemplate) => {
    const vars = buildInquiryTemplateVariables({
      lead: templateLead,
      companyName: props.companyName,
      priceGross: pricing.priceGross,
    });
    setSubject(applyInquiryTemplateVariables(tpl.subject, vars));
    setBodyText(applyInquiryTemplateVariables(tpl.bodyText, vars));
    setTemplateId(tpl.id ?? "");
  };

  useEffect(() => {
    if (!props.open) return;
    setUploadSessionId(newUploadSessionId());
    const init = props.initial;
    setTo(init?.to?.trim() || (isStandalone ? "" : String(props.lead?.email ?? "").trim()));
    setCustomerName(
      init?.customerName?.trim() ||
        (isStandalone ? "" : String(props.lead?.jmeno ?? "").trim())
    );
    setCustomerPhone(
      init?.customerPhone?.trim() ||
        (isStandalone ? "" : String(props.lead?.telefon ?? "").trim())
    );
    setCustomerAddress(
      init?.customerAddress?.trim() ||
        (isStandalone ? "" : String(props.lead?.adresa ?? "").trim())
    );
    setInternalNote(init?.internalNote ?? "");
    setVatRate(init?.vatRate ?? 21);
    setAttachments(init?.attachments ?? []);
    if (init?.priceNet != null) {
      setPriceInput(String(init.priceNet));
    } else if (init?.priceGross != null) {
      setPriceInput(String(init.priceGross));
    } else if (!isStandalone && props.lead?.orientacniCenaKc != null) {
      setPriceInput(String(props.lead.orientacniCenaKc));
    } else {
      setPriceInput("");
    }
    const defaultTpl =
      activeTemplates.find((t) => t.isDefault) ?? activeTemplates[0] ?? null;
    if (init?.subject || init?.bodyText) {
      setSubject(init.subject ?? "");
      setBodyText(init.bodyText ?? "");
      setTemplateId(init.templateId ?? "");
    } else if (defaultTpl) {
      applyTemplate(defaultTpl);
    } else {
      setSubject(
        isStandalone ? `Nabídka – ${props.companyName}` : `Nabídka – ${props.companyName}`
      );
      setBodyText("");
      setTemplateId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.leadKey, props.mode]);

  useEffect(() => {
    if (!props.open || !user || !props.companyId) {
      setSendPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/inquiry-offers/preview?companyId=${encodeURIComponent(props.companyId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          preview?: {
            methodLabel: string;
            fromHeader: string;
            replyTo: string;
            notice: string | null;
          };
        };
        if (cancelled) return;
        if (res.ok && data.ok && data.preview?.replyTo) {
          setSendPreview(data.preview);
          setPreviewError(null);
        } else {
          setSendPreview(null);
          setPreviewError(data.error ?? INQUIRY_OFFER_MISSING_REPLY_ERROR);
        }
      } catch {
        if (!cancelled) {
          setSendPreview(null);
          setPreviewError(INQUIRY_OFFER_MISSING_REPLY_ERROR);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open, props.companyId, user]);

  const selectedTemplate = activeTemplates.find((t) => t.id === templateId);
  const leadKey = isStandalone
    ? INQUIRY_OFFER_STANDALONE_LEAD_KEY
    : String(props.leadKey ?? "").trim();

  const postOffer = async (action: "send" | "draft") => {
    if (!user || !props.companyId) return;
    const toTrim = to.trim();
    if (action === "send" && (!toTrim || !isValidEmailAddress(toTrim))) {
      toast({
        variant: "destructive",
        title: "Chybí platný e-mail příjemce",
      });
      return;
    }
    if (isStandalone && action === "send" && !customerName.trim()) {
      toast({
        variant: "destructive",
        title: "Vyplňte jméno zákazníka",
      });
      return;
    }
    if (action === "send" && (previewError || !sendPreview?.replyTo)) {
      toast({
        variant: "destructive",
        title: "Chybí e-mail pro odpovědi",
        description: previewError ?? INQUIRY_OFFER_MISSING_REPLY_ERROR,
      });
      return;
    }
    if (!subject.trim() || !bodyText.trim()) {
      toast({
        variant: "destructive",
        title: "Vyplňte předmět a text nabídky",
      });
      return;
    }
    const setBusy = action === "send" ? setSending : setSavingDraft;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/inquiry-offers/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyId: props.companyId,
          leadKey,
          importLeadId: leadKey,
          isStandalone,
          action,
          to: toTrim,
          subject: subject.trim(),
          bodyText: bodyText.trim(),
          priceNet: pricing.priceNet,
          vatRate: pricing.vatRate,
          internalNote: internalNote.trim() || null,
          templateId: templateId || null,
          templateName: selectedTemplate?.name ?? null,
          draftOfferId: props.draftOfferId ?? null,
          attachments,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerAddress: customerAddress.trim() || null,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        sendNotice?: string | null;
        offerId?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || "Operace se nezdařila.");
      }
      const sendNotice = data.sendNotice?.trim();
      toast({
        title: action === "send" ? "Nabídka odeslána" : "Koncept uložen",
        description:
          action === "send"
            ? sendNotice || `E-mail byl odeslán na ${toTrim}.`
            : "Nabídku můžete upravit a odeslat později.",
      });
      if (action === "send") {
        props.onSent?.({
          offerId: data.offerId,
          subject: subject.trim(),
          bodyText: bodyText.trim(),
          to: toTrim,
          priceNet: pricing.priceNet,
          vatRate: pricing.vatRate,
          vatAmount: pricing.vatAmount,
          priceGross: pricing.priceGross,
          internalNote: internalNote.trim() || null,
          templateId: templateId || null,
          templateName: selectedTemplate?.name ?? null,
          attachments,
          isStandalone,
        });
      }
      props.onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: action === "send" ? "Odeslání selhalo" : "Uložení selhalo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  const title = isStandalone ? "Nová nabídka" : "Odpovědět nabídkou";
  const subtitle = isStandalone
    ? "E-mailová nabídka bez vazby na poptávku"
    : `${props.lead?.jmeno || "Poptávka"} — e-mail odejde jako vaše organizace`;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        data-inquiry-offer-composer
        className={[
          "!left-1/2 !top-1/2 !-translate-x-1/2 !-translate-y-1/2",
          "!flex !max-h-[95dvh] h-[min(92dvh,95dvh)] w-[min(90vw,calc(100vw-1.5rem))] !max-w-6xl",
          "flex-col gap-0 overflow-hidden rounded-xl border-0 p-0 shadow-2xl",
          "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:w-full max-sm:!max-w-full max-sm:rounded-none",
          "[&>button.absolute]:hidden",
        ].join(" ")}
        aria-describedby={undefined}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="text-left text-lg font-semibold text-slate-900">
              {title}
            </DialogTitle>
            <p className="truncate text-sm text-slate-600">{subtitle}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-slate-100/90">
          <div className="mx-auto w-full max-w-4xl space-y-0 divide-y divide-slate-200 border-x border-slate-200/80 bg-white shadow-sm sm:my-2 sm:rounded-lg sm:border">
            {isStandalone ? (
              <>
                <ComposerRow label="Jméno zákazníka" required>
                  <Input
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Jan Novák"
                  />
                </ComposerRow>
                <ComposerRow label="E-mail zákazníka" required>
                  <Input
                    type="email"
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="email@zakaznik.cz"
                  />
                </ComposerRow>
                <ComposerRow label="Telefon">
                  <Input
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="volitelné"
                  />
                </ComposerRow>
                <ComposerRow label="Adresa">
                  <Input
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="volitelné"
                  />
                </ComposerRow>
              </>
            ) : (
              <ComposerRow label="Komu" required>
                <Input
                  type="email"
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="email@zakaznik.cz"
                />
              </ComposerRow>
            )}

            <ComposerRow label="Předmět" required>
              <Input
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </ComposerRow>

            <ComposerRow label="Šablona">
              <Select
                value={templateId || "__none__"}
                onValueChange={(v) => {
                  const tpl = activeTemplates.find((t) => t.id === v);
                  if (tpl) applyTemplate(tpl);
                }}
              >
                <SelectTrigger className="border-0 bg-transparent shadow-none focus:ring-0">
                  <SelectValue placeholder="Vyberte šablonu" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— bez šablony —</SelectItem>
                  {activeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id!}>
                      {t.name}
                      {t.isDefault ? " (výchozí)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ComposerRow>

            <div className="px-4 py-3 sm:px-6">
              <Label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Text e-mailu
              </Label>
              <Textarea
                rows={16}
                className="min-h-[min(42vh,480px)] w-full resize-y border-slate-200 text-sm leading-relaxed sm:min-h-[min(38vh,520px)]"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Vložte text nabídky…"
              />
            </div>

            <ComposerRow label="Cena bez DPH (Kč)">
              <Input
                inputMode="decimal"
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="např. 150000"
              />
            </ComposerRow>

            <ComposerRow label="DPH">
              <Select
                value={String(vatRate)}
                onValueChange={(v) => setVatRate(Number(v) as InquiryVatRate)}
              >
                <SelectTrigger className="border-0 bg-transparent shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INQUIRY_VAT_RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r} %
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ComposerRow>

            {pricing.priceNet != null ? (
              <div className="bg-slate-50 px-4 py-3 text-sm text-slate-700 sm:px-6">
                <p>
                  Cena bez DPH: <strong>{formatInquiryPriceCz(pricing.priceNet)}</strong>
                </p>
                <p>
                  DPH ({pricing.vatRate} %): <strong>{formatInquiryPriceCz(pricing.vatAmount)}</strong>
                </p>
                <p>
                  Cena s DPH: <strong>{formatInquiryPriceCz(pricing.priceGross)}</strong>
                </p>
              </div>
            ) : null}

            <div className="px-4 py-3 sm:px-6">
              <InquiryOfferAttachmentsField
                companyId={props.companyId}
                attachments={attachments}
                onChange={setAttachments}
                uploadSessionId={uploadSessionId}
              />
            </div>

            <ComposerRow label="Interní poznámka">
              <Textarea
                rows={2}
                className="min-h-[4rem] resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="Jen pro tým, zákazník neuvidí"
              />
            </ComposerRow>

            <div className="rounded-none border-0 bg-slate-50 px-4 py-3 text-xs text-slate-700 sm:px-6">
              <p className="font-medium text-slate-900">Odeslání e-mailu</p>
              {previewLoading ? (
                <p className="mt-1 text-slate-500">Načítám nastavení odesílatele…</p>
              ) : previewError ? (
                <p className="mt-1 font-medium text-red-700">{previewError}</p>
              ) : sendPreview ? (
                <ul className="mt-1 space-y-0.5">
                  <li>
                    Způsob: <span className="font-medium">{sendPreview.methodLabel}</span>
                  </li>
                  <li className="break-all">Odesláno jako: {sendPreview.fromHeader}</li>
                  <li className="break-all font-medium text-slate-900">
                    Odpovědi zákazníka půjdou na: {sendPreview.replyTo}
                  </li>
                  {sendPreview.notice ? (
                    <li className="mt-1 text-amber-800">{sendPreview.notice}</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => props.onOpenChange(false)}
          >
            Zrušit
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full gap-2 sm:w-auto"
            disabled={sending || savingDraft}
            onClick={() => void postOffer("draft")}
          >
            {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Uložit koncept
          </Button>
          <Button
            type="button"
            className="min-h-11 w-full gap-2 bg-orange-600 hover:bg-orange-700 sm:w-auto"
            disabled={sending || savingDraft || previewLoading || Boolean(previewError)}
            onClick={() => void postOffer("send")}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Odeslat e-mailem
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComposerRow(props: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[8rem_1fr] sm:items-center sm:gap-4 sm:px-6 sm:py-3">
      <Label className="text-xs font-medium uppercase tracking-wide text-slate-500 sm:pt-0">
        {props.label}
        {props.required ? " *" : ""}
      </Label>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}
