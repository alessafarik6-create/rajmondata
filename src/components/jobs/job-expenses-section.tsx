"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { DocumentData } from "firebase/firestore";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { useFirestore } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { uploadJobExpenseFileViaFirebaseSdk } from "@/lib/job-photo-upload";
import {
  getJobMediaFileTypeFromFile,
  inferJobMediaItemType,
  isAllowedJobImageFile,
  isAllowedJobMediaFile,
  JOB_IMAGE_ACCEPT_ATTR,
  JOB_MEDIA_ACCEPT_ATTR,
} from "@/lib/job-media-types";
import type { JobExpenseFileType, JobExpenseRow } from "@/lib/job-expense-types";
import { parseAmountKc } from "@/lib/work-contract-deposit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  LIGHT_FORM_CONTROL_CLASS,
} from "@/lib/light-form-control-classes";
import {
  Camera,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";

export type { JobExpenseFileType, JobExpenseRow } from "@/lib/job-expense-types";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

function expenseDateLabel(exp: JobExpenseRow): string {
  if (exp.date && /^\d{4}-\d{2}-\d{2}$/.test(exp.date)) {
    const [y, m, d] = exp.date.split("-").map(Number);
    try {
      return new Date(y, m - 1, d).toLocaleDateString("cs-CZ");
    } catch {
      return exp.date;
    }
  }
  return exp.date || "—";
}

function todayIsoDate(): string {
  const t = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

async function deleteExpenseFileFromStorage(storagePath: string | undefined) {
  if (!storagePath || !storagePath.trim()) return;
  const storage = getFirebaseStorage();
  await deleteObject(storageRef(storage, storagePath.trim()));
}

type Props = {
  companyId: string;
  jobId: string;
  user: User;
  /** Aktuální řádky (např. z useCollection nad expenses) — pro okamžitý přepočet bez reloadu. */
  expenses: JobExpenseRow[] | null | undefined;
  canEdit: boolean;
  originalBudgetKc: number | null;
};

export function JobExpensesSection({
  companyId,
  jobId,
  user,
  expenses,
  canEdit,
  originalBudgetKc,
}: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState(todayIsoDate());
  const [noteInput, setNoteInput] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JobExpenseRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFile || !isAllowedJobImageFile(pendingFile)) {
      setAttachmentPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const sortedExpenses = useMemo(() => {
    const list = [...(expenses ?? [])];
    list.sort((a, b) => {
      const ta =
        a.createdAt && typeof (a.createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      const tb =
        b.createdAt && typeof (b.createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      if (tb !== ta) return tb - ta;
      const da = String(a.date ?? "");
      const db = String(b.date ?? "");
      if (db !== da) return db.localeCompare(da);
      return b.id.localeCompare(a.id);
    });
    return list;
  }, [expenses]);

  const totalExpensesKc = useMemo(
    () =>
      sortedExpenses.reduce((s, e) => {
        const a = typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : 0;
        return s + a;
      }, 0),
    [sortedExpenses]
  );

  const remainingBudgetKc =
    originalBudgetKc != null ? originalBudgetKc - totalExpensesKc : null;

  const resetForm = useCallback(() => {
    setEditingId(null);
    setAmountInput("");
    setDateInput(todayIsoDate());
    setNoteInput("");
    setPendingFile(null);
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, []);

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (row: JobExpenseRow) => {
    setEditingId(row.id);
    setAmountInput(row.amount != null ? String(row.amount) : "");
    setDateInput(row.date && row.date.length >= 8 ? row.date : todayIsoDate());
    setNoteInput(row.note ?? "");
    setPendingFile(null);
    if (galleryInputRef.current) galleryInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    setDialogOpen(true);
  };

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (!isAllowedJobMediaFile(file)) {
      toast({
        title: "Nepodporovaný soubor",
        description: "Povolené jsou obrázky (JPG, PNG, WebP) nebo PDF.",
        variant: "destructive",
      });
      return;
    }
    setPendingFile(file);
  };

  const persistExpense = async () => {
    const amountKc = parseAmountKc(amountInput.replace(/\s/g, " ").trim());
    if (amountKc == null || amountKc <= 0) {
      toast({
        title: "Částka je povinná",
        description: "Zadejte platnou částku v Kč (větší než 0).",
        variant: "destructive",
      });
      return;
    }
    if (!firestore || !companyId || !jobId?.trim()) {
      toast({
        title: "Chybí kontext zakázky",
        description: "Obnovte stránku nebo se znovu přihlaste.",
        variant: "destructive",
      });
      return;
    }
    if (!dateInput.trim()) {
      toast({
        title: "Datum",
        description: "Vyplňte datum nákladu.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const col = collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "expenses"
      );

      let fileUrl: string | undefined;
      let fileType: JobExpenseFileType | undefined;
      let fileName: string | undefined;
      let storagePath: string | undefined;

      if (pendingFile) {
        try {
          const up = await uploadJobExpenseFileViaFirebaseSdk(
            pendingFile,
            companyId,
            jobId
          );
          fileUrl = up.downloadURL;
          storagePath = up.storagePath;
          fileType = getJobMediaFileTypeFromFile(pendingFile);
          fileName =
            pendingFile.name.replace(/^.*[\\/]/, "").trim() || "soubor";
        } catch (uploadErr) {
          console.error(uploadErr);
          toast({
            title: "Nahrání přílohy se nezdařilo",
            description:
              uploadErr instanceof Error
                ? uploadErr.message
                : "Zkontrolujte síť a pravidla úložiště.",
            variant: "destructive",
          });
          return;
        }
      }

      const noteTrimmed = noteInput.trim();

      if (editingId) {
        const existing = sortedExpenses.find((e) => e.id === editingId);
        let oldPathToRemove: string | undefined;

        if (pendingFile && existing?.storagePath) {
          oldPathToRemove = existing.storagePath;
        }

        const refDoc = doc(col, editingId);
        const patch: DocumentData = {
          amount: amountKc,
          date: dateInput.trim(),
          note: noteTrimmed || null,
          updatedAt: serverTimestamp(),
        };
        if (pendingFile) {
          patch.fileUrl = fileUrl ?? null;
          patch.fileType = fileType ?? null;
          patch.fileName = fileName ?? null;
          patch.storagePath = storagePath ?? null;
        }
        await updateDoc(refDoc, patch);

        if (oldPathToRemove) {
          try {
            await deleteExpenseFileFromStorage(oldPathToRemove);
          } catch {
            /* soubor už mohl být smazán */
          }
        }

        toast({
          title: "Náklad uložen",
          description: "Změny jsou zapsány, rozpočet se přepočítá automaticky.",
        });
      } else {
        await addDoc(col, {
          companyId,
          jobId,
          amount: amountKc,
          date: dateInput.trim(),
          note: noteTrimmed || null,
          fileUrl: fileUrl ?? null,
          fileType: fileType ?? null,
          fileName: fileName ?? null,
          storagePath: storagePath ?? null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        toast({
          title: "Náklad přidán",
          description: "Záznam je uložen, rozpočet se přepočítá automaticky.",
        });
      }

      setDialogOpen(false);
      resetForm();
    } catch (e) {
      console.error(e);
      toast({
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to prosím znovu.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !firestore || !companyId || !jobId?.trim()) {
      toast({
        title: "Chybí kontext zakázky",
        description: "Smazání nelze dokončit.",
        variant: "destructive",
      });
      return;
    }
    setDeleting(true);
    try {
      const col = collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "expenses"
      );
      await deleteDoc(doc(col, deleteTarget.id));
      try {
        await deleteExpenseFileFromStorage(
          deleteTarget.storagePath ?? undefined
        );
      } catch {
        /* */
      }
      toast({
        title: "Náklad smazán",
        description: "Záznam byl odstraněn.",
      });
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      toast({
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to prosím znovu.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="bg-surface border-border">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="w-5 h-5 text-primary shrink-0" />
            Náklady
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Přehled výdajů a příloh dokladů. Částky se odečítají od rozpočtu zakázky.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Původní rozpočet
              </p>
              <p className="text-base font-semibold tabular-nums">
                {originalBudgetKc != null ? formatKc(originalBudgetKc) : "—"}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Celkové náklady
              </p>
              <p className="text-base font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                {formatKc(totalExpensesKc)}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Zbývá
              </p>
              <p
                className={cn(
                  "text-base font-semibold tabular-nums",
                  remainingBudgetKc != null && remainingBudgetKc < 0
                    ? "text-destructive"
                    : "text-emerald-700 dark:text-emerald-400"
                )}
              >
                {remainingBudgetKc != null ? formatKc(remainingBudgetKc) : "—"}
              </p>
            </div>
          </div>

          {canEdit ? (
            <Button
              type="button"
              className="w-full sm:w-auto min-h-[44px]"
              onClick={openCreate}
            >
              <Plus className="w-4 h-4 mr-2" />
              Přidat náklad
            </Button>
          ) : null}

          {sortedExpenses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Zatím žádné náklady. {canEdit ? "Přidejte první záznam." : ""}
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedExpenses.map((row) => {
                const attachmentKind = inferJobMediaItemType(row);
                return (
                <li
                  key={row.id}
                  className="rounded-lg border border-border/70 bg-background/50 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-stretch gap-3"
                >
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-semibold tabular-nums text-base">
                        {typeof row.amount === "number"
                          ? formatKc(row.amount)
                          : "—"}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {expenseDateLabel(row)}
                      </span>
                    </div>
                    {row.note ? (
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                        {row.note}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Bez poznámky</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 sm:items-end">
                    {row.fileUrl ? (
                      <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:max-w-[min(100%,20rem)] sm:items-end">
                        <Badge variant="outline" className="w-fit text-xs font-normal">
                          {attachmentKind === "pdf" ? "PDF" : "Foto"}
                        </Badge>
                        {attachmentKind === "pdf" ? (
                          <div className="flex w-full min-w-0 flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
                            <div className="flex min-w-0 items-start gap-2">
                              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                              <span className="min-w-0 flex-1 break-all text-left text-sm font-medium leading-snug">
                                {row.fileName || "PDF doklad"}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="min-h-9 shrink-0 gap-1.5"
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
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-9 shrink-0 gap-1.5"
                                asChild
                              >
                                <a href={row.fileUrl} download={row.fileName || "doklad.pdf"}>
                                  <Download className="h-4 w-4" />
                                  Stáhnout
                                </a>
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <a
                            href={row.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full max-w-[12rem] shrink-0 overflow-hidden rounded-md border border-border bg-muted aspect-square sm:w-28 sm:max-w-none"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={row.fileUrl}
                              alt={row.fileName || "Příloha nákladu"}
                              className="h-full w-full object-cover"
                            />
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Bez přílohy</span>
                    )}

                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1 sm:mt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="min-h-10 min-w-10"
                          onClick={() => openEdit(row)}
                          aria-label="Upravit náklad"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="min-h-10 min-w-10 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                          aria-label="Smazat náklad"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto flex flex-col gap-0">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Upravit náklad" : "Nový náklad"}
            </DialogTitle>
            <DialogDescription>
              Částku vyplňte ručně (i u fotky dokladu). Volitelně připojte přílohu.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="expense-amount">Částka (Kč) *</Label>
              <Input
                id="expense-amount"
                inputMode="decimal"
                placeholder="např. 1 250"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[44px]")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-date">Datum *</Label>
              <Input
                id="expense-date"
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className={cn(
                  LIGHT_FORM_CONTROL_CLASS,
                  "[color-scheme:light] min-h-[44px]"
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-note">Poznámka / popis</Label>
              <Textarea
                id="expense-note"
                rows={3}
                placeholder="Volitelný popis…"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[96px]")}
              />
            </div>

            <div className="space-y-2">
              <Label>Příloha (volitelné)</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 min-h-[44px] justify-start gap-2"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <ImageIcon className="w-4 h-4 shrink-0" />
                  Fotografie nebo PDF
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 min-h-[44px] justify-start gap-2"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  Vyfotit doklad
                </Button>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                className="hidden"
                accept={JOB_MEDIA_ACCEPT_ATTR}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  onPickFile(f);
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                className="hidden"
                accept={JOB_IMAGE_ACCEPT_ATTR}
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  onPickFile(f);
                }}
              />
              {pendingFile ? (
                <p className="text-sm text-muted-foreground break-all">
                  Nový soubor: <span className="font-medium text-foreground">{pendingFile.name}</span>
                </p>
              ) : editingId ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Příloha beze změny (vyberte soubor pro nahrazení).
                  </p>
                  {(() => {
                    const current = sortedExpenses.find((e) => e.id === editingId);
                    if (!current?.fileUrl) return null;
                    const kind = inferJobMediaItemType(current);
                    if (kind === "pdf") {
                      return (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                          <FileText className="h-6 w-6 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {current.fileName || "PDF"}
                          </span>
                          <Button type="button" variant="ghost" size="sm" className="shrink-0" asChild>
                            <a href={current.fileUrl} target="_blank" rel="noopener noreferrer">
                              Náhled
                            </a>
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <div className="overflow-hidden rounded-md border border-border bg-muted max-h-40 w-full max-w-xs mx-auto sm:mx-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={current.fileUrl}
                          alt=""
                          className="max-h-40 w-full object-contain object-center"
                        />
                      </div>
                    );
                  })()}
                </div>
              ) : null}
              {pendingFile && isAllowedJobImageFile(pendingFile) && attachmentPreviewUrl ? (
                <div className="mt-2 max-h-48 overflow-hidden rounded-md border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachmentPreviewUrl}
                    alt="Náhled přílohy"
                    className="max-h-48 w-full object-contain object-center"
                  />
                </div>
              ) : null}
              {pendingFile && !isAllowedJobImageFile(pendingFile) && pendingFile.type === "application/pdf" ? (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                  <FileText className="h-8 w-8 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 break-all text-sm font-medium">
                    {pendingFile.name}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={submitting}
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={submitting}
              onClick={() => void persistExpense()}
            >
              {submitting ? "Ukládám…" : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Smazat náklad?</DialogTitle>
            <DialogDescription>
              Tato akce je nevratná. Soubor přílohy bude také odstraněn z úložiště.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-[44px]"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Mažu…" : "Smazat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
