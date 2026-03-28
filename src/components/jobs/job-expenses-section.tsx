"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { DocumentData } from "firebase/firestore";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import { logActivitySafe } from "@/lib/activity-log";
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
import {
  buildJobExpenseMirrorMergePatch,
  buildNewJobExpenseMirrorDocument,
  companyDocumentRefForJobExpense,
} from "@/lib/job-expense-document-sync";
import { DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE } from "@/lib/daily-work-report-job-labor-expenses-constants";
import { COMPANY_DOCUMENT_EXPENSE_SOURCE } from "@/lib/document-job-expense-sync";
import type { JobBudgetBreakdown } from "@/lib/vat-calculations";
import {
  computeExpenseAmountsFromInput,
  normalizeBudgetType,
  normalizeVatRate,
  roundMoney2,
  VAT_RATE_OPTIONS,
  resolveExpenseAmounts,
} from "@/lib/vat-calculations";
import { parseMoneyAmountInput } from "@/lib/work-contract-deposit";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";

/** Typografie nákladů — tmavé popisky, černá čísla (detail zakázky = světlý režim) */
function isDailyWorkReportLaborExpense(row: JobExpenseRow): boolean {
  return row.source === DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE;
}

const EXP = {
  h1: "text-gray-950 font-bold tracking-tight",
  h2: "font-semibold text-gray-950",
  lead: "text-base text-gray-800",
  label: "text-xs font-semibold uppercase tracking-wide text-gray-700",
  labelSm: "text-xs font-medium uppercase tracking-wide text-gray-600",
  body: "text-base text-gray-900",
  bodySm: "text-sm text-gray-800",
  meta: "text-xs text-gray-600 sm:text-sm",
  amount: "font-bold tabular-nums text-gray-950",
  amountLg: "text-lg font-bold tabular-nums text-gray-950 sm:text-xl",
  gridHdr: "text-xs font-medium uppercase tracking-wide text-gray-600",
  note: "text-gray-900",
  chevron: "shrink-0 text-gray-600 transition-transform duration-200",
} as const;
import {
  Camera,
  ChevronRight,
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
  /** Název zakázky pro doklad v sekci Doklady (subjekt / vazba). */
  jobDisplayName?: string | null;
  user: User;
  /** Aktuální řádky (např. z useCollection nad expenses) — pro okamžitý přepočet bez reloadu. */
  expenses: JobExpenseRow[] | null | undefined;
  canEdit: boolean;
  /** Rozpočet zakázky (bez / DPH / s DPH) z Firestore. */
  jobBudget: JobBudgetBreakdown | null;
  /** Širší rozvržení pro detail zakázky (celá šířka stránky). */
  layout?: "default" | "jobDetailWide";
};

