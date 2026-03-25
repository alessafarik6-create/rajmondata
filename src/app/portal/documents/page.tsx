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
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
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
};

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

  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newDocType, setNewDocType] = useState<"received" | "issued">("received");
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setIsSubmitting(true);

    try {
      const colRef = collection(firestore, "companies", companyId, "documents");
      await addDoc(colRef, {
        ...formData,
        type: newDocType,
        amount: Number(formData.amount),
        vat: Number(formData.vat),
        organizationId: companyId,
        createdBy: user?.uid,
        createdAt: serverTimestamp(),
      });

      const financeRef = collection(firestore, "companies", companyId, "finance");
      await addDoc(financeRef, {
        amount: Number(formData.amount),
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
                    <Label htmlFor="amount">Částka (včetně DPH)</Label>
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
                    <Label htmlFor="vat">Sazba DPH (%)</Label>
                    <Input
                      id="vat"
                      type="number"
                      value={formData.vat}
                      onChange={(e) =>
                        setFormData({ ...formData, vat: e.target.value })
                      }
                      className="bg-background"
                    />
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
    </div>
  );
}

function DocumentTableReceived({
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

                  const showAmount =
                    !fromJobMedia &&
                    row.amount != null &&
                    Number.isFinite(row.amount);

                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "border-border hover:bg-muted/30",
                        fromJobExpense && "bg-amber-50/50 dark:bg-amber-950/15",
                        fromJobMedia && "bg-sky-50/60 dark:bg-sky-950/20"
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
                                Náklad
                              </Badge>
                            ) : null}
                            {fromJobMedia ? (
                              <Badge className="text-[10px] font-normal bg-sky-700 text-white hover:bg-sky-700">
                                Média zakázky
                              </Badge>
                            ) : null}
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
                            {row.entityName ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-nowrap">
                        {row.date ?? "—"}
                      </TableCell>
                      <TableCell className="align-top text-right tabular-nums">
                        {showAmount ? (
                          <span className="font-bold text-rose-600 dark:text-rose-400">
                            {row.amount!.toLocaleString("cs-CZ")} Kč
                          </span>
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
                {data.map((docRow) => (
                  <TableRow key={docRow.id} className="border-border hover:bg-muted/30 group">
                    <TableCell className="pl-6 font-medium">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileDown className="w-4 h-4 text-muted-foreground opacity-50 shrink-0" />
                        <span className="truncate">{docRow.number}</span>
                      </div>
                    </TableCell>
                    <TableCell>{docRow.entityName}</TableCell>
                    <TableCell>{docRow.date}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {(docRow.amount ?? 0).toLocaleString("cs-CZ")} Kč
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
                ))}
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
