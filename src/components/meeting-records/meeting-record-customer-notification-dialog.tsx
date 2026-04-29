"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { MeetingRecordCustomerSendMode } from "@/lib/meeting-records-types";

function normalizeEmail(v: string): string {
  return String(v || "").trim().toLowerCase();
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function MeetingRecordCustomerNotificationDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  companyId: string;
  meetingId: string;
  jobId?: string | null;
  customerId?: string | null;
  meetingTitle?: string | null;
  lastUsedEmail?: string | null;
  user: User;
  /** Předvyplnění z UI (např. customerEmail ze zakázky). */
  defaultEmail?: string | null;
  /** Výchozí režim při opětovném odeslání. */
  defaultMode?: MeetingRecordCustomerSendMode | null;
  onSent?: () => void;
}) {
  const {
    open,
    onOpenChange,
    firestore,
    companyId,
    meetingId,
    jobId,
    customerId,
    meetingTitle,
    lastUsedEmail,
    user,
    defaultEmail,
    defaultMode,
    onSent,
  } = props;
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<MeetingRecordCustomerSendMode>("portalNotification");
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [sending, setSending] = useState(false);

  const seedEmail = useMemo(() => {
    const last = normalizeEmail(String(lastUsedEmail ?? ""));
    if (isValidEmail(last)) return last;
    const fromProps = normalizeEmail(String(defaultEmail ?? ""));
    if (isValidEmail(fromProps)) return fromProps;
    return "";
  }, [lastUsedEmail, defaultEmail]);

  useEffect(() => {
    if (!open) return;
    setEmail(seedEmail);
    setMode(defaultMode === "pdfEmail" ? "pdfEmail" : "portalNotification");
  }, [open, seedEmail, defaultMode]);

  useEffect(() => {
    if (!open) return;
    if (seedEmail) return;
    if (!firestore || !companyId) return;
    const jobIdStr = String(jobId ?? "").trim();
    const customerIdStr = String(customerId ?? "").trim();
    if (!jobIdStr && !customerIdStr) return;

    let cancelled = false;
    setLoadingEmail(true);
    (async () => {
      try {
        if (jobIdStr) {
          const js = await getDoc(doc(firestore, "companies", companyId, "jobs", jobIdStr));
          if (cancelled) return;
          if (js.exists()) {
            const j = (js.data() ?? {}) as Record<string, unknown>;
            const fromJob = normalizeEmail(String(j.customerEmail ?? ""));
            if (isValidEmail(fromJob)) {
              setEmail(fromJob);
              return;
            }
            const cid = String(j.customerId ?? "").trim();
            if (cid) {
              const cs = await getDoc(doc(firestore, "companies", companyId, "customers", cid));
              if (cancelled) return;
              if (cs.exists()) {
                const c = (cs.data() ?? {}) as Record<string, unknown>;
                const fromCustomer = normalizeEmail(String(c.customerPortalEmail ?? c.email ?? ""));
                if (isValidEmail(fromCustomer)) {
                  setEmail(fromCustomer);
                  return;
                }
              }
            }
          }
        }
        if (customerIdStr) {
          const cs = await getDoc(doc(firestore, "companies", companyId, "customers", customerIdStr));
          if (cancelled) return;
          if (cs.exists()) {
            const c = (cs.data() ?? {}) as Record<string, unknown>;
            const fromCustomer = normalizeEmail(String(c.customerPortalEmail ?? c.email ?? ""));
            if (isValidEmail(fromCustomer)) {
              setEmail(fromCustomer);
              return;
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingEmail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, seedEmail, firestore, companyId, jobId, customerId]);

  const finishWithoutSend = () => {
    onOpenChange(false);
  };

  const send = async () => {
    setSending(true);
    try {
      const emailNorm = normalizeEmail(email);
      if (!isValidEmail(emailNorm)) {
        throw new Error("Zákazník nemá vyplněný e-mail (zadejte ho ručně).");
      }
      const token = await user.getIdToken();
      const res = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/send-to-customer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: emailNorm,
          mode,
          jobId: jobId ?? null,
          customerId: customerId ?? null,
          organizationId: companyId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        success?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false || data.success === false) {
        throw new Error(
          typeof data.error === "string" && data.error.trim() ? data.error : "Odeslání se nezdařilo."
        );
      }
      toast({
        title: "E-mail byl odeslán",
        description:
          mode === "pdfEmail"
            ? "Zákazník obdržel e-mail se zápisem v příloze PDF."
            : "Zákazník obdržel upozornění do portálu (bez přílohy).",
      });
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "E-mail se nepodařilo odeslat",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Odeslat zápis zákazníkovi</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Zvolte způsob odeslání
            {meetingTitle?.trim() ? (
              <>
                {" "}
                pro zápis <span className="font-medium text-foreground">{meetingTitle.trim()}</span>
              </>
            ) : null}
            .
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="mr-send-email">E-mail zákazníka</Label>
            <Input
              id="mr-send-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="zakaznik@firma.cz"
              autoComplete="email"
            />
            {loadingEmail ? (
              <p className="text-xs text-muted-foreground">Načítám e-mail ze zakázky / profilu zákazníka…</p>
            ) : !email.trim() ? (
              <p className="text-xs text-destructive">Zákazník nemá vyplněný e-mail</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Způsob odeslání</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as MeetingRecordCustomerSendMode)}
              className="gap-3"
              disabled={sending}
            >
              <label
                htmlFor="mr-mode-portal"
                className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3"
              >
                <RadioGroupItem value="portalNotification" id="mr-mode-portal" className="mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Pouze upozornění do portálu</p>
                  <p className="text-xs text-muted-foreground">E-mail bez přílohy — odkaz do zákaznického portálu.</p>
                </div>
              </label>
              <label htmlFor="mr-mode-pdf" className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3">
                <RadioGroupItem value="pdfEmail" id="mr-mode-pdf" className="mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">PDF zápis do e-mailu</p>
                  <p className="text-xs text-muted-foreground">
                    Stejné odeslání jako u „Odeslat e-mailem“ včetně PDF přílohy.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="button" variant="outline" onClick={() => finishWithoutSend()} disabled={sending}>
            Zrušit
          </Button>
          <Button type="button" variant="secondary" onClick={() => finishWithoutSend()} disabled={sending}>
            Neodesílat
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
