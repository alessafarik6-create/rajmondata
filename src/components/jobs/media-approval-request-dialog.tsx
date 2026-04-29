"use client";

import React, { useEffect, useState } from "react";
import {
  doc,
  deleteField,
  getDoc,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Firestore,
  type UpdateData,
} from "firebase/firestore";
import {
  jobMediaDocumentRef,
  normalizeAdminApprovalNote,
  resolveCustomerPortalUidForJob,
  stripUndefined,
  syncCustomerTaskForMediaApproval,
  type JobMediaRef,
} from "@/lib/job-media-customer-approval";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";

export type MediaApprovalRequestDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firestore: Firestore;
  companyId: string;
  jobId: string;
  adminUid: string;
  jobRecord: Record<string, unknown> | null | undefined;
  target: JobMediaRef;
  fileLabel: string;
  initialRequires: boolean;
  initialAdminNote: string;
  initialApprovalEmailSent: boolean;
  onApplied: () => void;
};

export function MediaApprovalRequestDialog({
  open,
  onOpenChange,
  firestore,
  companyId,
  jobId,
  adminUid,
  jobRecord,
  target,
  fileLabel,
  initialRequires,
  initialAdminNote,
  initialApprovalEmailSent,
  onApplied,
}: MediaApprovalRequestDialogProps) {
  const { toast } = useToast();
  const { user } = useUser();
  const [requires, setRequires] = useState(initialRequires);
  const [note, setNote] = useState(initialAdminNote);
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequires(initialRequires);
    setNote(initialAdminNote);
    const fromJob = String((jobRecord as { customerEmail?: unknown })?.customerEmail ?? "")
      .trim()
      .toLowerCase();
    setEmail(fromJob);
  }, [open, initialRequires, initialAdminNote]);

  useEffect(() => {
    if (!open) return;
    const fromJob = String((jobRecord as { customerEmail?: unknown })?.customerEmail ?? "")
      .trim()
      .toLowerCase();
    if (fromJob) return;
    const customerId = String((jobRecord as { customerId?: unknown })?.customerId ?? "").trim();
    if (!customerId) return;
    let active = true;
    setEmailLoading(true);
    void getDoc(doc(firestore, "companies", companyId, "customers", customerId))
      .then((snap) => {
        if (!active || !snap.exists()) return;
        const c = (snap.data() ?? {}) as Record<string, unknown>;
        const fallback = String(c.email ?? c.customerPortalEmail ?? "").trim().toLowerCase();
        if (fallback) setEmail(fallback);
      })
      .finally(() => {
        if (active) setEmailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, jobRecord, firestore, companyId]);

  const apply = async () => {
    setSaving(true);
    try {
      const ref = jobMediaDocumentRef(firestore, companyId, jobId, target);
      const noteNorm = normalizeAdminApprovalNote(note);
      const portalUid = await resolveCustomerPortalUidForJob(firestore, companyId, jobRecord ?? {});

      if (requires) {
        if (!user) throw new Error("Chybí přihlášení uživatele.");
        const emailNorm = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
          throw new Error("Zadejte platný e-mail zákazníka.");
        }
        const idToken = await user.getIdToken();
        const endpoint = initialApprovalEmailSent
          ? `/api/jobs/${encodeURIComponent(jobId)}/approval-email/resend`
          : `/api/jobs/${encodeURIComponent(jobId)}/approval-email`;
        const res = await fetch(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              target,
              fileLabel,
              fileId:
                target.kind === "photos" ? target.photoId : `${target.folderId}:${target.imageId}`,
              organizationId: companyId,
              jobId,
              email: emailNorm,
              approvalNoteFromAdmin: noteNorm || null,
            }),
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          skipped?: string;
        };
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Nepodařilo se odeslat upozornění zákazníkovi."
          );
        }
        if (portalUid) {
          await syncCustomerTaskForMediaApproval({
            firestore,
            companyId,
            jobId,
            assignedCustomerUid: portalUid,
            adminUid,
            fileLabel,
            target,
            enabled: true,
          });
        }
        toast({
          title: initialApprovalEmailSent ? "E-mail byl odeslán" : "Ke schválení",
          description:
            data.skipped === "already_sent"
              ? data.message || "Dokument čeká na schválení. Upozornění už bylo odesláno dříve."
              : initialApprovalEmailSent
                ? "Upozornění bylo odesláno znovu."
                : "Zákazník uvidí dokument v sekci Ke schválení a bylo mu posláno upozornění e-mailem.",
        });
      } else {
        await updateDoc(
          ref,
          stripUndefined({
            requiresCustomerApproval: false,
            approvalStatus: deleteField(),
            approvalNoteFromAdmin: deleteField(),
            approvalRequestedAt: deleteField(),
            approvalRequestedBy: deleteField(),
            customerComment: deleteField(),
            customerCommentAt: deleteField(),
            customerCommentBy: deleteField(),
            approvedAt: deleteField(),
            approvedBy: deleteField(),
          }) as unknown as UpdateData<DocumentData>
        );
        if (portalUid) {
          await syncCustomerTaskForMediaApproval({
            firestore,
            companyId,
            jobId,
            assignedCustomerUid: portalUid,
            adminUid,
            fileLabel,
            target,
            enabled: false,
          });
        }
        toast({ title: "Schválení zrušeno", description: "Příznak u souboru byl odebrán." });
      }
      onApplied();
      onOpenChange(false);
    } catch (e) {
      console.error("approval-dialog error", e);
      toast({
        variant: "destructive",
        title: "E-mail se nepodařilo odeslat",
        description: e instanceof Error ? e.message : "Zkontrolujte oprávnění nebo připojení.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Schválení zákazníkem</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{fileLabel}</span> — po zapnutí uvidí zákazník
            náhled v sekci „Ke schválení“ na svém profilu zakázky.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <Label htmlFor="req-appr" className="text-sm font-medium">
              Vyžadovat schválení zákazníkem
            </Label>
            <Switch id="req-appr" checked={requires} onCheckedChange={setRequires} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adm-note">Poznámka pro zákazníka (volitelné)</Label>
            <Textarea
              id="adm-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Např. prosím potvrďte rozměry výkresu…"
              rows={4}
              className="min-h-[100px]"
              disabled={!requires}
            />
          </div>
          {requires ? (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Upozornění bude odesláno na e-mail zákazníka.
              </p>
              <Label htmlFor="approval-email">E-mail zákazníka</Label>
              <Input
                id="approval-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="zakaznik@firma.cz"
              />
              {emailLoading ? (
                <p className="text-[11px] text-muted-foreground">Načítám fallback e-mail z profilu zákazníka…</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
