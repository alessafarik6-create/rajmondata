"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  FileText,
  Upload,
  Download,
  Filter,
  Search,
  Loader2,
  Trash2,
  FileDown,
  Briefcase,
  ImageIcon,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import {
  doc,
  collection,
  addDoc,
  serverTimestamp,
  deleteDoc,
  writeBatch,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JOB_EXPENSE_DOCUMENT_SOURCE } from "@/lib/job-expense-document-sync";
import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";
import {
  inferJobMediaItemType,
  type JobMediaFileType,
} from "@/lib/job-media-types";
import { cn } from "@/lib/utils";
import { logActivitySafe } from "@/lib/activity-log";
import {
  calculateVatAmountsFromNet,
  normalizeVatRate,
  resolveExpenseAmounts,
  VAT_RATE_OPTIONS,
} from "@/lib/vat-calculations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CompanyDocumentRow = {
  id: string;
  type?: string;
  documentKind?: string;
  source?: string;
  sourceType?: string;
  sourceId?: string;
  sourceLabel?: string;
  jobLinkedKind?: string;
  folderId?: string;
  jobId?: string;
  jobName?: string | null;
  number?: string;
  entityName?: string;
  amount?: number;
  amountNet?: number;
  amountGross?: number;
  vatAmount?: number;
  vatRate?: number;
  vat?: number;
  date?: string;
  description?: string;
  note?: string | null;
  fileUrl?: string | null;
  fileType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  createdAt?: unknown;
  uploadedBy?: string;
  uploadedByName?: string;
  assignmentType?: "job_cost" | "overhead" | "pending_assignment";
};

type AssignmentType = "job_cost" | "overhead" | "pending_assignment";

function isReceivedDoc(d: CompanyDocumentRow) {
  return d.type === "received" || d.documentKind === "prijate";
}

