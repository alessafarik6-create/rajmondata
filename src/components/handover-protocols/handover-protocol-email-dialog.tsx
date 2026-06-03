"use client";

import React, { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export function HandoverProtocolEmailDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  protocolId: string;
  documentTitle: string;
  jobName: string;
  jobNumber?: string | null;
  defaultTo?: string | null;
  user: User;
  onSent?: () => void;
}) {
  const {
    open,
    onOpenChange,
    companyId,
    protocolId,
    documentTitle,
    jobName,
    jobNumber,
    defaultTo,
    user,
    onSent,
  } = props;
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const num = jobNumber?.trim() ? ` (${jobNumber.trim()})` : "";
    setSubject(`Předávací protokol — ${documentTitle}${num}`);
    setMessage(
      `Dobrý den,\n\nv příloze zasíláme předávací protokol k zakázce ${jobName}${num}.\n\nS pozdravem`
    );
    setTo(String(defaultTo ?? "").trim());
  }, [open, documentTitle, jobName, jobNumber, defaultTo]);

  const send = async () => {
    if (!to.trim()) {
      toast({ variant: "destructive", title: "Vyplňte e-mail příjemce." });
      return;
    }
    setSending(true);
    try {
      const token = await user.getIdToken();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch("/api/company/handover-protocols/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyId,
          protocolId,
          to: to.trim(),
          subject: subject.trim(),
          message: message.trim(),
          origin,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Odeslání se nezdařilo.");
      }
      toast({ title: "Předávací protokol odeslán", description: "PDF bylo přiloženo k e-mailu." });
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Odeslání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,720px)] overflow-y-auto w-[min(100vw-1.5rem,520px)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Odeslat předávací protokol</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="hp-mail-to">Komu (e-mail)</Label>
            <Input
              id="hp-mail-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="zakaznik@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hp-mail-subj">Předmět</Label>
            <Input id="hp-mail-subj" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hp-mail-body">Text zprávy</Label>
            <Textarea
              id="hp-mail-body"
              className="min-h-[120px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void send()} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className={sending ? "ml-2" : ""}>Odeslat</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
