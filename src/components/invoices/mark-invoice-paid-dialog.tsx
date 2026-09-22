"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import {
  getPortalInvoicePaymentState,
  portalInvoiceTotalAmountGross,
} from "@/lib/invoice-payment-state";
import {
  invoicePaymentMethodLabel,
  type InvoicePaymentMethod,
} from "@/lib/portal-invoice-payment-eligibility";

export function MarkInvoicePaidDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  invoice: Record<string, unknown> & { id: string };
  todayIso: string;
  onSuccess?: () => void;
}) {
  const { open, onOpenChange, companyId, invoice, todayIso, onSuccess } = props;
  const { user } = useUser();
  const { toast } = useToast();
  const [paidAt, setPaidAt] = useState(todayIso);
  const [method, setMethod] = useState<InvoicePaymentMethod>("bank");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const label = String(
    invoice.invoiceNumber ?? invoice.documentNumber ?? invoice.id
  ).trim();

  const paymentState = useMemo(
    () => getPortalInvoicePaymentState(invoice, todayIso),
    [invoice, todayIso]
  );

  const total = paymentState.totalAmount || portalInvoiceTotalAmountGross(invoice);

  useEffect(() => {
    if (open) {
      setPaidAt(todayIso);
      setMethod("bank");
      setNote("");
    }
  }, [open, todayIso]);

  async function confirm() {
    if (!user || !companyId) return;
    if (paymentState.remainingAmount <= 0) {
      toast({
        variant: "destructive",
        title: "Faktura je uhrazena",
        description: "Zbývající částka je nulová.",
      });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/invoices/${encodeURIComponent(invoice.id)}/record-payment`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId,
            amount: paymentState.remainingAmount,
            paidAt,
            method,
            note: note.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Úhradu se nepodařilo uložit.");
      }
      toast({
        title: "Faktura uhrazena",
        description: `${label} · ${Math.round(paymentState.remainingAmount).toLocaleString("cs-CZ")} Kč`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Označit fakturu {label} jako plně uhrazenou?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1 tabular-nums">
            <p>
              Celkem:{" "}
              <span className="font-semibold">
                {Math.round(total).toLocaleString("cs-CZ")} Kč
              </span>
            </p>
            <p>
              Již uhrazeno:{" "}
              <span className="font-semibold">
                {Math.round(paymentState.paidAmount).toLocaleString("cs-CZ")} Kč
              </span>
            </p>
            <p>
              Zbývá:{" "}
              <span className="font-semibold text-emerald-800">
                {Math.round(paymentState.remainingAmount).toLocaleString("cs-CZ")} Kč
              </span>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-paid-at">Datum úhrady</Label>
            <Input
              id="inv-paid-at"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Způsob úhrady</Label>
            <RadioGroup
              value={method}
              onValueChange={(v) => setMethod(v as InvoicePaymentMethod)}
              className="grid gap-2"
            >
              {(["bank", "cash", "card", "other"] as InvoicePaymentMethod[]).map(
                (m) => (
                  <div key={m} className="flex items-center gap-2">
                    <RadioGroupItem value={m} id={`pay-m-${m}`} />
                    <Label htmlFor={`pay-m-${m}`} className="font-normal cursor-pointer">
                      {invoicePaymentMethodLabel(m)}
                    </Label>
                  </div>
                )
              )}
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-pay-note">Poznámka (volitelné)</Label>
            <Textarea
              id="inv-pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Potvrdit úhradu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
