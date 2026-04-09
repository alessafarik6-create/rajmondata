"use client";

import React, { useEffect, useState } from "react";
import {
  deleteField,
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

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
  onApplied,
}: MediaApprovalRequestDialogProps) {
  const { toast } = useToast();
  const [requires, setRequires] = useState(initialRequires);
  const [note, setNote] = useState(initialAdminNote);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequires(initialRequires);
    setNote(initialAdminNote);
  }, [open, initialRequires, initialAdminNote]);

  const apply = async () => {
    setSaving(true);
    try {
      const ref = jobMediaDocumentRef(firestore, companyId, jobId, target);
      const noteNorm = normalizeAdminApprovalNote(note);
      const portalUid = await resolveCustomerPortalUidForJob(firestore, companyId, jobRecord ?? {});

      if (requires) {
        await updateDoc(
          ref,
          stripUndefined({
            requiresCustomerApproval: true,
            approvalStatus: "pending",
            approvalNoteFromAdmin: noteNorm || null,
            approvalRequestedAt: serverTimestamp(),
            approvalRequestedBy: adminUid,
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
            enabled: true,
          });
        }
        toast({
          title: "Ke schválení",
          description: "Zákazník uvidí dokument v sekci Ke schválení.",
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
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: "Zkontrolujte oprávnění nebo připojení.",
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
