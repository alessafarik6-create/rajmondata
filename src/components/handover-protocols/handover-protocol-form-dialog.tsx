"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Eye, FileDown, Printer, Bookmark, LayoutTemplate } from "lucide-react";
import {
  HandoverProtocolPdfPreviewDialog,
  type HandoverProtocolDraftPreview,
} from "@/components/handover-protocols/handover-protocol-pdf-preview-dialog";
import { buildHandoverProtocolHtmlForPreview } from "@/lib/handover-protocol-pdf-build";
import {
  applyHandoverTemplateToForm,
  handoverTemplateContentFromForm,
} from "@/lib/handover-protocol-template-fields";
import {
  createHandoverProtocolTemplate,
  fetchHandoverProtocolTemplates,
  type HandoverProtocolTemplateDoc,
} from "@/lib/handover-protocol-templates-firestore";
import {
  downloadHandoverProtocolPdf,
  downloadHandoverProtocolPdfFromHtml,
} from "@/lib/handover-protocol-client-api";
import { printInvoiceHtmlDocument } from "@/lib/print-html";
import { logActivitySafe, type ActivityActorProfile } from "@/lib/activity-log";
import { buildHandoverProtocolSnapshot } from "@/lib/handover-protocol-context";
import { allocateNextHandoverProtocolNumber } from "@/lib/handover-protocol-allocate-client";
import {
  handoverEligibleContracts,
  pickDefaultHandoverContractId,
} from "@/lib/handover-protocol-contracts";
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

function ensureDefects(defects: unknown): HandoverDefectRow[] {
  return Array.isArray(defects) ? defects : [];
}