function docCreatedAtMs(t: unknown): number {
  if (t && typeof (t as { toMillis?: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (t && typeof (t as { seconds?: number }).seconds === "number") {
    return (t as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function inferDocRowFileKind(
  row: CompanyDocumentRow
): JobMediaFileType | "none" {
  if (!row.fileUrl?.trim()) return "none";
  return inferJobMediaItemType(row);
}

async function deleteJobMediaFilesFromStorage(
  paths: Array<string | undefined | null>
) {
  for (const p of paths) {
    if (typeof p === "string" && p.trim()) {
      try {
        await deleteObject(storageRef(getFirebaseStorage(), p.trim()));
      } catch {
        /* */
      }
    }
  }
}

export default function DocumentsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const documentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "documents");
  }, [firestore, companyId]);

  const { data: documents, isLoading } = useCollection(documentsQuery);
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobs");
  }, [firestore, companyId]);
  const { data: jobsRaw } = useCollection(jobsQuery);
  const jobs = useMemo(() => {
    const rows = Array.isArray(jobsRaw) ? jobsRaw : [];
    return rows
      .map((j) => ({
        id: String((j as { id?: string }).id ?? ""),
        name: String(
          (j as { name?: string; title?: string }).name ??
            (j as { title?: string }).title ??
            "Zakázka"
        ).trim(),
      }))
      .filter((j) => j.id);
  }, [jobsRaw]);

  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newDocType, setNewDocType] = useState<"received" | "issued">("received");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [assignmentType, setAssignmentType] =
    useState<AssignmentType>("pending_assignment");
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [formData, setFormData] = useState({
    number: "",
    entityName: "",
    amount: "",
    vat: "21",
    date: new Date().toISOString().split("T")[0],
    description: "",
  });

  const [receivedSearch, setReceivedSearch] = useState("");
  const [issuedSearch, setIssuedSearch] = useState("");
  const [assigningDocId, setAssigningDocId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTypeNext, setAssignTypeNext] =
    useState<AssignmentType>("pending_assignment");
  const [assignJobIdNext, setAssignJobIdNext] = useState("");

  const pendingDocs = useMemo(
    () =>
      ((documents ?? []) as CompanyDocumentRow[])
        .filter((d) => d.assignmentType === "pending_assignment")
        .sort((a, b) => docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt)),
    [documents]
  );

  const uploadDocumentFile = async (file: File): Promise<{
    fileUrl: string;
    fileName: string;
    fileType: string;
    mimeType: string;
    storagePath: string;
  }> => {
    if (!companyId || !user) throw new Error("Chybí firma nebo uživatel.");
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
    const safeExt = ext ? `.${String(ext).toLowerCase()}` : "";
    const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    const path = `companies/${companyId}/documents/uploads/${user.uid}/${key}`;
    const ref = storageRef(getFirebaseStorage(), path);
    await uploadBytes(ref, file, {
      contentType: file.type || "application/octet-stream",
    });
    const fileUrl = await getDownloadURL(ref);
    const top = (file.type || "").split("/")[0] || "application";
    return {
      fileUrl,
      fileName: file.name || key,
      fileType: top,
      mimeType: file.type || "application/octet-stream",
      storagePath: path,
    };
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setIsSubmitting(true);

    try {
      const amountNet = Math.max(0, Math.round(Number(formData.amount)));
      const vatRate = normalizeVatRate(Number(formData.vat));
      const { vatAmount, amountGross } = calculateVatAmountsFromNet(
        amountNet,
        vatRate
      );

      if (assignmentType === "job_cost" && !selectedJobId) {
        throw new Error("Vyberte zakázku, ke které doklad patří.");
      }
      const selectedJob = jobs.find((j) => j.id === selectedJobId);
      const uploadMeta = newDocFile ? await uploadDocumentFile(newDocFile) : null;
      const colRef = collection(firestore, "companies", companyId, "documents");
      const profileName =
        String((profile as { displayName?: string; email?: string })?.displayName ?? "").trim() ||
        String((profile as { email?: string })?.email ?? user?.email ?? "").trim() ||
        "Uživatel";
      const newDocRef = await addDoc(colRef, {
        number: formData.number.trim(),
        entityName: formData.entityName.trim(),
        description: formData.description.trim(),
        date: formData.date,
        type: newDocType,
        amount: amountNet,
        amountNet,
        vatRate,
        vatAmount,
        amountGross,
        vat: vatRate,
        organizationId: companyId,
        createdBy: user?.uid,
        uploadedBy: user?.uid,
        uploadedByName: profileName,
        assignmentType,
        jobId: assignmentType === "job_cost" ? selectedJob?.id ?? selectedJobId : null,
        jobName: assignmentType === "job_cost" ? selectedJob?.name ?? null : null,
        fileUrl: uploadMeta?.fileUrl ?? null,
        fileName: uploadMeta?.fileName ?? null,
        fileType: uploadMeta?.fileType ?? null,
        mimeType: uploadMeta?.mimeType ?? null,
        storagePath: uploadMeta?.storagePath ?? null,
        createdAt: serverTimestamp(),
      });

      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.create",
        actionLabel:
          newDocType === "received" ? "Nový přijatý doklad" : "Nový vydaný doklad",
        entityType: "company_document",
        entityId: newDocRef.id,
        entityName: formData.number?.trim() || newDocRef.id,
        details: `${formData.entityName?.trim() || "—"} · ${amountNet} Kč bez DPH / ${amountGross} Kč s DPH`,
        sourceModule: "documents",
        route: "/portal/documents",
        metadata: {
          docType: newDocType,
          number: formData.number,
          amountNet,
          amountGross,
          vatRate,
          date: formData.date,
          assignmentType,
          jobId: assignmentType === "job_cost" ? selectedJob?.id ?? selectedJobId : null,
        },
      });

      const financeRef = collection(firestore, "companies", companyId, "finance");
      await addDoc(financeRef, {
        amount: amountGross,
        amountNet,
        amountGross,
        vatRate,
        type: newDocType === "received" ? "expense" : "revenue",
        date: formData.date,
        description: `Doklad ${formData.number}: ${formData.description}`,
        createdAt: serverTimestamp(),
      });

      toast({
        title: "Doklad uložen",
        description: `Záznam ${formData.number} byl úspěšně přidán.`,
      });
      setIsAddDocOpen(false);
      setFormData({
        number: "",
        entityName: "",
        amount: "",
        vat: "21",
        date: new Date().toISOString().split("T")[0],
        description: "",
      });
      setNewDocFile(null);
      setAssignmentType("pending_assignment");
      setSelectedJobId("");
    } catch {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se uložit doklad.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignDialog = (row: CompanyDocumentRow) => {
    setAssigningDocId(row.id);
    setAssignTypeNext(row.assignmentType ?? "pending_assignment");
    setAssignJobIdNext(row.jobId ?? "");
    setAssignDialogOpen(true);
  };

  const saveAssignment = async () => {
    if (!companyId || !assigningDocId) return;
    if (assignTypeNext === "job_cost" && !assignJobIdNext) {
      toast({
        variant: "destructive",
        title: "Vyberte zakázku",
        description: "Pro zařazení do nákladů zakázky je nutné vybrat zakázku.",
      });
      return;
    }
    const selected = jobs.find((j) => j.id === assignJobIdNext);
    await updateDoc(
      doc(firestore, "companies", companyId, "documents", assigningDocId),
      {
        assignmentType: assignTypeNext,
        jobId: assignTypeNext === "job_cost" ? selected?.id ?? assignJobIdNext : null,
        jobName: assignTypeNext === "job_cost" ? selected?.name ?? null : null,
        updatedAt: serverTimestamp(),
      }
    );
    setAssignDialogOpen(false);
    setAssigningDocId(null);
    toast({ title: "Zařazení uloženo" });
  };

  const handleDelete = async (row: CompanyDocumentRow) => {
    const label = row.number || row.id;
    if (!confirm(`Opravdu chcete odstranit doklad „${label}“?`)) return;
    if (!companyId) return;

    const isExpenseLinked =
      row.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
      row.sourceType === "expense";
    const isJobMediaRow =
      row.source === JOB_MEDIA_DOCUMENT_SOURCE || row.sourceType === "job";

    try {
      if (isJobMediaRow && row.jobId && row.sourceId) {
        const kind = row.jobLinkedKind ?? "legacyPhoto";
        if (kind === "folderImage" && !row.folderId) {
          toast({
            variant: "destructive",
            title: "Nelze smazat",
            description: "U tohoto záznamu chybí vazba na složku zakázky.",
          });
          return;
        }

        if (kind === "folderImage" && row.folderId) {
          const imgRef = doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            row.jobId,
            "folders",
            row.folderId,
            "images",
            row.sourceId
          );
          const snap = await getDoc(imgRef);
          if (snap.exists()) {
            const dat = snap.data() as {
              storagePath?: string;
              path?: string;
              annotatedStoragePath?: string;
            };
            await deleteJobMediaFilesFromStorage([
              dat.storagePath,
              dat.path,
              dat.annotatedStoragePath,
            ]);
          } else {
            await deleteJobMediaFilesFromStorage([row.storagePath]);
          }
          const batch = writeBatch(firestore);
          batch.delete(imgRef);
          batch.delete(doc(firestore, "companies", companyId, "documents", row.id));
          await batch.commit();
        } else {
          const photoRef = doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            row.jobId,
            "photos",
            row.sourceId
          );
          const snap = await getDoc(photoRef);
          if (snap.exists()) {
            const dat = snap.data() as {
              storagePath?: string;
              path?: string;
              fullPath?: string;
              annotatedStoragePath?: string;
            };
            await deleteJobMediaFilesFromStorage([
              dat.storagePath,
              dat.path,
              dat.fullPath,
              dat.annotatedStoragePath,
            ]);
          } else {
            await deleteJobMediaFilesFromStorage([row.storagePath]);
          }
          const batch = writeBatch(firestore);
          batch.delete(photoRef);
          batch.delete(doc(firestore, "companies", companyId, "documents", row.id));
          await batch.commit();
          logActivitySafe(firestore, companyId, user, profile, {
            actionType: "document.delete",
            actionLabel: "Smazání fotky zakázky",
            entityType: "job_photo",
            entityId: row.sourceId ?? row.id,
            entityName: row.fileName || row.number || row.id,
            sourceModule: "documents",
            route: "/portal/documents",
            metadata: {
              jobId: row.jobId,
              documentsMirrorId: row.id,
              fileName: row.fileName,
            },
          });
        }
        toast({
          title: "Soubor odstraněn",
          description: "Záznam byl smazán v dokladech i u zakázky.",
        });
        return;
      }

      if (isExpenseLinked && row.sourceId && row.jobId) {
        const batch = writeBatch(firestore);
        batch.delete(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            row.jobId,
            "expenses",
            row.sourceId
          )
        );
        batch.delete(doc(firestore, "companies", companyId, "documents", row.id));
        await batch.commit();
        if (row.storagePath?.trim()) {
          try {
            await deleteObject(
              storageRef(getFirebaseStorage(), row.storagePath.trim())
            );
          } catch {
            /* */
          }
        }
        toast({
          title: "Doklad a náklad odstraněny",
          description: "Záznam byl smazán v dokladech i u zakázky.",
        });
        return;
      }

      if (row.storagePath?.trim()) {
        try {
          await deleteObject(
            storageRef(getFirebaseStorage(), row.storagePath.trim())
          );
        } catch {
          /* */
        }
      }
      await deleteDoc(doc(firestore, "companies", companyId, "documents", row.id));
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.delete",
        actionLabel: "Smazání firemního dokladu",
        entityType: "company_document",
        entityId: row.id,
        entityName: row.number || row.entityName || row.id,
        sourceModule: "documents",
        route: "/portal/documents",
        metadata: {
          docType: row.type,
          amount: row.amount,
          fileName: row.fileName,
          hadFile: Boolean(row.storagePath || row.fileUrl),
        },
      });
      toast({ title: "Doklad odstraněn" });
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const receivedDocsBase = useMemo(() => {
    return (documents ?? []).filter((d) =>
      isReceivedDoc(d as CompanyDocumentRow)
    ) as CompanyDocumentRow[];
  }, [documents]);

  const issuedDocs = useMemo(() => {
    const base = (documents ?? []).filter(
      (d) => (d as CompanyDocumentRow).type === "issued"
    ) as CompanyDocumentRow[];
    const q = issuedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) => {
      const hay = [d.number, d.entityName, d.description]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [documents, issuedSearch]);

  if (isProfileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Nelze načíst doklady bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Firemní doklady</h1>
          <p className="portal-page-description">
            Přehled přijatých a vydaných dokladů včetně souborů zákazek (fotodokumentace, složky,
            náklady) — jednotná evidence bez duplicitních záznamů.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={isAddDocOpen} onOpenChange={setIsAddDocOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 min-h-[44px] w-full sm:w-auto">
                <Plus className="w-4 h-4 shrink-0" /> Přidat doklad
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nový obchodní doklad</DialogTitle>
                <DialogDescription>
                  Zadejte údaje z faktury nebo účtenky pro evidenci.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddDocument} className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="attachment">Soubor / fotka / PDF</Label>
                    <Input
                      id="attachment"
                      type="file"
                      accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                      capture="environment"
                      onChange={(e) => setNewDocFile(e.target.files?.[0] ?? null)}
                      className="bg-background"
                    />
                    <p className="text-xs text-muted-foreground">
                      Na mobilu lze využít fotoaparát a doklad nahrát přímo z terénu.
                    </p>
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Typ dokladu</Label>
                    <div className="flex gap-2 p-1 bg-background rounded-lg border border-border">
                      <Button
                        type="button"
                        variant={newDocType === "received" ? "default" : "ghost"}
                        className="flex-1 h-8 text-xs"
                        onClick={() => setNewDocType("received")}
                      >
                        Přijatý (Náklad)
                      </Button>
                      <Button
                        type="button"
                        variant={newDocType === "issued" ? "default" : "ghost"}
                        className="flex-1 h-8 text-xs"
                        onClick={() => setNewDocType("issued")}
                      >
                        Vydaný (Příjem)
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="number">Číslo dokladu</Label>
                    <Input
                      id="number"
                      required
                      value={formData.number}
                      onChange={(e) =>
                        setFormData({ ...formData, number: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="date">Datum vystavení</Label>
                    <Input
                      id="date"
                      type="date"
                      required
                      value={formData.date}
                      onChange={(e) =>
                        setFormData({ ...formData, date: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="entityName">
                      {newDocType === "received" ? "Dodavatel" : "Odběratel"}
                    </Label>
                    <Input
                      id="entityName"
                      required
                      value={formData.entityName}
                      onChange={(e) =>
                        setFormData({ ...formData, entityName: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Částka bez DPH</Label>
                    <Input
                      id="amount"
                      type="number"
                      required
                      value={formData.amount}
                      onChange={(e) =>
                        setFormData({ ...formData, amount: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vat">DPH</Label>
                    <Select
                      value={formData.vat}
                      onValueChange={(v) =>
                        setFormData({ ...formData, vat: v })
                      }
                    >
                      <SelectTrigger id="vat" className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VAT_RATE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r} % DPH
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="description">Popis / Poznámka</Label>
                    <Input
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Zařazení dokladu</Label>
                    <Select
                      value={assignmentType}
                      onValueChange={(v) => setAssignmentType(v as AssignmentType)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="job_cost">Zakázka → náklad</SelectItem>
                        <SelectItem value="overhead">Režie</SelectItem>
                        <SelectItem value="pending_assignment">Musí se zařadit později</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assignmentType === "job_cost" ? (
                    <div className="space-y-2 col-span-2">
                      <Label>Vyberte zakázku</Label>
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Zakázka" />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs.map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Uložit doklad"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="outlineLight" className="gap-2 min-h-[44px]">
            <Upload className="w-4 h-4 shrink-0" /> Nahrát PDF
          </Button>
        </div>
      </div>

      {pendingDocs.length > 0 ? (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTitle>Nezařazené doklady ({pendingDocs.length})</AlertTitle>
          <AlertDescription>
            Doklady ve stavu „musí se zařadit později“ jsou zvýrazněné a lze je rychle zařadit.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="received" className="w-full min-w-0">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1 mb-6">
          <TabsTrigger
            value="received"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <FileText className="w-4 h-4 shrink-0" /> Přijaté doklady
          </TabsTrigger>
          <TabsTrigger
            value="issued"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <FileText className="w-4 h-4 shrink-0 text-emerald-500" /> Vydané
            doklady
          </TabsTrigger>
        </TabsList>

        <TabsContent value="received">
          <DocumentTableReceived
            data={receivedDocsBase}
            isLoading={isLoading}
            onDelete={handleDelete}
            onAssign={openAssignDialog}
            search={receivedSearch}
            onSearchChange={setReceivedSearch}
          />
        </TabsContent>

        <TabsContent value="issued">
          <DocumentTableIssued
            data={issuedDocs}
            isLoading={isLoading}
            onDelete={handleDelete}
            search={issuedSearch}
            onSearchChange={setIssuedSearch}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Zařadit doklad</DialogTitle>
            <DialogDescription>
              Nastavte, kam doklad patří: zakázka, režie nebo ponechat na později.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Zařazení</Label>
              <Select
                value={assignTypeNext}
                onValueChange={(v) => setAssignTypeNext(v as AssignmentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job_cost">Zakázka → náklad</SelectItem>
                  <SelectItem value="overhead">Režie</SelectItem>
                  <SelectItem value="pending_assignment">Musí se zařadit později</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {assignTypeNext === "job_cost" ? (
              <div className="space-y-2">
                <Label>Zakázka</Label>
                <Select value={assignJobIdNext} onValueChange={setAssignJobIdNext}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zakázku" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Zrušit
            </Button>
            <Button onClick={() => void saveAssignment()}>Uložit zařazení</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentTableReceived({
  data,
  isLoading,
  onDelete,
  onAssign,
  search,
  onSearchChange,
}: {
  data: CompanyDocumentRow[];
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onAssign: (row: CompanyDocumentRow) => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const [jobFilter, setJobFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const jobOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of data) {
      if (d.jobId) {
        m.set(
          d.jobId,
          d.jobName?.trim() || d.entityName?.trim() || d.jobId
        );
      }
    }
    return [...m.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "cs", { sensitivity: "base" })
    );
  }, [data]);

  const rows = useMemo(() => {
    let list = [...data];
    if (jobFilter !== "__all__") {
      list = list.filter((d) => d.jobId === jobFilter);
    }
    if (typeFilter !== "__all__") {
      list = list.filter((d) => {
        const k = inferDocRowFileKind(d);
        if (typeFilter === "none") return k === "none";
        return k === typeFilter;
      });
    }
    const df = dateFrom.trim();
    const dt = dateTo.trim();
    if (df) list = list.filter((d) => (d.date || "") >= df);
    if (dt) list = list.filter((d) => (d.date || "") <= dt);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const hay = [
          d.number,
          d.entityName,
          d.description,
          d.note ?? "",
          d.jobName ?? "",
          d.sourceLabel ?? "",
          d.fileName ?? "",
          d.mimeType ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    list.sort((a, b) => docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt));
    return list;
  }, [data, jobFilter, typeFilter, dateFrom, dateTo, search]);

  const fileKindLabel = (k: JobMediaFileType | "none") => {
    if (k === "pdf") return "PDF";
    if (k === "office") return "Office";
    if (k === "image") return "Obrázek";
    return "—";
  };

  return (
    <Card className="overflow-hidden min-w-0">
      <div className="p-4 border-b flex flex-col gap-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Hledat (název, zakázka, poznámka…)"
            className="pl-10 min-h-[44px] w-full"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs text-muted-foreground">Zakázka</Label>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="min-h-[44px] w-full">
                <SelectValue placeholder="Všechny zakázky" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny zakázky</SelectItem>
                {jobOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    <span className="truncate">{name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs text-muted-foreground">Typ souboru</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="min-h-[44px] w-full">
                <SelectValue placeholder="Všechny typy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny typy</SelectItem>
                <SelectItem value="image">Obrázek</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="office">Office</SelectItem>
                <SelectItem value="none">Bez přílohy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Od data</Label>
            <Input
              type="date"
              className="min-h-[44px]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Do data</Label>
            <Input
              type="date"
              className="min-h-[44px]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </div>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 min-w-[160px]">Soubor / doklad</TableHead>
                  <TableHead className="min-w-[100px]">Typ</TableHead>
                  <TableHead className="min-w-[120px]">Zakázka</TableHead>
                  <TableHead className="min-w-[100px]">Datum</TableHead>
                  <TableHead className="min-w-[120px] text-right">Částka</TableHead>
                  <TableHead className="min-w-[140px]">Poznámka</TableHead>
                  <TableHead className="pr-6 text-right min-w-[220px]">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const fromJobExpense =
                    row.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
                    row.sourceType === "expense";
                  const fromJobMedia =
                    row.source === JOB_MEDIA_DOCUMENT_SOURCE ||
                    row.sourceType === "job";
                  const fk = inferDocRowFileKind(row);
                  const RowIcon =
                    fk === "image" ? ImageIcon : FileText;

                  const amts = resolveExpenseAmounts(row);
                  const showAmount = !fromJobMedia && amts.amountNet > 0;

                  const assignmentBadge =
                    row.assignmentType === "job_cost"
                      ? "Zakázka"
                      : row.assignmentType === "overhead"
                        ? "Režie"
                        : "Nezařazeno";
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "border-border hover:bg-muted/30",
                        fromJobExpense && "bg-amber-50/50 dark:bg-amber-950/15",
                        fromJobMedia && "bg-sky-50/60 dark:bg-sky-950/20",
                        row.assignmentType === "pending_assignment" &&
                          "ring-1 ring-amber-300 bg-amber-50/70 dark:bg-amber-950/20"
                      )}
                    >
                      <TableCell className="pl-6 align-top">
                        <div className="flex flex-col gap-1.5 min-w-0 max-w-[18rem]">
                          <div className="flex items-center gap-2 min-w-0">
                            <RowIcon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                fk === "pdf" && "text-red-600",
                                fk === "office" && "text-blue-700",
                                fk === "image" && "text-emerald-600",
                                fk === "none" && "text-muted-foreground opacity-60"
                              )}
                            />
                            <span
                              className="font-medium truncate text-sm"
                              title={row.fileName || row.number || row.id}
                            >
                              {row.fileName?.trim() || row.number || row.id}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              Přijaté
                            </Badge>
                            {fromJobExpense ? (
                              <Badge className="text-[10px] font-normal bg-amber-600 hover:bg-amber-600">
                                Náklad zakázky
                              </Badge>
                            ) : null}
                            {fromJobMedia ? (
                              <Badge className="text-[10px] font-normal bg-sky-700 text-white hover:bg-sky-700">
                                Média zakázky
                              </Badge>
                            ) : null}
                            <Badge
                              className={cn(
                                "text-[10px] font-normal",
                                row.assignmentType === "pending_assignment"
                                  ? "bg-amber-600 text-white hover:bg-amber-600"
                                  : "bg-slate-700 text-white hover:bg-slate-700"
                              )}
                            >
                              {assignmentBadge}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span>{fileKindLabel(fk)}</span>
                          {row.mimeType?.trim() ? (
                            <span className="line-clamp-2 break-all" title={row.mimeType}>
                              {row.mimeType}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {row.jobId ? (
                          <span
                            className="text-sm font-medium block truncate max-w-[12rem]"
                            title={row.jobName ?? row.entityName ?? undefined}
                          >
                            {row.jobName || row.entityName || "Zakázka"}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {row.assignmentType === "pending_assignment"
                              ? "Zařadit později"
                              : row.entityName ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-nowrap">
                        {row.date ?? "—"}
                      </TableCell>
                      <TableCell className="align-top text-right tabular-nums text-xs sm:text-sm">
                        {showAmount ? (
                          <div className="space-y-0.5">
                            <div className="text-muted-foreground">
                              Bez DPH {amts.amountNet.toLocaleString("cs-CZ")} Kč
                            </div>
                            <div className="font-bold text-rose-600 dark:text-rose-400">
                              S DPH {amts.amountGross.toLocaleString("cs-CZ")} Kč
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top max-w-[14rem]">
                        <p className="text-sm text-foreground/90 line-clamp-2 break-words">
                          {row.note || row.description || "—"}
                        </p>
                      </TableCell>
                      <TableCell className="pr-6 align-top text-right">
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                          {row.fileUrl ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-[40px] shrink-0 gap-1"
                              asChild
                            >
                              <a
                                href={row.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                                Otevřít
                              </a>
                            </Button>
                          ) : null}
                          {row.jobId ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-h-[40px] gap-1"
                              asChild
                            >
                              <Link href={`/portal/jobs/${row.jobId}`}>
                                <Briefcase className="h-4 w-4 shrink-0" />
                                Zakázka
                              </Link>
                            </Button>
                          ) : null}
                          {row.assignmentType === "pending_assignment" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-h-[40px] gap-1"
                              onClick={() => onAssign(row)}
                            >
                              Zařadit
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-[40px] text-muted-foreground hover:text-destructive"
                            onClick={() => onDelete(row)}
                          >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            Smazat
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            Zatím nemáte žádné přijaté doklady.
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            Žádný doklad neodpovídá filtru nebo hledání.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentTableIssued({
  data,
  isLoading,
  onDelete,
  search,
  onSearchChange,
}: {
  data: CompanyDocumentRow[];
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <Card className="overflow-hidden min-w-0">
      <div className="p-4 border-b flex flex-col sm:flex-row gap-4 justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Hledat ve vydaných…"
            className="pl-10 min-h-[44px] w-full"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlineLight" size="sm" className="gap-2 min-h-[44px] sm:min-h-0">
            <Filter className="w-4 h-4 shrink-0" /> Filtr
          </Button>
          <Button variant="outlineLight" size="sm" className="gap-2 min-h-[44px] sm:min-h-0">
            <Download className="w-4 h-4 shrink-0" /> Export
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6">Číslo dokladu</TableHead>
                  <TableHead>Subjekt</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Částka</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((docRow) => {
                  const issuedAm = resolveExpenseAmounts(docRow);
                  return (
                    <TableRow
                      key={docRow.id}
                      className="border-border hover:bg-muted/30 group"
                    >
                      <TableCell className="pl-6 font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileDown className="w-4 h-4 text-muted-foreground opacity-50 shrink-0" />
                          <span className="truncate">{docRow.number}</span>
                        </div>
                      </TableCell>
                      <TableCell>{docRow.entityName}</TableCell>
                      <TableCell>{docRow.date}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        <div className="space-y-0.5">
                          <div className="text-muted-foreground">
                            Bez DPH {issuedAm.amountNet.toLocaleString("cs-CZ")} Kč
                          </div>
                          <div className="font-bold">
                            S DPH {issuedAm.amountGross.toLocaleString("cs-CZ")} Kč
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(docRow)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Smazat doklad"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            Zatím nemáte žádné vydané doklady.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