export function JobExpensesSection({
  companyId,
  jobId,
  jobDisplayName = null,
  user,
  expenses,
  canEdit,
  jobBudget,
  layout = "default",
}: Props) {
  const isJobDetailWide = layout === "jobDetailWide";
  const firestore = useFirestore();
  const { toast } = useToast();
  const actorRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: actorProfile } = useDoc(actorRef);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  /** Zda je pole částky bez DPH nebo s DPH. */
  const [amountTypeInput, setAmountTypeInput] = useState<"net" | "gross">("net");
  const [vatRateInput, setVatRateInput] = useState<string>("21");
  const [dateInput, setDateInput] = useState(todayIsoDate());
  const [noteInput, setNoteInput] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JobExpenseRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  /** Sekce Náklady — na detailu zakázky výchozí rozbalená. */
  const [expensesSectionOpen, setExpensesSectionOpen] = useState(
    () => layout === "jobDetailWide"
  );
  /** Seznam — po 5 položkách „Zobrazit více“. */
  const [expensesListExpanded, setExpensesListExpanded] = useState(false);

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

  const expenseTotals = useMemo(() => {
    let net = 0;
    let gross = 0;
    let vat = 0;
    for (const e of sortedExpenses) {
      const r = resolveExpenseAmounts(e);
      net += r.amountNet;
      gross += r.amountGross;
      vat += r.vatAmount;
    }
    return {
      net: roundMoney2(net),
      gross: roundMoney2(gross),
      vat: roundMoney2(vat),
    };
  }, [sortedExpenses]);

  const remainingNetKc =
    jobBudget != null ? jobBudget.budgetNet - expenseTotals.net : null;
  const remainingGrossKc =
    jobBudget != null ? jobBudget.budgetGross - expenseTotals.gross : null;

  const visibleExpenses = useMemo(() => {
    if (expensesListExpanded) return sortedExpenses;
    return sortedExpenses.slice(0, 5);
  }, [sortedExpenses, expensesListExpanded]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setAmountInput("");
    setAmountTypeInput("net");
    setVatRateInput("21");
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
    if (isDailyWorkReportLaborExpense(row)) {
      toast({
        title: "Úprava z výkazu práce",
        description:
          "Tento náklad vznikl ze schváleného výkazu práce. Změňte výkaz u zaměstnance a nechte ho znovu schválit.",
        variant: "destructive",
      });
      return;
    }
    setEditingId(row.id);
    const r = resolveExpenseAmounts(row);
    const rawIn = row.amountInput;
    if (typeof rawIn === "number" && Number.isFinite(rawIn) && rawIn > 0) {
      const s = String(roundMoney2(rawIn));
      setAmountInput(s.includes(".") ? s.replace(".", ",") : s);
      setAmountTypeInput(normalizeBudgetType(row.amountType));
    } else {
      setAmountInput(r.amountNet ? String(r.amountNet) : "");
      setAmountTypeInput("net");
    }
    setVatRateInput(String(r.vatRate));
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
        description: "Povolené jsou obrázky (JPG, PNG, WebP), PDF nebo Office.",
        variant: "destructive",
      });
      return;
    }
    setPendingFile(file);
  };

  const persistExpense = async () => {
    const amountKc = parseMoneyAmountInput(amountInput.replace(/\s/g, " ").trim());
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
      const vatRate = normalizeVatRate(Number(vatRateInput));
      const amountTypeResolved = normalizeBudgetType(amountTypeInput);
      const amountInputStored = roundMoney2(amountKc);
      const { amountNet, vatAmount, amountGross } = computeExpenseAmountsFromInput({
        amountInput: amountInputStored,
        amountType: amountTypeResolved,
        vatRate,
      });

      if (editingId) {
        const existing = sortedExpenses.find((e) => e.id === editingId);
        const prevAmts = existing ? resolveExpenseAmounts(existing) : null;
        let oldPathToRemove: string | undefined;

        if (pendingFile && existing?.storagePath) {
          oldPathToRemove = existing.storagePath;
        }

        const refDoc = doc(col, editingId);
        const patch: DocumentData = {
          amount: amountNet,
          amountInput: amountInputStored,
          amountType: amountTypeResolved,
          amountNet,
          vatRate,
          vatAmount,
          amountGross,
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

        logActivitySafe(firestore, companyId, user, actorProfile, {
          actionType: "expense.update",
          actionLabel: "Úprava nákladu zakázky",
          entityType: "job_expense",
          entityId: editingId,
          entityName: noteTrimmed || `Náklad ${dateInput.trim()}`,
          details: `${formatKc(amountNet)} bez DPH / ${formatKc(amountGross)} s DPH · ${dateInput.trim()}${
            pendingFile ? ` · nový soubor: ${fileName ?? ""}` : ""
          }`,
          sourceModule: "jobs",
          route: `/portal/jobs/${jobId}`,
          metadata: {
            jobId,
            jobDisplayName: jobDisplayName ?? null,
            expenseId: editingId,
            previousAmount: prevAmts?.amountNet ?? existing?.amount ?? null,
            newAmount: amountNet,
            previousDate: existing?.date ?? null,
            newDate: dateInput.trim(),
            fileName: fileName ?? existing?.fileName ?? null,
            fileType: fileType ?? existing?.fileType ?? null,
            attachmentReplaced: Boolean(pendingFile),
          },
        });
        if (pendingFile && fileName) {
          logActivitySafe(firestore, companyId, user, actorProfile, {
            actionType: "document.upload",
            actionLabel: "Nová příloha k nákladu (úprava)",
            entityType: "job_expense_file",
            entityId: editingId,
            entityName: fileName,
            details: `Náklad ${formatKc(amountNet)} bez DPH`,
            sourceModule: "jobs",
            route: `/portal/jobs/${jobId}`,
            metadata: {
              jobId,
              expenseId: editingId,
              fileName,
              fileType: fileType ?? null,
              mimeType: pendingFile.type ?? null,
            },
          });
        }

        const nextFileUrl = pendingFile
          ? fileUrl ?? null
          : (existing?.fileUrl ?? null);
        const nextFileType = pendingFile
          ? fileType ?? null
          : (existing?.fileType ?? null);
        const nextFileName = pendingFile
          ? fileName ?? null
          : (existing?.fileName ?? null);
        const nextStoragePath = pendingFile
          ? storagePath ?? null
          : (existing?.storagePath ?? null);

        const linkedCompanyDocId =
          existing?.source === COMPANY_DOCUMENT_EXPENSE_SOURCE
            ? existing.dokladId?.trim() ?? ""
            : "";

        if (linkedCompanyDocId) {
          const noteVal = noteTrimmed || null;
          const primaryPatch: DocumentData = {
            castka: amountGross,
            amountNet,
            amountGross,
            vatAmount,
            vatRate,
            vat: vatRate,
            dphSazba: vatRate,
            sDPH: vatRate > 0,
            amount: amountNet,
            date: dateInput.trim(),
            note: noteVal,
            poznamka: noteVal,
            description: noteVal ?? "",
            updatedAt: serverTimestamp(),
          };
          if (pendingFile) {
            primaryPatch.fileUrl = nextFileUrl;
            primaryPatch.fileType = nextFileType;
            primaryPatch.fileName = nextFileName;
            primaryPatch.storagePath = nextStoragePath;
            primaryPatch.mimeType = pendingFile.type?.trim() || null;
          }
          await updateDoc(
            doc(
              firestore,
              "companies",
              companyId,
              "documents",
              linkedCompanyDocId
            ),
            primaryPatch
          );
        } else {
          const mirrorRef = companyDocumentRefForJobExpense(
            firestore,
            companyId,
            editingId
          );
          const mirrorSnap = await getDoc(mirrorRef);
          if (!mirrorSnap.exists()) {
            await setDoc(
              mirrorRef,
              buildNewJobExpenseMirrorDocument({
                companyId,
                jobId,
                jobDisplayName,
                expenseId: editingId,
                userId: String(existing?.createdBy ?? user.uid),
                amountInput: amountInputStored,
                amountType: amountTypeResolved,
                amountNet,
                vatRate,
                vatAmount,
                amountGross,
                date: dateInput.trim(),
                note: noteTrimmed || null,
                fileUrl: nextFileUrl,
                fileType: nextFileType,
                fileName: nextFileName,
                storagePath: nextStoragePath,
                mimeType: pendingFile?.type?.trim() || null,
              })
            );
          } else {
            await setDoc(
              mirrorRef,
              buildJobExpenseMirrorMergePatch({
                companyId,
                jobId,
                jobDisplayName,
                expenseId: editingId,
                amountInput: amountInputStored,
                amountType: amountTypeResolved,
                amountNet,
                vatRate,
                vatAmount,
                amountGross,
                date: dateInput.trim(),
                note: noteTrimmed || null,
                fileUrl: nextFileUrl,
                fileType: nextFileType,
                fileName: nextFileName,
                storagePath: nextStoragePath,
                ...(pendingFile
                  ? { mimeType: pendingFile.type?.trim() || null }
                  : {}),
              }),
              { merge: true }
            );
          }
        }

        if (oldPathToRemove) {
          try {
            await deleteExpenseFileFromStorage(oldPathToRemove);
          } catch {
            /* soubor už mohl být smazán */
          }
        }

        toast({
          title: "Náklad uložen",
          description:
            "Změny jsou zapsány v zakázce i v dokladech, rozpočet se přepočítá automaticky.",
        });
      } else {
        const expenseRef = doc(
          collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "expenses"
          )
        );
        const mirrorRef = companyDocumentRefForJobExpense(
          firestore,
          companyId,
          expenseRef.id
        );
        const expensePayload = {
          companyId,
          jobId,
          amount: amountNet,
          amountNet,
          vatRate,
          vatAmount,
          amountGross,
          date: dateInput.trim(),
          note: noteTrimmed || null,
          fileUrl: fileUrl ?? null,
          fileType: fileType ?? null,
          fileName: fileName ?? null,
          storagePath: storagePath ?? null,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        const mirrorDoc = buildNewJobExpenseMirrorDocument({
          companyId,
          jobId,
          jobDisplayName,
          expenseId: expenseRef.id,
          userId: user.uid,
          amountInput: amountInputStored,
          amountType: amountTypeResolved,
          amountNet,
          vatRate,
          vatAmount,
          amountGross,
          date: dateInput.trim(),
          note: noteTrimmed || null,
          fileUrl: fileUrl ?? null,
          fileType: fileType ?? null,
          fileName: fileName ?? null,
          storagePath: storagePath ?? null,
          mimeType: pendingFile?.type?.trim() || null,
        });

        await runTransaction(firestore, async (transaction) => {
          transaction.set(expenseRef, expensePayload);
          transaction.set(mirrorRef, mirrorDoc);
        });

        toast({
          title: "Náklad přidán",
          description:
            "Záznam je v zakázce i mezi přijatými doklady, rozpočet se přepočítá automaticky.",
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
    if (deleteTarget && isDailyWorkReportLaborExpense(deleteTarget)) {
      toast({
        title: "Smazání nelze",
        description:
          "Náklad je vázaný na schválený výkaz práce. Odeberte řádek ve výkazu nebo vraťte výkaz k úpravě.",
        variant: "destructive",
      });
      setDeleteTarget(null);
      return;
    }
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
      const expenseRef = doc(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "expenses",
        deleteTarget.id
      );
      const mirrorRef = companyDocumentRefForJobExpense(
        firestore,
        companyId,
        deleteTarget.id
      );
      const dokladId =
        deleteTarget.source === COMPANY_DOCUMENT_EXPENSE_SOURCE
          ? deleteTarget.dokladId?.trim()
          : "";
      const batch = writeBatch(firestore);
      batch.delete(expenseRef);
      if (!dokladId) {
        batch.delete(mirrorRef);
      } else {
        const companyDocRef = doc(
          firestore,
          "companies",
          companyId,
          "documents",
          dokladId
        );
        batch.update(companyDocRef, {
          linkedExpenseId: deleteField(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      try {
        await deleteExpenseFileFromStorage(
          deleteTarget.storagePath ?? undefined
        );
      } catch {
        /* */
      }
      const delAmts = resolveExpenseAmounts(deleteTarget);
      logActivitySafe(firestore, companyId, user, actorProfile, {
        actionType: "expense.delete",
        actionLabel: "Smazání nákladu zakázky",
        entityType: "job_expense",
        entityId: deleteTarget.id,
        entityName:
          deleteTarget.note?.trim() ||
          (delAmts.amountNet > 0
            ? `${formatKc(delAmts.amountNet)}`
            : deleteTarget.id),
        details: `Bez DPH ${formatKc(delAmts.amountNet)}, s DPH ${formatKc(delAmts.amountGross)}`,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: {
          jobId,
          expenseId: deleteTarget.id,
          fileName: deleteTarget.fileName ?? null,
          hadAttachment: Boolean(deleteTarget.fileUrl || deleteTarget.storagePath),
        },
      });
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
      <Card className={cn("w-full min-w-0", JD.card)}>
        <CardHeader
          className={cn("space-y-4 sm:space-y-5", "p-4 sm:p-6")}
        >
          <div className="space-y-2">
            <CardTitle
              id="job-expenses-heading"
              className={cn(
                "flex items-start gap-2.5 font-semibold leading-tight tracking-tight text-gray-950",
                isJobDetailWide ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"
              )}
            >
              <Wallet
                className={cn(
                  "mt-0.5 shrink-0 text-primary",
                  isJobDetailWide ? "h-6 w-6 sm:h-7 sm:w-7" : "h-5 w-5 sm:h-6 sm:w-6"
                )}
                aria-hidden
              />
              <span>{isJobDetailWide ? "Náklady zakázky" : "Náklady"}</span>
            </CardTitle>
            <CardDescription
              className={cn(
                "text-gray-600",
                isJobDetailWide ? "text-base" : "text-sm sm:text-base"
              )}
            >
              {isJobDetailWide
                ? "Rozpočet, evidované náklady a zbývající prostředky. Hlavní přehled je v částkách s DPH."
                : "Rozpočet, náklady a zbývá u této zakázky."}
            </CardDescription>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
              <span
                className={cn(
                  "text-xs font-medium uppercase tracking-wide text-gray-600",
                  isJobDetailWide && "sm:text-sm"
                )}
              >
                Rozpočet
              </span>
              <span
                className={cn(
                  "font-bold tabular-nums tracking-tight text-gray-950",
                  isJobDetailWide ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"
                )}
              >
                {jobBudget != null ? formatKc(jobBudget.budgetGross) : "—"}
              </span>
              <span className="text-xs text-gray-600 sm:text-sm">s DPH</span>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
              <span
                className={cn(
                  "text-xs font-medium uppercase tracking-wide text-gray-600",
                  isJobDetailWide && "sm:text-sm"
                )}
              >
                Náklady
              </span>
              <span
                className={cn(
                  "font-extrabold tabular-nums tracking-tight text-gray-950",
                  isJobDetailWide ? "text-xl sm:text-2xl" : "text-lg sm:text-xl"
                )}
              >
                {formatKc(expenseTotals.gross)}
              </span>
              <span className="text-xs text-gray-600 sm:text-sm">s DPH (součet)</span>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
              <span
                className={cn(
                  "text-xs font-medium uppercase tracking-wide text-gray-600",
                  isJobDetailWide && "sm:text-sm"
                )}
              >
                Zbývá
              </span>
              <span
                className={cn(
                  "font-bold tabular-nums tracking-tight",
                  isJobDetailWide ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
                  remainingGrossKc == null && "text-gray-950",
                  remainingGrossKc != null &&
                    remainingGrossKc >= 0 &&
                    "text-emerald-700",
                  remainingGrossKc != null &&
                    remainingGrossKc < 0 &&
                    "text-red-700"
                )}
              >
                {remainingGrossKc != null ? formatKc(remainingGrossKc) : "—"}
              </span>
              <span className="text-xs text-gray-600 sm:text-sm">s DPH</span>
            </div>
          </div>

          <div
            className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:grid-cols-3 sm:gap-4"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 sm:text-sm">
                Rozpočet bez DPH
              </p>
              <p
                className={cn(
                  "mt-1.5 font-semibold tabular-nums text-gray-950",
                  isJobDetailWide ? "text-base sm:text-lg" : "text-sm sm:text-base"
                )}
              >
                {jobBudget != null ? formatKc(jobBudget.budgetNet) : "—"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 sm:text-sm">
                Náklady bez DPH
              </p>
              <p
                className={cn(
                  "mt-1.5 font-semibold tabular-nums text-gray-950",
                  isJobDetailWide ? "text-base sm:text-lg" : "text-sm sm:text-base"
                )}
              >
                {formatKc(expenseTotals.net)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 sm:text-sm">
                Zbývá bez DPH
              </p>
              <p
                className={cn(
                  "mt-1.5 font-bold tabular-nums",
                  isJobDetailWide ? "text-base sm:text-lg" : "text-sm sm:text-base",
                  remainingNetKc == null && "text-gray-950",
                  remainingNetKc != null &&
                    remainingNetKc >= 0 &&
                    "text-emerald-700",
                  remainingNetKc != null &&
                    remainingNetKc < 0 &&
                    "text-red-700"
                )}
              >
                {remainingNetKc != null ? formatKc(remainingNetKc) : "—"}
              </p>
            </div>
          </div>
        </CardHeader>

        <Collapsible
          open={expensesSectionOpen}
          onOpenChange={(next) => {
            setExpensesSectionOpen(next);
            if (!next) setExpensesListExpanded(false);
          }}
        >
          <div className="border-t border-gray-200 px-4 sm:px-6">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outlineLight"
                className={cn(
                  "mt-3 w-full justify-between gap-3 rounded-lg border-slate-200 bg-white px-4 py-3 text-left font-semibold text-gray-950 shadow-sm hover:bg-slate-50",
                  isJobDetailWide ? "min-h-[48px] text-base" : "min-h-[44px] text-sm sm:text-base"
                )}
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span>Seznam nákladů</span>
                  {sortedExpenses.length > 0 ? (
                    <span className="tabular-nums font-medium text-gray-700">
                      ({sortedExpenses.length})
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  className={cn(
                    EXP.chevron,
                    "h-5 w-5",
                    expensesSectionOpen && "rotate-90"
                  )}
                  aria-hidden
                />
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <CardContent
              className={cn(
                "space-y-4 border-t border-gray-200 bg-white pb-4 pt-4",
                isJobDetailWide ? "px-4 sm:px-6" : "px-4 sm:px-6"
              )}
            >
              <p
                className={cn(
                  "text-gray-800",
                  isJobDetailWide ? "text-base" : "text-sm sm:text-base"
                )}
              >
                Výdaje a přílohy — částku lze zadat bez DPH nebo s DPH; součty se
                odečítají od rozpočtu (bez DPH / s DPH).
                {sortedExpenses.length > 0 ? (
                  <span className="font-semibold text-gray-950">
                    {" "}
                    ({sortedExpenses.length})
                  </span>
                ) : null}
              </p>

              {canEdit ? (
                <Button
                  type="button"
                  variant="default"
                  className={cn(
                    "w-full sm:w-auto",
                    isJobDetailWide ? "h-11 min-h-[44px] px-6 text-base" : "h-10"
                  )}
                  onClick={openCreate}
                >
                  <Plus
                    className={cn("mr-1.5", isJobDetailWide ? "h-5 w-5" : "h-4 w-4")}
                  />
                  Přidat náklad
                </Button>
              ) : null}

              {sortedExpenses.length === 0 ? (
                <p
                  className={cn(
                    "py-2 text-gray-800",
                    isJobDetailWide
                      ? "text-base"
                      : "py-1 text-sm"
                  )}
                >
                  Zatím žádné náklady. {canEdit ? "Přidejte první záznam." : ""}
                </p>
              ) : (
                <>
                  <div
                    className={cn(
                      "overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm",
                      isJobDetailWide
                        ? expensesListExpanded
                          ? "max-h-[min(75vh,880px)]"
                          : "max-h-[min(65vh,720px)]"
                        : expensesListExpanded
                          ? "max-h-[min(400px,55vh)]"
                          : "max-h-[min(320px,45vh)]"
                    )}
                  >
                    <ul
                      className={cn(
                        "divide-y divide-gray-200",
                        isJobDetailWide && "divide-gray-100"
                      )}
                    >
                      {visibleExpenses.map((row) => {
                        const attachmentKind = inferJobMediaItemType(row);
                        const r = resolveExpenseAmounts(row);
                        const fromWorkReport = isDailyWorkReportLaborExpense(row);
                        const tag =
                          normalizeBudgetType(row.amountType) === "gross"
                            ? "s DPH"
                            : "bez DPH";
                        const attachmentBlock =
                          row.fileUrl ? (
                            <>
                              {attachmentKind === "pdf" ? (
                                <FileText
                                  className={cn(
                                    "shrink-0 text-gray-700",
                                    isJobDetailWide ? "h-6 w-6" : "h-3.5 w-3.5 sm:h-4 sm:w-4"
                                  )}
                                  aria-hidden
                                />
                              ) : (
                                <a
                                  href={row.fileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    "relative shrink-0 overflow-hidden rounded border border-border",
                                    isJobDetailWide ? "h-11 w-11" : "h-8 w-8"
                                  )}
                                  title={row.fileName || "Otevřít"}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={row.fileUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </a>
                              )}
                              <div className="flex shrink-0 gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    isJobDetailWide ? "h-10 w-10" : "h-8 w-8",
                                    "text-gray-800 hover:bg-gray-100 hover:text-gray-950"
                                  )}
                                  asChild
                                >
                                  <a
                                    href={row.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Otevřít"
                                  >
                                    <ExternalLink
                                      className={isJobDetailWide ? "h-5 w-5" : "h-3.5 w-3.5"}
                                    />
                                  </a>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    isJobDetailWide ? "h-10 w-10" : "h-8 w-8",
                                    "text-gray-800 hover:bg-gray-100 hover:text-gray-950"
                                  )}
                                  asChild
                                >
                                  <a
                                    href={row.fileUrl}
                                    download={row.fileName || "doklad"}
                                    title="Stáhnout"
                                  >
                                    <Download
                                      className={isJobDetailWide ? "h-5 w-5" : "h-3.5 w-3.5"}
                                    />
                                  </a>
                                </Button>
                              </div>
                            </>
                          ) : (
                            <span className="text-gray-600">—</span>
                          );

                        if (isJobDetailWide) {
                          return (
                            <li key={row.id} className="bg-white transition-colors hover:bg-gray-50/90">
                              <div
                                className="grid grid-cols-1 gap-3 px-3 py-4 text-base sm:grid-cols-[minmax(0,7.5rem)_minmax(0,9rem)_minmax(0,8rem)_minmax(0,9rem)_minmax(0,1fr)_minmax(0,10rem)_auto] sm:items-center sm:gap-4 sm:px-5 sm:py-4 lg:gap-5"
                              >
                                <div className="space-y-1.5">
                                  <span className="text-sm font-semibold text-gray-950">
                                    {expenseDateLabel(row)}
                                  </span>
                                  <Badge
                                    variant="secondary"
                                    className="border border-gray-200 bg-gray-50 text-xs font-medium text-gray-900"
                                  >
                                    {tag} · {r.vatRate} %
                                  </Badge>
                                  {row.source === COMPANY_DOCUMENT_EXPENSE_SOURCE ? (
                                    <Badge
                                      variant="outline"
                                      className="border-gray-300 bg-white text-xs font-medium text-gray-900"
                                    >
                                      Propojený doklad
                                    </Badge>
                                  ) : null}
                                  {fromWorkReport ? (
                                    <Badge
                                      variant="outline"
                                      className="border-blue-200 bg-blue-50 text-xs font-medium text-blue-950"
                                    >
                                      Výkaz práce
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="tabular-nums">
                                  <p className={EXP.labelSm}>
                                    Bez DPH
                                  </p>
                                  <p className={EXP.amountLg}>
                                    {formatKc(r.amountNet)}
                                  </p>
                                </div>
                                <div className="tabular-nums">
                                  <p className={EXP.labelSm}>
                                    DPH
                                  </p>
                                  <p className={EXP.amountLg}>
                                    {formatKc(r.vatAmount)}
                                  </p>
                                </div>
                                <div className="tabular-nums">
                                  <p className={EXP.labelSm}>
                                    S DPH
                                  </p>
                                  <p className={EXP.amountLg}>
                                    {formatKc(r.amountGross)}
                                  </p>
                                </div>
                                <div className="min-w-0">
                                  <p className="line-clamp-3 break-words text-base leading-snug text-gray-900">
                                    {row.note?.trim() || (
                                      <span className="italic text-gray-600">
                                        —
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  {attachmentBlock}
                                </div>
                                <div className="flex justify-end gap-1 sm:justify-end">
                                  {canEdit && !fromWorkReport ? (
                                    <>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-10 w-10 text-gray-800 hover:bg-gray-100 hover:text-gray-950"
                                        onClick={() => openEdit(row)}
                                        aria-label="Upravit náklad"
                                      >
                                        <Pencil className="h-5 w-5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-10 w-10 text-destructive hover:bg-red-50 hover:text-destructive"
                                        onClick={() => setDeleteTarget(row)}
                                        aria-label="Smazat náklad"
                                      >
                                        <Trash2 className="h-5 w-5" />
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        }

                        return (
                          <li key={row.id} className="bg-white hover:bg-gray-50/90">
                            <div
                              className={cn(
                                "grid gap-x-2 gap-y-1 px-2 py-2.5 text-xs text-gray-950 sm:min-h-11 sm:max-h-[60px] sm:grid-cols-[100px_120px_1fr_minmax(0,120px)_80px] sm:items-center sm:py-2 sm:text-sm"
                              )}
                            >
                              <div className="order-2 tabular-nums text-gray-800 sm:order-1">
                                {expenseDateLabel(row)}
                              </div>
                                <div className="order-1 space-y-0.5 font-semibold tabular-nums sm:order-2">
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge
                                    variant="secondary"
                                    className="h-5 border border-gray-200 bg-gray-50 px-1.5 text-[10px] font-medium text-gray-900"
                                  >
                                    {tag}
                                  </Badge>
                                  {row.source === COMPANY_DOCUMENT_EXPENSE_SOURCE ? (
                                    <Badge
                                      variant="outline"
                                      className="h-5 border-gray-300 bg-white px-1.5 text-[10px] font-medium text-gray-900"
                                    >
                                      Doklad
                                    </Badge>
                                  ) : null}
                                  {fromWorkReport ? (
                                    <Badge
                                      variant="outline"
                                      className="h-5 border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-950"
                                    >
                                      Výkaz
                                    </Badge>
                                  ) : null}
                                  <span className="text-[10px] font-medium text-gray-700 sm:text-xs">
                                    DPH {r.vatRate} %
                                  </span>
                                </div>
                                <div className="text-[10px] font-normal text-gray-700 sm:text-xs">
                                  Bez DPH {formatKc(r.amountNet)} · DPH{" "}
                                  {formatKc(r.vatAmount)}
                                </div>
                                <div className="font-bold text-gray-950">
                                  S DPH {formatKc(r.amountGross)}
                                </div>
                              </div>
                              <div className="order-3 min-w-0 sm:col-span-1">
                                <p className="line-clamp-2 break-words text-gray-900 sm:line-clamp-1">
                                  {row.note?.trim() || (
                                    <span className="italic text-gray-600">
                                      —
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="order-4 flex min-w-0 items-center gap-1 sm:justify-start">
                                {row.fileUrl ? (
                                  <>
                                    {attachmentKind === "pdf" ? (
                                      <FileText
                                        className="h-3.5 w-3.5 shrink-0 text-gray-700 sm:h-4 sm:w-4"
                                        aria-hidden
                                      />
                                    ) : (
                                      <a
                                        href={row.fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="relative h-8 w-8 shrink-0 overflow-hidden rounded border border-gray-200"
                                        title={row.fileName || "Otevřít"}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={row.fileUrl}
                                          alt=""
                                          className="h-full w-full object-cover"
                                        />
                                      </a>
                                    )}
                                    <div className="flex shrink-0 gap-0.5">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-gray-800 hover:bg-gray-100 hover:text-gray-950"
                                        asChild
                                      >
                                        <a
                                          href={row.fileUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Otevřít"
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-gray-800 hover:bg-gray-100 hover:text-gray-950"
                                        asChild
                                      >
                                        <a
                                          href={row.fileUrl}
                                          download={row.fileName || "doklad"}
                                          title="Stáhnout"
                                        >
                                          <Download className="h-3.5 w-3.5" />
                                        </a>
                                      </Button>
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-gray-600">—</span>
                                )}
                              </div>
                              <div className="order-5 flex justify-end gap-0.5 sm:justify-end">
                                {canEdit && !fromWorkReport ? (
                                  <>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => openEdit(row)}
                                      aria-label="Upravit náklad"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive"
                                      onClick={() => setDeleteTarget(row)}
                                      aria-label="Smazat náklad"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  {sortedExpenses.length > 5 ? (
                    <Button
                      type="button"
                      variant="outlineLight"
                      size="sm"
                      className={cn(
                        "font-medium text-gray-950",
                        isJobDetailWide ? "h-11 min-h-[44px] px-4 text-base" : "h-9 px-3 text-sm"
                      )}
                      onClick={() => setExpensesListExpanded((v) => !v)}
                    >
                      {expensesListExpanded ? "Zobrazit méně" : "Zobrazit více"}
                    </Button>
                  ) : null}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent
          className={cn(
            "border border-gray-400 bg-white text-gray-900 w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col gap-0 mx-auto",
            "max-w-[480px] sm:max-w-[480px]"
          )}
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-gray-900">
              {editingId ? "Upravit náklad" : "Nový náklad"}
            </DialogTitle>
            <DialogDescription className="text-base text-gray-800 dark:text-gray-200">
              Zvolte, zda zadáváte částku bez DPH nebo s DPH, sazbu DPH a částku. Volitelně připojte přílohu dokladu.
            </DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "py-2",
              isJobDetailWide ? "space-y-6" : "space-y-4"
            )}
          >
            <div className="space-y-2">
              <Label
                htmlFor="expense-amount-type"
                className="block text-sm font-medium text-gray-900"
              >
                Zadaná částka
              </Label>
              <Select
                value={amountTypeInput}
                onValueChange={(v) =>
                  setAmountTypeInput(normalizeBudgetType(v) as "net" | "gross")
                }
              >
                <SelectTrigger
                  id="expense-amount-type"
                  className={cn(
                    LIGHT_SELECT_TRIGGER_CLASS,
                    "min-h-10 h-10 text-sm bg-white text-gray-900 border-gray-400"
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                  <SelectItem value="net">Bez DPH</SelectItem>
                  <SelectItem value="gross">S DPH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="expense-vat"
                className="block text-sm font-medium text-gray-900"
              >
                Sazba DPH
              </Label>
              <Select value={vatRateInput} onValueChange={setVatRateInput}>
                <SelectTrigger
                  id="expense-vat"
                  className={cn(
                    LIGHT_SELECT_TRIGGER_CLASS,
                    "min-h-10 h-10 text-sm bg-white text-gray-900 border-gray-400"
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                  {VAT_RATE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r} % DPH
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="expense-amount"
                className="block text-sm font-medium text-gray-900"
              >
                Částka (Kč) * — {amountTypeInput === "gross" ? "s DPH" : "bez DPH"}
              </Label>
              <Input
                id="expense-amount"
                inputMode="decimal"
                placeholder={amountTypeInput === "gross" ? "např. 1 512,50" : "např. 1 250"}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className={cn(
                  LIGHT_FORM_CONTROL_CLASS,
                  "min-h-10 text-sm bg-white text-gray-900 border-gray-400"
                )}
              />
              {(() => {
                const n = parseMoneyAmountInput(amountInput.replace(/\s/g, " ").trim());
                if (n == null || n <= 0) return null;
                const rate = normalizeVatRate(Number(vatRateInput));
                const t = normalizeBudgetType(amountTypeInput);
                const { amountNet, vatAmount, amountGross } =
                  computeExpenseAmountsFromInput({
                    amountInput: roundMoney2(n),
                    amountType: t,
                    vatRate: rate,
                  });
                return (
                  <div className="rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                      Přepočet
                    </div>
                    <div className="mt-1 space-y-0.5 tabular-nums text-gray-900 dark:text-gray-100">
                      <div>Bez DPH: {formatKc(amountNet)}</div>
                      <div>
                        DPH ({rate} %): {formatKc(vatAmount)}
                      </div>
                      <div>S DPH: {formatKc(amountGross)}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="expense-date"
                className="block text-sm font-medium text-gray-900"
              >
                Datum *
              </Label>
              <Input
                id="expense-date"
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className={cn(
                  LIGHT_FORM_CONTROL_CLASS,
                  "[color-scheme:light]",
                  "min-h-10 text-sm bg-white text-gray-900 border-gray-400"
                )}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="expense-note"
                className="block text-sm font-medium text-gray-900"
              >
                Poznámka / popis
              </Label>
              <Textarea
                id="expense-note"
                rows={3}
                placeholder="Volitelný popis…"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className={cn(
                  LIGHT_FORM_CONTROL_CLASS,
                  "min-h-[96px] text-sm bg-white text-gray-900 border-gray-400"
                )}
              />
            </div>

            <div className="space-y-2">
              <Label className="block text-sm font-medium text-gray-900">
                Příloha (volitelné)
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 h-9 justify-start gap-2 border-gray-400 bg-white text-sm text-gray-900 hover:bg-gray-50"
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4 shrink-0" />
                  Fotografie nebo PDF
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 h-9 justify-start gap-2 border-gray-400 bg-white text-sm text-gray-900 hover:bg-gray-50"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4 shrink-0" />
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
                <p className={cn("break-all", EXP.bodySm)}>
                  Nový soubor:{" "}
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{pendingFile.name}</span>
                </p>
              ) : editingId ? (
                <div className="space-y-2">
                  <p className={EXP.bodySm}>
                    Příloha beze změny (vyberte soubor pro nahrazení).
                  </p>
                  {(() => {
                    const current = sortedExpenses.find((e) => e.id === editingId);
                    if (!current?.fileUrl) return null;
                    const kind = inferJobMediaItemType(current);
                    if (kind === "pdf") {
                      return (
                        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
                          <FileText className="h-6 w-6 shrink-0 text-gray-800 dark:text-gray-200" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                            {current.fileName || "PDF"}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
                            asChild
                          >
                            <a href={current.fileUrl} target="_blank" rel="noopener noreferrer">
                              Náhled
                            </a>
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <div className="mx-auto max-h-40 w-full max-w-xs overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50 sm:mx-0">
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
                <div className="mt-2 max-h-48 overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachmentPreviewUrl}
                    alt="Náhled přílohy"
                    className="max-h-48 w-full object-contain object-center"
                  />
                </div>
              ) : null}
              {pendingFile && !isAllowedJobImageFile(pendingFile) && pendingFile.type === "application/pdf" ? (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
                  <FileText className="h-8 w-8 shrink-0 text-gray-800 dark:text-gray-200" />
                  <span className="min-w-0 flex-1 break-all text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {pendingFile.name}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-full border-gray-400 bg-white text-sm text-gray-900 hover:bg-gray-50 sm:w-auto"
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
              size="sm"
              className="h-9 w-full text-sm text-white sm:w-auto"
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
        <DialogContent className="w-[95vw] max-w-md border-gray-200 bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle className="font-bold text-gray-900 dark:text-gray-100">
              Smazat náklad?
            </DialogTitle>
            <DialogDescription className="text-base text-gray-800 dark:text-gray-200">
              Tato akce je nevratná. Soubor přílohy bude také odstraněn z úložiště.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
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
