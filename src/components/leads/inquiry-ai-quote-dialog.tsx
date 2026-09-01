"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import type {
  AiQuoteApplyInitial,
  AiValidatedQuoteResult,
} from "@/lib/ai/types";
import {
  formatInquiryPriceCz,
  formatPricingSummary,
} from "@/lib/inquiry-offer-pricing";
import type { InquiryOfferReuseInitial } from "@/lib/inquiry-offer-history";
import { mapInquiryAiUserErrorMessage } from "@/lib/ai/client-error-messages";

type InquiryAiQuoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  lead: LeadImportRow;
  leadKey: string;
  onApply: (initial: InquiryOfferReuseInitial, generationId: string) => void;
};

export function InquiryAiQuoteButton(props: {
  companyId: string;
  lead: LeadImportRow;
  leadKey: string;
  onResult: (result: AiValidatedQuoteResult, applyInitial: AiQuoteApplyInitial) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading || props.disabled || !user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/inquiry-ai/generate-quote", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: props.companyId,
          leadKey: props.leadKey,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        result?: AiValidatedQuoteResult;
        applyInitial?: AiQuoteApplyInitial;
      };
      if (!res.ok || !data.ok || !data.result || !data.applyInitial) {
        const userMsg = mapInquiryAiUserErrorMessage(res.status, data.error);
        throw new Error(userMsg);
      }
      props.onResult(data.result, data.applyInitial);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : mapInquiryAiUserErrorMessage(500);
      props.onError?.(msg);
      toast({ variant: "destructive", title: "AI asistent", description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={props.className}
      disabled={loading || props.disabled || !user}
      onClick={() => void handleClick()}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="mr-2 h-4 w-4 text-violet-600" aria-hidden />
      )}
      {loading ? "AI připravuje návrh…" : "Vytvořit návrh nabídky pomocí AI"}
    </Button>
  );
}

export function InquiryAiQuotePreviewDialog({
  open,
  onOpenChange,
  companyId,
  lead,
  leadKey,
  result,
  applyInitial,
  onApply,
}: InquiryAiQuoteDialogProps & {
  result: AiValidatedQuoteResult;
  applyInitial: AiQuoteApplyInitial;
}) {
  const { user } = useUser();
  const { toast } = useToast();
  const [customerReply, setCustomerReply] = useState(applyInitial.bodyText);
  const [markingUsed, setMarkingUsed] = useState(false);

  React.useEffect(() => {
    if (open) {
      setCustomerReply(applyInitial.bodyText);
    }
  }, [open, applyInitial.bodyText]);

  const pricingLabel = useMemo(
    () => formatPricingSummary(result.pricing),
    [result.pricing]
  );

  const markUsed = useCallback(
    async (finalSnapshot: Record<string, unknown>) => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        await fetch("/api/company/inquiry-ai/mark-used", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId,
            generationId: result.generationId,
            finalOfferSnapshot: finalSnapshot,
            aiSnapshot: {
              customerReply: applyInitial.bodyText,
              priceNet: applyInitial.priceNet,
            },
          }),
        });
      } catch (e) {
        console.error("[InquiryAiQuotePreviewDialog] mark-used", e);
      }
    },
    [user, companyId, result.generationId, applyInitial]
  );

  const handleApply = async () => {
    if (markingUsed) return;
    setMarkingUsed(true);
    const initial: InquiryOfferReuseInitial = {
      to: applyInitial.to || lead.email?.trim() || undefined,
      bodyText: customerReply.trim(),
      priceNet: result.pricing.priceNet,
      vatRate: result.vatRate,
      internalNote: applyInitial.internalNote,
      customerName: lead.jmeno?.trim() || undefined,
      customerPhone: lead.telefon?.trim() || undefined,
      customerAddress: lead.adresa?.trim() || undefined,
    };
    await markUsed({
      ...initial,
      leadKey,
      recommendedItems: result.recommendedItems,
    });
    onApply(initial, result.generationId);
    onOpenChange(false);
    setMarkingUsed(false);
    toast({
      title: "AI návrh připraven",
      description: "Údaje byly přeneseny do formuláře nabídky.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" aria-hidden />
            Návrh nabídky od AI
          </DialogTitle>
          <DialogDescription>
            Návrh je pouze doporučení — před odesláním zákazníkovi ho vždy
            zkontrolujte. AI nic neodesílá automaticky.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {result.warnings.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Shrnutí poptávky</h3>
            <p className="text-sm text-slate-700">{result.summary || "—"}</p>
            {result.customerRequirements.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                {result.customerRequirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Jistota AI:</span>
              <Badge variant="secondary">
                {Math.round(result.confidence * 100)} %
              </Badge>
              <span>· Model: {result.model}</span>
            </div>
          </section>

          {result.missingInformation.length > 0 ? (
            <section className="space-y-2 rounded-md border border-amber-200 bg-amber-50/80 p-3">
              <h3 className="text-sm font-semibold text-amber-950">
                Chybějící informace
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                {result.missingInformation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Navržené položky
            </h3>
            {result.recommendedItems.length === 0 ? (
              <p className="text-sm text-slate-500">
                AI nenavrhla žádné položky z katalogu. Doplňte chybějící
                informace nebo sestavte nabídku ručně.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produkt / služba</TableHead>
                      <TableHead>Množství</TableHead>
                      <TableHead>Jedn. cena</TableHead>
                      <TableHead>Sleva</TableHead>
                      <TableHead>Celkem bez DPH</TableHead>
                      <TableHead>Důvod</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.recommendedItems.map((item) => (
                      <TableRow key={`${item.catalogId}-${item.productId}`}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          {item.quantity} {item.unit}
                        </TableCell>
                        <TableCell>{formatInquiryPriceCz(item.unitPrice)}</TableCell>
                        <TableCell>{item.discountPercent} %</TableCell>
                        <TableCell>{formatInquiryPriceCz(item.lineNet)}</TableCell>
                        <TableCell className="max-w-[200px] text-xs text-slate-600">
                          {item.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-sm font-medium text-slate-800">
              Souhrn ceny (vypočteno CRM): {pricingLabel}
            </p>
          </section>

          <section className="space-y-2">
            <Label htmlFor="ai-customer-reply">Návrh odpovědi zákazníkovi</Label>
            <Textarea
              id="ai-customer-reply"
              rows={6}
              value={customerReply}
              onChange={(e) => setCustomerReply(e.target.value)}
              className="text-sm"
            />
          </section>

          {result.internalNotes ? (
            <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Interní poznámka AI
              </h3>
              <p className="whitespace-pre-wrap text-sm text-slate-600">
                {result.internalNotes}
              </p>
              <p className="text-xs text-slate-500">
                Tato poznámka se nepředává zákazníkovi — při použití návrhu bude
                zahrnuta do interní poznámky nabídky.
              </p>
            </section>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={markingUsed}
          >
            <X className="mr-1 h-4 w-4" aria-hidden />
            Zahodit návrh
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={markingUsed}
            >
              Upravit později
            </Button>
            <Button
              type="button"
              className="bg-orange-500 text-white hover:bg-orange-600"
              disabled={markingUsed}
              onClick={() => void handleApply()}
            >
              {markingUsed ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Použít návrh
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
