"use client";

import React, { useEffect, useState } from "react";
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
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { User } from "firebase/auth";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  invoiceId: string;
  invoiceNumber: string;
  defaultTo: string;
  user: User;
  sentByEmail?: string | null;
  sentByName?: string | null;
  onSent?: () => void;
};

export function PortalInvoiceSendDialog({
  open,
  onOpenChange,
  companyId,
  invoiceId,
  invoiceNumber,
  defaultTo,
  user,
  sentByEmail,
  sentByName,
  onSent,
}: Props) {
  const { toast } = useToast();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(`Faktura ${invoiceNumber}`);
  const [body, setBody] = useState(
    `Dobrý den,\n\nv příloze zasíláme fakturu č. ${invoiceNumber}.\n\nS pozdravem`
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setSubject(`Faktura ${invoiceNumber}`);
    }
  }, [open, defaultTo, invoiceNumber]);

  const send = async () => {
    const toTrim = to.trim();
    if (!toTrim.includes("@")) {
      toast({ variant: "destructive", title: "E-mail", description: "Vyplňte platnou adresu příjemce." });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const bodyPlain = body.trim();
      const bodyHtml = bodyPlain
        .split(/\n/)
        .map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`)
        .join("");
      const res = await fetch(`/api/company/portal-invoices/${encodeURIComponent(invoiceId)}/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          to: toTrim,
          subject: subject.trim(),
          bodyHtml,
          bodyPlain,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sendNotice?: string | null;
        copyTo?: string[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Odeslání selhalo.");
      }
      toast({
        title: "Faktura odeslána",
        description:
          data.sendNotice ||
          (data.copyTo?.length
            ? `Kopie: ${data.copyTo.join(", ")}`
            : `Odesláno na ${toTrim}`),
      });
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Odeslání e-mailem",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Odeslat fakturu e-mailem</DialogTitle>
          <DialogDescription>
            PDF faktury bude v příloze. Kopie organizace se odešle dle nastavení nabídek / e-mailů.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="inv-send-to">Příjemce</Label>
            <Input id="inv-send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-send-subject">Předmět</Label>
            <Input id="inv-send-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-send-body">Text e-mailu</Label>
            <Textarea id="inv-send-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" className="gap-2" onClick={() => void send()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Odeslat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
