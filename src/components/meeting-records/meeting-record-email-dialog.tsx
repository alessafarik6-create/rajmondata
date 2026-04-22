"use client";

import React, { useEffect, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";
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

export function MeetingRecordEmailDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  companyId: string;
  recordId: string;
  recordTitle: string;
  jobId?: string | null;
  user: User;
  /** Předvyplněný příjemce (např. e-mail zákazníka ze zakázky). */
  defaultTo?: string | null;
  /** Po úspěchu odeslání (např. invalidace cache / toast v rodiči). */
  onSent?: () => void;
}) {
  const {
    open,
    onOpenChange,
    firestore,
    companyId,
    recordId,
    recordTitle,
    jobId,
    user,
    defaultTo,
    onSent,
  } = props;
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const title = recordTitle.trim() || "Schůzka";
    setSubject(`Zápis ze schůzky — ${title}`);
    setBody(
      "Dobrý den,\n\n" +
        "v příloze zasíláme zápis ze schůzky ve formátu PDF.\n\n" +
        "S pozdravem"
    );
    setCc("");
    const seed = String(defaultTo ?? "").trim();
    setTo(seed);
    if (seed || !jobId?.trim() || !firestore || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, "companies", companyId, "jobs", jobId.trim()));
        if (cancelled || !snap.exists()) return;
        const em = String((snap.data() as { customerEmail?: string }).customerEmail ?? "").trim();
        if (em) setTo(em);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, recordTitle, defaultTo, jobId, firestore, companyId]);

  const send = async () => {
    setSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/meeting-records/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyId,
          recordId,
          to,
          cc,
          subject,
          bodyPlain: body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.detail || "Odeslání se nezdařilo.");
      }
      toast({ title: "E-mail byl odeslán", description: "Zápis byl doručen s PDF v příloze." });
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
          <DialogTitle>Odeslat zápis e-mailem</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="mr-mail-to">Komu (e-mail)</Label>
            <Input
              id="mr-mail-to"
              className="bg-white"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="zakaznik@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mr-mail-cc">Kopie (CC), více adres oddělte čárkou</Label>
            <Input
              id="mr-mail-cc"
              className="bg-white"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="volitelné"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mr-mail-subj">Předmět</Label>
            <Input id="mr-mail-subj" className="bg-white" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mr-mail-body">Text e-mailu</Label>
            <Textarea
              id="mr-mail-body"
              className="bg-white min-h-[140px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Jako příloha se automaticky přiloží PDF zápisu (stejný obsah jako u exportu).
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void send()} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Odeslat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
