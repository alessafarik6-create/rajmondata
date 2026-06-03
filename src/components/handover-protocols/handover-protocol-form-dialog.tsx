"use client";

import React, { useEffect, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { logActivitySafe, type ActivityActorProfile } from "@/lib/activity-log";
import { buildHandoverProtocolSnapshot } from "@/lib/handover-protocol-context";
import { allocateNextHandoverProtocolNumber } from "@/lib/handover-protocol-allocate-client";
import {
  defaultHandoverProtocolForm,
  handoverProtocolFormFromDoc,
  newHandoverDefectRow,
  HANDOVER_DEFECT_STATUS_LABELS,
  type HandoverDefectRow,
  type HandoverDefectStatus,
  type HandoverProtocolForm,
} from "@/lib/handover-protocol-types";
import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";
import { getFirebaseStorage } from "@/firebase/storage";

function historyEvent(
  action: string,
  uid: string,
  name: string,
  detail?: string
) {
  return {
    at: new Date().toISOString(),
    action,
    byUserId: uid,
    byDisplayName: name,
    detail: detail ?? null,
  };
}

export function HandoverProtocolFormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobName: string;
  user: User;
  profile: ActivityActorProfile | null | undefined;
  companyDoc: Record<string, unknown> | null;
  workContracts: WorkContractDoc[];
  editProtocolId?: string | null;
  defaultWorkContractId?: string | null;
  defaultCustomerEmail?: string | null;
  onSaved?: () => void;
}) {
  const {
    open,
    onOpenChange,
    firestore,
    companyId,
    jobId,
    jobName,
    user,
    profile,
    companyDoc,
    workContracts,
    editProtocolId,
    defaultWorkContractId,
    onSaved,
  } = props;
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workContractId, setWorkContractId] = useState("");
  const [form, setForm] = useState<HandoverProtocolForm>(defaultHandoverProtocolForm());
  const [uploading, setUploading] = useState(false);

  const contractOptions = workContracts
    .filter((c) => {
      const role = String(c.documentRole ?? "").trim();
      return role !== "attachment" && role !== "addendum" && c.isTemplate !== true;
    })
    .map((c) => ({
      id: c.id,
      label: `${String(c.contractNumber ?? c.id)} — ${String(c.documentTitle ?? c.title ?? "Smlouva")}`,
    }));

  useEffect(() => {
    if (!open) return;
    if (editProtocolId) return;
    setWorkContractId(defaultWorkContractId?.trim() || contractOptions[0]?.id || "");
    setForm(defaultHandoverProtocolForm());
  }, [open, editProtocolId, defaultWorkContractId, contractOptions]);

  useEffect(() => {
    if (!open || !editProtocolId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(
          doc(firestore, "companies", companyId, "handoverProtocols", editProtocolId)
        );
        if (cancelled) return;
        if (!snap.exists()) {
          toast({ variant: "destructive", title: "Protokol neexistuje." });
          return;
        }
        const d = snap.data() as Record<string, unknown>;
        setWorkContractId(String(d.workContractId ?? ""));
        setForm(handoverProtocolFormFromDoc(d));
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editProtocolId, firestore, companyId, toast]);

  useEffect(() => {
    if (!open || editProtocolId || !workContractId) return;
    let cancelled = false;
    (async () => {
      try {
        const [jobSnap, wcSnap, custSnap] = await Promise.all([
          getDoc(doc(firestore, "companies", companyId, "jobs", jobId)),
          getDoc(
            doc(firestore, "companies", companyId, "jobs", jobId, "workContracts", workContractId)
          ),
          (async () => {
            const j = await getDoc(doc(firestore, "companies", companyId, "jobs", jobId));
            const cid = String((j.data() as { customerId?: string })?.customerId ?? "").trim();
            if (!cid) return null;
            return getDoc(doc(firestore, "companies", companyId, "customers", cid));
          })(),
        ]);
        if (cancelled) return;
        const snap = buildHandoverProtocolSnapshot({
          companyId,
          jobId,
          job: (jobSnap.data() ?? null) as Record<string, unknown> | null,
          customer: custSnap?.exists() ? (custSnap.data() as Record<string, unknown>) : null,
          companyDoc,
          workContract: wcSnap.exists()
            ? ({ id: workContractId, ...wcSnap.data() } as WorkContractDoc)
            : null,
          workContractId,
          existingForm: form,
        });
        setForm(snap.form);
      } catch {
        /* ignore prefetch */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only prefetch on contract change for new doc
  }, [open, editProtocolId, workContractId, companyId, jobId, firestore, companyDoc]);

  const actorName =
    profile?.displayName?.trim() ||
    user.displayName ||
    user.email?.split("@")[0] ||
    "Uživatel";

  const validate = (): boolean => {
    if (!form.documentTitle.trim()) {
      toast({ variant: "destructive", title: "Vyplňte název dokumentu." });
      return false;
    }
    if (!form.handoverDateLabel.trim()) {
      toast({ variant: "destructive", title: "Vyplňte datum předání." });
      return false;
    }
    if (!form.deliveredWork.trim()) {
      toast({ variant: "destructive", title: "Vyplňte předané dílo." });
      return false;
    }
    if (!form.completedWorkDescription.trim()) {
      toast({ variant: "destructive", title: "Vyplňte popis dokončených prací." });
      return false;
    }
    if (!form.handoverNote.trim()) {
      toast({ variant: "destructive", title: "Vyplňte poznámku k předání." });
      return false;
    }
    if (!workContractId.trim()) {
      toast({ variant: "destructive", title: "Vyberte smlouvu o dílo." });
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const [jobSnap, wcSnap, custSnap] = await Promise.all([
        getDoc(doc(firestore, "companies", companyId, "jobs", jobId)),
        getDoc(
          doc(firestore, "companies", companyId, "jobs", jobId, "workContracts", workContractId)
        ),
        (async () => {
          const j = await getDoc(doc(firestore, "companies", companyId, "jobs", jobId));
          const cid = String((j.data() as { customerId?: string })?.customerId ?? "").trim();
          if (!cid) return null;
          return getDoc(doc(firestore, "companies", companyId, "customers", cid));
        })(),
      ]);
      const built = buildHandoverProtocolSnapshot({
        companyId,
        jobId,
        job: (jobSnap.data() ?? null) as Record<string, unknown> | null,
        customer: custSnap?.exists() ? (custSnap.data() as Record<string, unknown>) : null,
        companyDoc,
        workContract: wcSnap.exists()
          ? ({ id: workContractId, ...wcSnap.data() } as WorkContractDoc)
          : null,
        workContractId,
        existingForm: form,
      });
      const formToSave: HandoverProtocolForm = {
        ...built.form,
        ...form,
        protocolNumber: form.protocolNumber.trim() || built.form.protocolNumber,
      };

      const isNew = !editProtocolId;
      const id = editProtocolId || doc(collection(firestore, "companies", companyId, "handoverProtocols")).id;
      let protocolNumber = formToSave.protocolNumber.trim();
      if (isNew && !protocolNumber) {
        try {
          protocolNumber = await allocateNextHandoverProtocolNumber(firestore, companyId);
        } catch {
          protocolNumber = `PP-${new Date().getFullYear()}-${id.slice(-6).toUpperCase()}`;
        }
        formToSave.protocolNumber = protocolNumber;
      }

      const payload: Record<string, unknown> = {
        companyId,
        jobId,
        workContractId,
        customerId: built.customerId,
        protocolNumber,
        ...(isNew ? { status: "draft", sharedWithCustomer: false } : {}),
        jobNumber: built.jobNumber,
        jobName: built.jobName,
        workContractNumber: built.workContractNumber,
        customerName: built.customerName,
        customerPhone: built.customerPhone,
        customerEmail: built.customerEmail,
        realizationAddress: built.realizationAddress,
        createdAtLabel: built.createdAtLabel,
        contractorCompanyName: built.contractorCompanyName,
        form: formToSave,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        activityHistory: isNew
          ? [historyEvent("created", user.uid, actorName, "Vytvoření protokolu")]
          : undefined,
      };

      if (isNew) {
        payload.createdAt = serverTimestamp();
        payload.createdBy = user.uid;
        payload.createdByName = actorName;
        await setDoc(doc(firestore, "companies", companyId, "handoverProtocols", id), payload);
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "handover_protocol_created",
          actionLabel: `Předávací protokol: ${formToSave.documentTitle}`,
          entityType: "handover_protocol",
          entityId: id,
          entityName: jobName,
          sourceModule: "zakazky",
          route: `/portal/jobs/${jobId}`,
        });
      } else {
        const { status: _s, sharedWithCustomer: _sh, activityHistory: _ah, ...updatePayload } =
          payload;
        await updateDoc(doc(firestore, "companies", companyId, "handoverProtocols", id), {
          ...updatePayload,
          activityHistory: arrayUnion(
            historyEvent("updated", user.uid, actorName, "Úprava protokolu")
          ),
        });
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "handover_protocol_updated",
          actionLabel: `Úprava protokolu: ${formToSave.documentTitle}`,
          entityType: "handover_protocol",
          entityId: id,
          entityName: jobName,
          sourceModule: "zakazky",
          route: `/portal/jobs/${jobId}`,
        });
      }

      toast({ title: isNew ? "Protokol vytvořen" : "Protokol uložen" });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  const setDefect = (idx: number, patch: Partial<HandoverDefectRow>) => {
    setForm((f) => {
      const defects = [...f.defects];
      defects[idx] = { ...defects[idx], ...patch };
      return { ...f, defects };
    });
  };

  const uploadFiles = async (files: FileList | null, protocolId: string) => {
    if (!files?.length || !editProtocolId) {
      toast({
        variant: "destructive",
        title: "Nejprve uložte protokol",
        description: "Přílohy lze nahrát až po vytvoření záznamu.",
      });
      return;
    }
    const storage = getFirebaseStorage();
    if (!storage) return;
    setUploading(true);
    try {
      const newAtts: { id: string; fileName: string; fileUrl: string; storagePath: string; mimeType: string; fileSize: number; createdAt: unknown; createdBy: string; visibleToCustomer: boolean }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const attId = `att-${Date.now()}-${i}`;
        const path = `companies/${companyId}/handoverProtocols/${protocolId}/attachments/${attId}_${file.name}`;
        const sref = storageRef(storage, path);
        await uploadBytes(sref, file);
        const url = await getDownloadURL(sref);
        newAtts.push({
          id: attId,
          fileName: file.name,
          fileUrl: url,
          storagePath: path,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          visibleToCustomer: true,
        });
      }
      await updateDoc(doc(firestore, "companies", companyId, "handoverProtocols", protocolId), {
        attachments: arrayUnion(...newAtts),
        updatedAt: serverTimestamp(),
        activityHistory: arrayUnion(
          historyEvent("attachment_added", user.uid, actorName, newAtts.map((a) => a.fileName).join(", "))
        ),
      });
      toast({ title: "Přílohy nahrány" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nahrání se nezdařilo",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-y-auto w-[min(100vw-1rem,720px)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editProtocolId ? "Upravit předávací protokol" : "Nový předávací protokol"}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Načítání…
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Smlouva o dílo *</Label>
                <Select
                  value={workContractId}
                  onValueChange={setWorkContractId}
                  disabled={!!editProtocolId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte smlouvu" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Název dokumentu *</Label>
                <Input
                  value={form.documentTitle}
                  onChange={(e) => setForm((f) => ({ ...f, documentTitle: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Datum předání *</Label>
                <Input
                  value={form.handoverDateLabel}
                  onChange={(e) => setForm((f) => ({ ...f, handoverDateLabel: e.target.value }))}
                  placeholder="např. 19. 5. 2026"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Předané dílo *</Label>
                <Input
                  value={form.deliveredWork}
                  onChange={(e) => setForm((f) => ({ ...f, deliveredWork: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Popis dokončených prací *</Label>
                <Textarea
                  className="min-h-[80px]"
                  value={form.completedWorkDescription}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, completedWorkDescription: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Poznámka k předání *</Label>
                <Textarea
                  className="min-h-[60px]"
                  value={form.handoverNote}
                  onChange={(e) => setForm((f) => ({ ...f, handoverNote: e.target.value }))}
                />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">Vady a nedodělky</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm((f) => ({ ...f, defects: [...f.defects, newHandoverDefectRow()] }))
                  }
                >
                  <Plus className="h-4 w-4 mr-1" /> Přidat řádek
                </Button>
              </div>
              {form.defects.length === 0 ? (
                <p className="text-xs text-muted-foreground">Žádné vady — volitelné.</p>
              ) : (
                <div className="space-y-2">
                  {form.defects.map((row, idx) => (
                    <div key={row.id} className="grid gap-2 sm:grid-cols-12 items-start border rounded p-2">
                      <div className="sm:col-span-5">
                        <Input
                          placeholder="Popis vady"
                          value={row.description}
                          onChange={(e) => setDefect(idx, { description: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Input
                          placeholder="Termín odstranění"
                          value={row.removalDeadline}
                          onChange={(e) => setDefect(idx, { removalDeadline: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Select
                          value={row.status}
                          onValueChange={(v) =>
                            setDefect(idx, { status: v as HandoverDefectStatus })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(HANDOVER_DEFECT_STATUS_LABELS) as HandoverDefectStatus[]).map(
                              (k) => (
                                <SelectItem key={k} value={k}>
                                  {HANDOVER_DEFECT_STATUS_LABELS[k]}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              defects: f.defects.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Předaná dokumentace</Label>
                <Input
                  value={form.handedDocumentation}
                  onChange={(e) => setForm((f) => ({ ...f, handedDocumentation: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Předané návody</Label>
                <Input
                  value={form.handedManuals}
                  onChange={(e) => setForm((f) => ({ ...f, handedManuals: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Předané klíče</Label>
                <Input
                  value={form.handedKeys}
                  onChange={(e) => setForm((f) => ({ ...f, handedKeys: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Další předané položky</Label>
                <Input
                  value={form.otherHandedItems}
                  onChange={(e) => setForm((f) => ({ ...f, otherHandedItems: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Text převzetí díla</Label>
              <Textarea
                className="min-h-[120px]"
                value={form.acceptanceText}
                onChange={(e) => setForm((f) => ({ ...f, acceptanceText: e.target.value }))}
              />
            </div>

            {editProtocolId ? (
              <div className="space-y-1.5">
                <Label>Fotodokumentace a přílohy</Label>
                <Input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.zip,application/pdf,application/zip"
                  disabled={uploading}
                  onChange={(e) => void uploadFiles(e.target.files, editProtocolId)}
                />
                <p className="text-xs text-muted-foreground">
                  Obrázky, PDF, ZIP a další dokumenty (viditelné v protokolu a u zákazníka).
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Po uložení protokolu můžete nahrát fotografie a přílohy.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Zrušit
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className={saving ? "ml-2" : ""}>Uložit</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