type SnapshotPreview = {
  jobName: string;
  jobNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  realizationAddress: string;
  workContractNumber: string;
};

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
  workContracts: unknown;
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
  const [preview, setPreview] = useState<SnapshotPreview | null>(null);
  const [prefetching, setPrefetching] = useState(false);
  const [templates, setTemplates] = useState<HandoverProtocolTemplateDoc[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const contractOptions = useMemo(
    () => handoverEligibleContracts(workContracts),
    [workContracts]
  );

  const hasContracts = contractOptions.length > 0;

  const selectValue = useMemo(() => {
    const id = String(workContractId ?? "").trim();
    if (!id) return undefined;
    return contractOptions.some((o) => o.id === id) ? id : undefined;
  }, [workContractId, contractOptions]);

  const loadSnapshotPreview = useCallback(
    async (contractId: string, mergeForm?: HandoverProtocolForm | null) => {
      if (!firestore || !companyId || !jobId || !contractId.trim()) {
        setPreview(null);
        return;
      }
      setPrefetching(true);
      try {
        const [jobSnap, wcSnap, custSnap] = await Promise.all([
          getDoc(doc(firestore, "companies", companyId, "jobs", jobId)),
          getDoc(
            doc(firestore, "companies", companyId, "jobs", jobId, "workContracts", contractId)
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
            ? ({ id: contractId, ...wcSnap.data() } as WorkContractDoc)
            : null,
          workContractId: contractId,
          existingForm: mergeForm ?? defaultHandoverProtocolForm(),
        });
        setPreview({
          jobName: built.jobName,
          jobNumber: built.jobNumber,
          customerName: built.customerName,
          customerPhone: built.customerPhone,
          customerEmail: built.customerEmail,
          realizationAddress: built.realizationAddress,
          workContractNumber: built.workContractNumber,
        });
        if (!editProtocolId) {
          setForm((prev) => ({
            ...built.form,
            documentTitle: prev.documentTitle?.trim() || built.form.documentTitle,
            handoverDateLabel:
              prev.handoverDateLabel?.trim() || built.form.handoverDateLabel,
            deliveredWork: prev.deliveredWork?.trim() || built.form.deliveredWork,
            completedWorkDescription:
              prev.completedWorkDescription?.trim() || built.form.completedWorkDescription,
            handoverNote: prev.handoverNote?.trim() || built.form.handoverNote,
            acceptanceText: prev.acceptanceText?.trim() || built.form.acceptanceText,
            defects: ensureDefects(prev.defects),
            handedDocumentation: prev.handedDocumentation,
            handedManuals: prev.handedManuals,
            handedKeys: prev.handedKeys,
            otherHandedItems: prev.otherHandedItems,
            protocolNumber: prev.protocolNumber,
          }));
        }
      } catch {
        setPreview(null);
      } finally {
        setPrefetching(false);
      }
    },
    [firestore, companyId, jobId, companyDoc, editProtocolId]
  );

  useEffect(() => {
    if (!open || !firestore || !companyId) return;
    let cancelled = false;
    setTemplatesLoading(true);
    void fetchHandoverProtocolTemplates(firestore, companyId)
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, firestore, companyId]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setSelectedTemplateId("");
      setPreviewOpen(false);
      return;
    }
    if (editProtocolId) return;

    const nextContractId = pickDefaultHandoverContractId(
      workContracts,
      defaultWorkContractId
    );
    setWorkContractId(nextContractId ?? "");
    setForm(defaultHandoverProtocolForm());

    if (nextContractId) {
      void loadSnapshotPreview(nextContractId, defaultHandoverProtocolForm());
    } else {
      setPreview(null);
    }
  }, [open, editProtocolId, defaultWorkContractId, workContracts, loadSnapshotPreview]);

  useEffect(() => {
    if (!open || !editProtocolId || !firestore) return;
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
        const wcId = String(d.workContractId ?? "").trim();
        setWorkContractId(wcId);
        const parsed = handoverProtocolFormFromDoc(d);
        setForm({ ...parsed, defects: ensureDefects(parsed.defects) });
        setPreview({
          jobName: String(d.jobName ?? jobName),
          jobNumber: String(d.jobNumber ?? ""),
          customerName: String(d.customerName ?? ""),
          customerPhone: String(d.customerPhone ?? ""),
          customerEmail: String(d.customerEmail ?? ""),
          realizationAddress: String(d.realizationAddress ?? ""),
          workContractNumber: String(d.workContractNumber ?? ""),
        });
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
  }, [open, editProtocolId, firestore, companyId, toast, jobName]);

  const handleContractChange = (nextId: string) => {
    setWorkContractId(nextId);
    if (nextId.trim() && !editProtocolId) {
      void loadSnapshotPreview(nextId, defaultHandoverProtocolForm());
    }
  };

  const actorName =
    profile?.displayName?.trim() ||
    user.displayName ||
    user.email?.split("@")[0] ||
    "Uživatel";

  const validate = (): boolean => {
    if (!hasContracts) {
      toast({
        variant: "destructive",
        title: "Nejdříve vytvořte smlouvu o dílo.",
      });
      return false;
    }
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
        existingForm: { ...form, defects: ensureDefects(form.defects) },
      });
      const formToSave: HandoverProtocolForm = {
        ...built.form,
        ...form,
        defects: ensureDefects(form.defects),
        protocolNumber: form.protocolNumber.trim() || built.form.protocolNumber,
      };

      const isNew = !editProtocolId;
      const id =
        editProtocolId || doc(collection(firestore, "companies", companyId, "handoverProtocols")).id;
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
      const defects = ensureDefects(f.defects);
      if (idx < 0 || idx >= defects.length) return f;
      const next = defects.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...f, defects: next };
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
      const fileList = Array.from(files);
      const newAtts: {
        id: string;
        fileName: string;
        fileUrl: string;
        storagePath: string;
        mimeType: string;
        fileSize: number;
        createdAt: unknown;
        createdBy: string;
        visibleToCustomer: boolean;
      }[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]!;
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
          historyEvent(
            "attachment_added",
            user.uid,
            actorName,
            newAtts.map((a) => a.fileName).join(", ")
          )
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

  const defects = ensureDefects(form.defects);

  const buildDraftSnapshot = (): HandoverProtocolDraftPreview["snapshot"] | null => {
    if (!preview) return null;
    const today = new Intl.DateTimeFormat("cs-CZ").format(new Date());
    return {
      jobNumber: preview.jobNumber,
      jobName: preview.jobName,
      workContractNumber: preview.workContractNumber,
      customerName: preview.customerName,
      realizationAddress: preview.realizationAddress,
      customerPhone: preview.customerPhone,
      customerEmail: preview.customerEmail,
      createdAtLabel: today,
      contractorCompanyName: "",
    };
  };

  const draftPreview: HandoverProtocolDraftPreview | null = preview
    ? {
        form: { ...form, defects },
        snapshot: buildDraftSnapshot()!,
        protocolNumber: form.protocolNumber.trim() || "Náhled",
      }
    : null;

  const buildDraftHtml = (): string | null => {
    const snap = buildDraftSnapshot();
    if (!snap) return null;
    return buildHandoverProtocolHtmlForPreview({
      companyDoc,
      snapshot: snap,
      form: { ...form, defects },
      protocolNumber: form.protocolNumber.trim() || "Náhled",
    });
  };

  const requirePreviewData = (): boolean => {
    if (!preview || !workContractId.trim()) {
      toast({
        variant: "destructive",
        title: "Náhled",
        description: "Vyberte smlouvu a počkejte na načtení údajů zakázky.",
      });
      return false;
    }
    return true;
  };

  const applyTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl?.content) {
      toast({ variant: "destructive", title: "Šablona nenalezena." });
      return;
    }
    setForm((f) => applyHandoverTemplateToForm(f, tpl.content));
    toast({ title: "Šablona použita", description: tpl.name });
  };

  const saveAsTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Zadejte název šablony." });
      return;
    }
    setSavingTemplate(true);
    try {
      await createHandoverProtocolTemplate(firestore, {
        companyId,
        name,
        content: handoverTemplateContentFromForm({ ...form, defects }),
        createdBy: user.uid,
      });
      const list = await fetchHandoverProtocolTemplates(firestore, companyId);
      setTemplates(list);
      toast({ title: "Šablona uložena", description: name });
      setSaveTemplateOpen(false);
      setTemplateName("");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení šablony",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleFormPdf = async () => {
    if (!requirePreviewData()) return;
    const html = buildDraftHtml();
    if (!html) return;
    setPdfBusy(true);
    try {
      let blob: Blob;
      if (editProtocolId) {
        blob = await downloadHandoverProtocolPdf({
          user,
          companyId,
          protocolId: editProtocolId,
        });
      } else {
        blob = await downloadHandoverProtocolPdfFromHtml({
          user,
          companyId,
          jobId,
          html,
          filename: `predavaci-protokol-nahled.pdf`,
        });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `predavaci-protokol-${form.protocolNumber || "nahled"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PDF",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setPdfBusy(false);
    }
  };

  const handleFormPrint = () => {
    if (!requirePreviewData()) return;
    const html = buildDraftHtml();
    if (!html) return;
    const result = printInvoiceHtmlDocument(html, form.documentTitle || "Předávací protokol");
    if (result === "blocked") {
      toast({
        variant: "destructive",
        title: "Tisk byl zablokován",
        description: "Povolte vyskakovací okna.",
      });
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
        ) : !hasContracts && !editProtocolId ? (
          <Alert variant="destructive">
            <AlertDescription>Nejdříve vytvořte smlouvu o dílo.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4 text-sm">
            {preview ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                <p>
                  <span className="font-medium">Zakázka:</span> {preview.jobName}
                  {preview.jobNumber ? ` (${preview.jobNumber})` : ""}
                </p>
                <p>
                  <span className="font-medium">Zákazník:</span>{" "}
                  {preview.customerName || "—"}
                </p>
                <p>
                  <span className="font-medium">Adresa realizace:</span>{" "}
                  {preview.realizationAddress || "—"}
                </p>
                <p>
                  <span className="font-medium">Smlouva o dílo:</span>{" "}
                  {preview.workContractNumber || "—"}
                </p>
                {prefetching ? (
                  <p className="text-muted-foreground flex items-center gap-1 pt-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Načítám údaje…
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-md border border-dashed p-3 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <LayoutTemplate className="h-3.5 w-3.5" />
                Šablony protokolu
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Vybrat šablonu</Label>
                  <Select
                    value={selectedTemplateId || undefined}
                    onValueChange={(id) => {
                      setSelectedTemplateId(id);
                      applyTemplate(id);
                    }}
                    disabled={templatesLoading || templates.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          templatesLoading
                            ? "Načítání…"
                            : templates.length === 0
                              ? "Žádná šablona"
                              : "Vyberte šablonu"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setTemplateName(form.documentTitle.trim() || "Šablona protokolu");
                    setSaveTemplateOpen(true);
                  }}
                >
                  <Bookmark className="h-4 w-4 mr-1" />
                  Uložit jako šablonu
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Šablona ukládá pouze texty a položky protokolu, ne zákazníka, adresu ani čísla
                zakázky.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Smlouva o dílo *</Label>
                {hasContracts ? (
                  <Select
                    value={selectValue}
                    onValueChange={handleContractChange}
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
                ) : (
                  <p className="text-sm text-muted-foreground">Žádná smlouva o dílo.</p>
                )}
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
                    setForm((f) => ({
                      ...f,
                      defects: [...ensureDefects(f.defects), newHandoverDefectRow()],
                    }))
                  }
                >
                  <Plus className="h-4 w-4 mr-1" /> Přidat řádek
                </Button>
              </div>
              {defects.length === 0 ? (
                <p className="text-xs text-muted-foreground">Žádné vady — volitelné.</p>
              ) : (
                <div className="space-y-2">
                  {defects.map((row, idx) => (
                    <div
                      key={row.id}
                      className="grid gap-2 sm:grid-cols-12 items-start border rounded p-2"
                    >
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
                            {(
                              Object.keys(HANDOVER_DEFECT_STATUS_LABELS) as HandoverDefectStatus[]
                            ).map((k) => (
                              <SelectItem key={k} value={k}>
                                {HANDOVER_DEFECT_STATUS_LABELS[k]}
                              </SelectItem>
                            ))}
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
                              defects: ensureDefects(f.defects).filter((_, i) => i !== idx),
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
        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || !preview}
              onClick={() => {
                if (requirePreviewData()) setPreviewOpen(true);
              }}
            >
              <Eye className="h-4 w-4 mr-1" /> Náhled
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || pdfBusy || !preview}
              onClick={() => void handleFormPdf()}
            >
              {pdfBusy ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <FileDown className="h-4 w-4 mr-1" />
              )}
              Vygenerovat PDF
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || !preview}
              onClick={handleFormPrint}
            >
              <Printer className="h-4 w-4 mr-1" /> Tisk
            </Button>
          </div>
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || (!hasContracts && !editProtocolId)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={saving ? "ml-2" : ""}>Uložit</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <HandoverProtocolPdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        draft={draftPreview}
        companyDoc={companyDoc}
        user={user}
      />

      <AlertDialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uložit jako šablonu</AlertDialogTitle>
            <AlertDialogDescription>
              Uloží se výchozí texty a položky protokolu pro další zakázky. Neukládají se údaje
              zákazníka, adresa, čísla smlouvy ani datum předání.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Label htmlFor="hp-template-name">Název šablony</Label>
            <Input
              id="hp-template-name"
              className="mt-1.5"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="např. Standardní předání"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingTemplate}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingTemplate}
              onClick={(e) => {
                e.preventDefault();
                void saveAsTemplate();
              }}
            >
              {savingTemplate ? "Ukládám…" : "Uložit šablonu"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
