"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
  isValidEmailAddress,
  parseInquiryOfferTemplateDoc,
  type InquiryOfferTemplate,
} from "@/lib/inquiry-offer-email";

export function LeadInquiryOfferDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  lead: LeadImportRow;
  leadKey: string;
  templates: InquiryOfferTemplate[];
  draftOfferId?: string | null;
  initial?: {
    to?: string;
    subject?: string;
    bodyText?: string;
    priceGross?: number | null;
    internalNote?: string | null;
    templateId?: string | null;
  };
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
  const { user } = useUser();
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sendPreview, setSendPreview] = useState<{
    methodLabel: string;
    fromDisplayName: string;
    fromEmailTechnical: string;
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

  const priceGross = useMemo(() => {
    const t = priceInput.replace(/\s/g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }, [priceInput]);

  const applyTemplate = (tpl: InquiryOfferTemplate) => {
    const vars = buildInquiryTemplateVariables({
      lead: props.lead,
      companyName: props.companyName,
      priceGross,
    });
    setSubject(applyInquiryTemplateVariables(tpl.subject, vars));
    setBodyText(applyInquiryTemplateVariables(tpl.bodyText, vars));
    setTemplateId(tpl.id ?? "");
  };

  useEffect(() => {
    if (!props.open) return;
    const init = props.initial;
    setTo(init?.to?.trim() || String(props.lead.email ?? "").trim());
    setInternalNote(init?.internalNote ?? "");
    setPriceInput(
      init?.priceGross != null
        ? String(init.priceGross)
        : props.lead.orientacniCenaKc != null
          ? String(props.lead.orientacniCenaKc)
          : ""
    );
    const defaultTpl =
      activeTemplates.find((t) => t.isDefault) ?? activeTemplates[0] ?? null;
    if (init?.subject || init?.bodyText) {
      setSubject(init.subject ?? "");
      setBodyText(init.bodyText ?? "");
      setTemplateId(init.templateId ?? "");
    } else if (defaultTpl) {
      applyTemplate(defaultTpl);
    } else {
      setSubject(`Nabídka – ${props.companyName}`);
      setBodyText("");
      setTemplateId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.leadKey]);

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
            fromDisplayName: string;
            fromEmailTechnical: string;
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

  const postOffer = async (action: "send" | "draft") => {
    if (!user || !props.companyId) return;
    const toTrim = to.trim();
    if (action === "send" && (!toTrim || !isValidEmailAddress(toTrim))) {
      toast({
        variant: "destructive",
        title: "Chybí e-mail",
        description: "Poptávka nemá platný e-mail příjemce — odeslání není možné.",
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
          leadKey: props.leadKey,
          importLeadId: props.leadKey,
          action,
          to: toTrim,
          subject: subject.trim(),
          bodyText: bodyText.trim(),
          priceGross,
          internalNote: internalNote.trim() || null,
          templateId: templateId || null,
          templateName: selectedTemplate?.name ?? null,
          draftOfferId: props.draftOfferId ?? null,
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
          priceGross,
          internalNote: internalNote.trim() || null,
          templateId: templateId || null,
          templateName: selectedTemplate?.name ?? null,
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

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[95dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6">
          <DialogTitle>Odpovědět nabídkou</DialogTitle>
          <DialogDescription>
            {props.lead.jmeno || "Poptávka"} — e-mail odejde jako vaše organizace.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="offer-tpl">Šablona nabídky</Label>
              <Select
                value={templateId || "__none__"}
                onValueChange={(v) => {
                  const tpl = activeTemplates.find((t) => t.id === v);
                  if (tpl) applyTemplate(tpl);
                }}
              >
                <SelectTrigger id="offer-tpl" className="w-full">
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-to">Příjemce</Label>
              <Input
                id="offer-to"
                type="email"
                className="w-full"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="email@zakaznik.cz"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-subject">Předmět e-mailu</Label>
              <Input
                id="offer-subject"
                className="w-full"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-body">Text nabídky / e-mailu</Label>
              <Textarea
                id="offer-body"
                rows={10}
                className="min-h-[180px] w-full resize-y text-sm"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Vložte text nabídky…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-price">Cena nabídky (Kč)</Label>
              <Input
                id="offer-price"
                className="w-full"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="např. 150000"
              />
              <p className="text-xs text-muted-foreground">
                Do textu vložte proměnnou {"{cena}"} nebo upravte částku ručně.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
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
              ) : (
                <p className="mt-1 text-slate-500">
                  Zákazník uvidí vaši organizaci; odpovědi půjdou na e-mail firmy.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-note">Interní poznámka</Label>
              <Textarea
                id="offer-note"
                rows={2}
                className="w-full resize-y"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="Jen pro tým, zákazník neuvidí"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-col sm:px-6">
          <Button
            type="button"
            className="w-full min-h-11 gap-2 bg-orange-600 hover:bg-orange-700"
            disabled={sending || savingDraft || previewLoading || Boolean(previewError)}
            onClick={() => void postOffer("send")}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Odeslat e-mailem
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full min-h-11 gap-2"
            disabled={sending || savingDraft}
            onClick={() => void postOffer("draft")}
          >
            {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Uložit jako koncept
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full min-h-11"
            onClick={() => props.onOpenChange(false)}
          >
            Zrušit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
