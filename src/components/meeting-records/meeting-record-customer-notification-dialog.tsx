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
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  /** Pokud známe z UI (např. ze zakázky) — použije se jako první seed. */
  defaultEmail?: string | null;
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
    onSent,
  } = props;
  const { toast } = useToast();
  const [email, setEmail] = useState("");
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
  }, [open, seedEmail]);

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
              // fallback customer doc by CRM id (same as meeting records use)
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

  const send = async () => {
    setSending(true);
    try {
      const emailNorm = normalizeEmail(email);
      if (!isValidEmail(emailNorm)) {
        throw new Error("Zákazník nemá vyplněný e-mail (zadejte ho ručně).");
      }
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/customer-notification-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: emailNorm,
            jobId: jobId ?? null,
            customerId: customerId ?? null,
            organizationId: companyId,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(typeof data.error === "string" && data.error.trim() ? data.error : "Odeslání se nezdařilo.");
      }
      toast({
        title: "E-mail byl odeslán",
        description: "Zákazník dostal upozornění na nový záznam ze schůzky.",
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
          <DialogTitle>Odeslat upozornění zákazníkovi?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Zákazníkovi bude odesláno upozornění na nový záznam ze schůzky
            {meetingTitle?.trim() ? (
              <>
                : <span className="font-medium text-foreground">{meetingTitle.trim()}</span>
              </>
            ) : null}
            .
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="mr-notify-email">E-mail zákazníka</Label>
            <Input
              id="mr-notify-email"
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
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Neodesílat
          </Button>
          <Button type="button" onClick={() => void send()} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Odeslat upozornění
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

