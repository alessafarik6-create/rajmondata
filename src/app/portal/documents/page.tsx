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
import { inferJobMediaItemType } from "@/lib/job-media-types";
import { cn } from "@/lib/utils";

type CompanyDocumentRow = {
  id: string;
  type?: string;
  documentKind?: string;
  source?: string;
  sourceId?: string;
  sourceLabel?: string;
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
  fileName?: string | null;
  storagePath?: string | null;
};

function isReceivedDoc(d: CompanyDocumentRow) {
  return d.type === "received" || d.documentKind === "prijate";
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

    try {
      if (
        row.source === JOB_EXPENSE_DOCUMENT_SOURCE &&
        row.sourceId &&
        row.jobId
      ) {
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

      await deleteDoc(doc(firestore, "companies", companyId, "documents", row.id));
      toast({ title: "Doklad odstraněn" });
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const receivedDocs = useMemo(() => {
    const base = (documents ?? []).filter((d) =>
      isReceivedDoc(d as CompanyDocumentRow)
    ) as CompanyDocumentRow[];
    const q = receivedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) => {
      const hay = [
        d.number,
        d.entityName,
        d.description,
        d.note ?? "",
        d.jobName ?? "",
        d.sourceLabel ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [documents, receivedSearch]);

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
            Správa přijatých a vydaných dokladů vaší organizace.
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
            data={receivedDocs}
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
  return (
    <Card className="overflow-hidden min-w-0">
      <div className="p-4 border-b flex flex-col gap-4 justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Hledat v přijatých (číslo, zakázka, poznámka…)"
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
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6 min-w-[140px]">Doklad</TableHead>
                  <TableHead className="min-w-[120px]">Zakázka</TableHead>
                  <TableHead className="min-w-[100px]">Datum</TableHead>
                  <TableHead className="min-w-[120px] text-right">Částka</TableHead>
                  <TableHead className="min-w-[160px]">Poznámka</TableHead>
                  <TableHead className="min-w-[100px]">Příloha</TableHead>
                  <TableHead className="pr-6 text-right min-w-[100px]">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => {
                  const fromJobExpense = row.source === JOB_EXPENSE_DOCUMENT_SOURCE;
                  const attachKind =
                    row.fileUrl ? inferJobMediaItemType(row) : null;
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "border-border hover:bg-muted/30 group",
                        fromJobExpense && "bg-amber-50/50 dark:bg-amber-950/15"
                      )}
                    >
                      <TableCell className="pl-6 align-top">
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileDown className="w-4 h-4 text-muted-foreground shrink-0 opacity-50" />
                            <span className="font-medium truncate">{row.number}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              Přijaté
                            </Badge>
                            {fromJobExpense ? (
                              <>
                                <Badge className="text-[10px] font-normal bg-amber-600 hover:bg-amber-600">
                                  Náklad zakázky
                                </Badge>
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  Zakázka
                                </Badge>
                              </>
                            ) : null}
                          </div>
                          {fromJobExpense ? (
                            <p className="text-[11px] text-muted-foreground leading-snug">
                              Vytvořeno automaticky z nákladu zakázky.
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        {row.jobId ? (
                          <div className="flex flex-col gap-1 min-w-0 max-w-[14rem]">
                            <span className="text-sm font-medium truncate" title={row.jobName ?? row.entityName}>
                              {row.jobName || row.entityName || "Zakázka"}
                            </span>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 justify-start gap-1 text-primary text-xs"
                              asChild
                            >
                              <Link href={`/portal/jobs/${row.jobId}`}>
                                <Briefcase className="w-3.5 h-3.5 shrink-0" />
                                Otevřít zakázku
                              </Link>
                            </Button>
                            {fromJobExpense && row.sourceId ? (
                              <span className="text-[10px] text-muted-foreground font-mono truncate" title={row.sourceId}>
                                Náklad ID: {row.sourceId.slice(0, 10)}…
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {row.entityName ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-nowrap">
                        {row.date ?? "—"}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">
                          {(row.amount ?? 0).toLocaleString("cs-CZ")} Kč
                        </span>
                      </TableCell>
                      <TableCell className="align-top max-w-[14rem]">
                        <p className="text-sm text-foreground/90 line-clamp-3 whitespace-pre-wrap break-words">
                          {row.note || row.description || "—"}
                        </p>
                      </TableCell>
                      <TableCell className="align-top">
                        {row.fileUrl ? (
                          attachKind === "pdf" ? (
                            <Button variant="outline" size="sm" className="gap-1 h-9" asChild>
                              <a href={row.fileUrl} target="_blank" rel="noopener noreferrer">
                                <FileText className="w-4 h-4" />
                                PDF
                              </a>
                            </Button>
                          ) : (
                            <a
                              href={row.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block h-14 w-14 rounded-md border border-border overflow-hidden bg-muted shrink-0"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={row.fileUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            </a>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-6 text-right align-top">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(row)}
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
            Zatím nemáte žádné přijaté doklady.
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
