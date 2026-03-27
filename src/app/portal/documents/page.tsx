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
  Pencil,
  Link2,
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
  setDoc,
  serverTimestamp,
  deleteDoc,
  writeBatch,
  getDoc,
  updateDoc,
  type DocumentData,
  type UpdateData,
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
import {
  reconcileCompanyDocumentJobExpense,
  type CompanyDocumentExpenseReconcileBefore,
} from "@/lib/document-job-expense-sync";
import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";
import {
  inferJobMediaItemType,
  getJobMediaFileTypeFromFile,
  isAllowedJobMediaFile,
  type JobMediaFileType,
} from "@/lib/job-media-types";
import { uploadJobPhotoFileViaFirebaseSdk } from "@/lib/job-photo-upload";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import { cn } from "@/lib/utils";
import { logActivitySafe } from "@/lib/activity-log";
import {
  calculateVatAmountsFromNet,
  normalizeVatRate,
  VAT_RATE_OPTIONS,
  roundMoney2,
} from "@/lib/vat-calculations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  /** Alias k jobId pro přiřazení k zakázce. */
  zakazkaId?: string;
  number?: string;
  entityName?: string;
  /** Zobrazovaný název dokladu (preferováno před entityName). */
  nazev?: string;
  amount?: number;
  amountNet?: number;
  amountGross?: number;
  vatAmount?: number;
  vatRate?: number;
  vat?: number;
  /** Uložená částka podle režimu DPH (kompatibilní s novým modelem). */
  castka?: number;
  sDPH?: boolean;
  dphSazba?: number;
  date?: string;
  description?: string;
  note?: string | null;
  poznamka?: string | null;
  fileUrl?: string | null;
  fileType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  createdAt?: unknown;
  uploadedBy?: string;
  uploadedByName?: string;
  assignmentType?: "job_cost" | "overhead" | "pending_assignment";
  /** ID záznamu v jobs/.../expenses pro primární doklad (ne zrcadlo jobExpense_*). */
  linkedExpenseId?: string | null;
};

type AssignmentType = "job_cost" | "overhead" | "pending_assignment";

function inferSDPH(row: CompanyDocumentRow): boolean {
  if (typeof row.sDPH === "boolean") return row.sDPH;
  const va = Number(row.vatAmount ?? 0);
  const vr = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 0);
  return va > 0 || vr > 0;
}

function docDisplayTitle(row: CompanyDocumentRow): string {
  const n =
    row.nazev?.trim() ||
    row.entityName?.trim() ||
    row.number?.trim() ||
    row.fileName?.trim() ||
    "";
  return n || row.id;
}

function docVatInfoLine(row: CompanyDocumentRow): string {
  if (!inferSDPH(row)) return "bez DPH";
  const r = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
  const rate = Number.isFinite(r) ? r : 21;
  return `s DPH ${rate} %`;
}

/**
 * Zobrazení částek — respektuje vlastní sazbu DPH (např. 15 %), nejen 0/12/21.
 */
function docDisplayAmounts(row: CompanyDocumentRow): {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  label: string;
} {
  const sDPH = inferSDPH(row);
  if (!sDPH) {
    const c = roundMoney2(
      Number(
        row.castka ??
          row.amountNet ??
          row.amountGross ??
          row.amount ??
          0
      )
    );
    return {
      amountNet: c,
      vatAmount: 0,
      amountGross: c,
      label: "bez DPH",
    };
  }
  const rate = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
  let net = roundMoney2(Number(row.amountNet ?? row.amount ?? 0));
  let gross = roundMoney2(Number(row.amountGross ?? 0));
  let vat = roundMoney2(Number(row.vatAmount ?? 0));
  if (gross <= 0 && net > 0 && Number.isFinite(rate)) {
    vat = roundMoney2((net * rate) / 100);
    gross = roundMoney2(net + vat);
  } else if (net <= 0 && gross > 0 && Number.isFinite(rate) && rate > 0) {
    net = roundMoney2(gross / (1 + rate / 100));
    vat = roundMoney2(gross - net);
  } else if (vat <= 0 && net > 0 && gross > 0) {
    vat = roundMoney2(gross - net);
  }
  return {
    amountNet: net,
    vatAmount: vat,
    amountGross: gross,
    label: `s DPH ${Number.isFinite(rate) ? rate : 21} %`,
  };
}

function parseVatPercentInput(raw: string): number {
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

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

/** Stejný limit jako u nahrávání médií na kartě zakázky. */
const MAX_JOB_PHOTO_BYTES = 20 * 1024 * 1024;

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

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<CompanyDocumentRow | null>(null);
  const [editForm, setEditForm] = useState({
    nazev: "",
    castka: "",
    sDPH: true,
    dphSazba: "21",
    date: "",
    poznamka: "",
    zakazkaId: "",
    /** Když není vybraná zakázka: nezařazeno vs. režie. */
    noJobMode: "pending" as "pending" | "overhead",
  });
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocumentRow | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const financialDocuments = useMemo(
    () =>
      ((documents ?? []) as CompanyDocumentRow[]).filter(
        isFinancialCompanyDocument
      ),
    [documents]
  );

  const pendingDocs = useMemo(
    () =>
      financialDocuments
        .filter((d) => d.assignmentType === "pending_assignment")
        .sort(
          (a, b) => docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt)
        ),
    [financialDocuments]
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
    if (!companyId || !firestore || !user) return;
    setIsSubmitting(true);

    try {
      const amountStr = formData.amount.trim();
      const amountParsed =
        amountStr === "" ? NaN : Number(String(amountStr).replace(",", "."));
      const amountNet =
        Number.isFinite(amountParsed) && amountParsed >= 0
          ? Math.round(amountParsed)
          : 0;
      const hasFinancialAmount =
        amountStr !== "" && Number.isFinite(amountParsed) && amountNet > 0;

      if (!hasFinancialAmount) {
        if (!newDocFile) {
          toast({
            variant: "destructive",
            title: "Chybí částka",
            description:
              "Doklad musí obsahovat částku. Jinak nahrajte soubor a vyberte zakázku (zařazení „Zakázka → náklad“) — uloží se pouze jako fotodokumentace u zakázky, ne v dokladech.",
          });
          return;
        }
        if (assignmentType !== "job_cost" || !selectedJobId) {
          toast({
            variant: "destructive",
            title: "Pro fotodokumentaci vyberte zakázku",
            description:
              "Doklad musí obsahovat částku. Bez částky lze soubor uložit jen jako fotodokumentaci — nastavte zařazení na „Zakázka → náklad“ a vyberte zakázku.",
          });
          return;
        }
        if (!isAllowedJobMediaFile(newDocFile)) {
          toast({
            variant: "destructive",
            title: "Nepodporovaný soubor",
            description: "Použijte JPG, PNG, WEBP nebo PDF.",
          });
          return;
        }
        if (newDocFile.size > MAX_JOB_PHOTO_BYTES) {
          toast({
            variant: "destructive",
            title: "Soubor je příliš velký",
            description: `Maximální velikost je ${Math.round(MAX_JOB_PHOTO_BYTES / (1024 * 1024))} MB.`,
          });
          return;
        }

        const { resolvedFullPath, downloadURL } =
          await uploadJobPhotoFileViaFirebaseSdk(
            newDocFile,
            companyId,
            selectedJobId
          );
        const photosColRef = collection(
          firestore,
          "companies",
          companyId,
          "jobs",
          selectedJobId,
          "photos"
        );
        const photoDocRef = doc(photosColRef);
        const safeBaseName =
          newDocFile.name
            .replace(/^.*[\\/]/, "")
            .replace(/\s+/g, " ")
            .trim() || "photo";
        const fileType = getJobMediaFileTypeFromFile(newDocFile);
        const selectedJob = jobs.find((j) => j.id === selectedJobId);
        const note = formData.description.trim() || null;

        await setDoc(photoDocRef, {
          id: photoDocRef.id,
          companyId,
          jobId: selectedJobId,
          imageUrl: downloadURL,
          url: downloadURL,
          originalImageUrl: downloadURL,
          downloadURL,
          fileType,
          storagePath: resolvedFullPath,
          path: resolvedFullPath,
          fileName: safeBaseName,
          name: safeBaseName,
          note,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          uploadedBy: user.uid,
        });

        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "job.photo_from_documents_page",
          actionLabel: "Fotodokumentace z formuláře dokladů (bez částky)",
          entityType: "job_photo",
          entityId: photoDocRef.id,
          entityName: safeBaseName,
          sourceModule: "documents",
          route: "/portal/documents",
          metadata: {
            jobId: selectedJobId,
            hadNote: Boolean(note),
          },
        });

        toast({
          title: "Fotodokumentace uložena",
          description: `Soubor byl přidán k zakázce „${selectedJob?.name ?? selectedJobId}“. V seznamu dokladů se nezobrazí (bez částky).`,
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
        return;
      }

      const vatRate = normalizeVatRate(Number(formData.vat));
      const { vatAmount, amountGross } = calculateVatAmountsFromNet(
        amountNet,
        vatRate
      );

      if (!formData.number.trim()) {
        toast({
          variant: "destructive",
          title: "Vyplňte číslo dokladu",
        });
        return;
      }
      if (!formData.entityName.trim()) {
        toast({
          variant: "destructive",
          title: "Vyplňte subjekt",
        });
        return;
      }

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
        castka: amountGross,
        sDPH: true,
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
        zakazkaId:
          assignmentType === "job_cost" ? selectedJob?.id ?? selectedJobId : null,
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

      const jobIdForCost =
        assignmentType === "job_cost"
          ? selectedJob?.id ?? selectedJobId
          : null;
      await reconcileCompanyDocumentJobExpense({
        firestore,
        companyId,
        userId: user.uid,
        documentId: newDocRef.id,
        before: null,
        after: {
          assignmentType,
          jobId: jobIdForCost,
          zakazkaId: jobIdForCost,
          number: formData.number.trim(),
          entityName: formData.entityName.trim(),
          nazev: formData.entityName.trim(),
          description: formData.description.trim(),
          date: formData.date,
          castka: amountGross,
          amountNet,
          amount: amountNet,
          amountGross,
          vatAmount,
          vatRate,
          dphSazba: vatRate,
          vat: vatRate,
          sDPH: true,
          type: newDocType,
          documentKind: newDocType === "received" ? "prijate" : undefined,
          source: undefined,
          sourceType: undefined,
          fileUrl: uploadMeta?.fileUrl ?? null,
          fileName: uploadMeta?.fileName ?? null,
          fileType: uploadMeta?.fileType ?? null,
          mimeType: uploadMeta?.mimeType ?? null,
          storagePath: uploadMeta?.storagePath ?? null,
        },
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
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Nepodařilo se uložit doklad.";
      toast({
        variant: "destructive",
        title: "Chyba",
        description: msg,
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
    if (!companyId || !assigningDocId || !firestore || !user) return;
    if (assignTypeNext === "job_cost" && !assignJobIdNext) {
      toast({
        variant: "destructive",
        title: "Vyberte zakázku",
        description: "Pro zařazení do nákladů zakázky je nutné vybrat zakázku.",
      });
      return;
    }
    const selected = jobs.find((j) => j.id === assignJobIdNext);
    const jid =
      assignTypeNext === "job_cost" ? selected?.id ?? assignJobIdNext : null;
    const docRef = doc(
      firestore,
      "companies",
      companyId,
      "documents",
      assigningDocId
    );
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      toast({
        variant: "destructive",
        title: "Doklad nenalezen",
        description: "Obnovte stránku a zkuste to znovu.",
      });
      return;
    }
    const beforeRow = snap.data() as CompanyDocumentRow;
    const before: CompanyDocumentExpenseReconcileBefore = {
      ...beforeRow,
      id: assigningDocId,
    };
    await updateDoc(docRef, {
      assignmentType: assignTypeNext,
      jobId: jid,
      zakazkaId: jid,
      jobName: assignTypeNext === "job_cost" ? selected?.name ?? null : null,
      updatedAt: serverTimestamp(),
    });
    const after: CompanyDocumentExpenseReconcileBefore = {
      ...before,
      assignmentType: assignTypeNext,
      jobId: jid,
      zakazkaId: jid,
      jobName: assignTypeNext === "job_cost" ? selected?.name ?? null : null,
    };
    await reconcileCompanyDocumentJobExpense({
      firestore,
      companyId,
      userId: user.uid,
      documentId: assigningDocId,
      before,
      after,
    });
    setAssignDialogOpen(false);
    setAssigningDocId(null);
    toast({ title: "Zařazení uloženo" });
  };

  const openEditDocument = (row: CompanyDocumentRow) => {
    const sDPH = inferSDPH(row);
    const am = docDisplayAmounts(row);
    const baseAmount = sDPH ? am.amountNet : am.amountGross;
    const rate = String(
      row.dphSazba ?? row.vatRate ?? row.vat ?? 21
    );
    setEditRow(row);
    setEditForm({
      nazev: docDisplayTitle(row),
      castka: baseAmount > 0 ? String(baseAmount) : "",
      sDPH,
      dphSazba: rate,
      date: row.date ?? new Date().toISOString().split("T")[0],
      poznamka: String(row.poznamka ?? row.note ?? row.description ?? ""),
      zakazkaId: row.zakazkaId ?? row.jobId ?? "",
      noJobMode: row.assignmentType === "overhead" ? "overhead" : "pending",
    });
    setEditOpen(true);
  };

  const saveEditDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !editRow || !firestore || !user) return;
    if (!editForm.nazev.trim()) {
      toast({
        variant: "destructive",
        title: "Chybí název",
        description: "Vyplňte název dokladu.",
      });
      return;
    }
    const castkaNum = Number(String(editForm.castka).replace(",", "."));
    if (!Number.isFinite(castkaNum) || castkaNum <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatná částka",
        description: "Zadejte částku větší než 0.",
      });
      return;
    }
    const dphPct = parseVatPercentInput(editForm.dphSazba);
    setIsEditSaving(true);
    try {
      const nazev = editForm.nazev.trim();
      const poznamka = editForm.poznamka.trim();
      const zid = editForm.zakazkaId.trim();
      const selectedJob = jobs.find((j) => j.id === zid);

      const basePayload: Record<string, unknown> = {
        nazev,
        entityName: nazev,
        date: editForm.date,
        poznamka: poznamka || null,
        note: poznamka || null,
        description: poznamka || null,
        updatedAt: serverTimestamp(),
      };

      if (editForm.sDPH) {
        const net = roundMoney2(castkaNum);
        const vatAmount = roundMoney2((net * dphPct) / 100);
        const gross = roundMoney2(net + vatAmount);
        Object.assign(basePayload, {
          sDPH: true,
          dphSazba: dphPct,
          castka: gross,
          amountNet: net,
          vatAmount,
          amountGross: gross,
          amount: net,
          vatRate: dphPct,
          vat: dphPct,
        });
      } else {
        const c = roundMoney2(castkaNum);
        Object.assign(basePayload, {
          sDPH: false,
          dphSazba: null,
          castka: c,
          amountNet: c,
          amountGross: c,
          vatAmount: 0,
          vatRate: 0,
          vat: 0,
          amount: c,
        });
      }

      if (zid) {
        basePayload.zakazkaId = zid;
        basePayload.jobId = zid;
        basePayload.jobName = selectedJob?.name ?? null;
        basePayload.assignmentType = "job_cost";
      } else {
        basePayload.zakazkaId = null;
        basePayload.jobId = null;
        basePayload.jobName = null;
        basePayload.assignmentType = "pending_assignment";
      }

      await updateDoc(
        doc(firestore, "companies", companyId, "documents", editRow.id),
        basePayload as unknown as UpdateData<DocumentData>
      );
      const afterForExpense: CompanyDocumentExpenseReconcileBefore = {
        ...editRow,
        ...basePayload,
        id: editRow.id,
      };
      await reconcileCompanyDocumentJobExpense({
        firestore,
        companyId,
        userId: user.uid,
        documentId: editRow.id,
        before: { ...editRow, id: editRow.id },
        after: afterForExpense,
      });
      toast({ title: "Doklad uložen" });
      setEditOpen(false);
      setEditRow(null);
    } catch {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se uložit změny dokladu.",
      });
    } finally {
      setIsEditSaving(false);
    }
  };

  const requestDeleteDocument = (row: CompanyDocumentRow) => {
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const performDeleteDocument = async () => {
    const row = deleteTarget;
    if (!row) return;
    if (!companyId) return;

    setIsDeleting(true);
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

      const linkedJobId =
        row.zakazkaId?.trim() || row.jobId?.trim() || "";
      if (
        row.linkedExpenseId?.trim() &&
        linkedJobId &&
        !isExpenseLinked
      ) {
        const batch = writeBatch(firestore);
        batch.delete(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            linkedJobId,
            "expenses",
            row.linkedExpenseId.trim()
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
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "document.delete",
          actionLabel: "Smazání dokladu s nákladem zakázky",
          entityType: "company_document",
          entityId: row.id,
          entityName: row.number || row.entityName || row.id,
          sourceModule: "documents",
          route: "/portal/documents",
          metadata: {
            jobId: linkedJobId,
            linkedExpenseId: row.linkedExpenseId.trim(),
          },
        });
        toast({
          title: "Doklad odstraněn",
          description: "Záznam byl odebrán z dokladů i z nákladů zakázky.",
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
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const receivedDocsBase = useMemo(() => {
    return financialDocuments.filter((d) => isReceivedDoc(d));
  }, [financialDocuments]);

  const issuedDocs = useMemo(() => {
    const base = financialDocuments.filter(
      (d) => d.type === "issued"
    );
    const q = issuedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) => {
      const hay = [d.number, d.entityName, d.nazev, d.description, d.note, d.poznamka]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [financialDocuments, issuedSearch]);

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
            Přehled finančních dokladů (s částkou větší než 0). Fotodokumentace bez částky najdete u
            zakázky v médiích; při nahrání odsud bez částky se soubor uloží jen k zakázce, ne do tohoto
            seznamu.
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
                      min={0}
                      step="1"
                      placeholder="0 = jen fotodokumentace (u zakázky)"
                      value={formData.amount}
                      onChange={(e) =>
                        setFormData({ ...formData, amount: e.target.value })
                      }
                      className="bg-background"
                    />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Bez částky se neuloží jako doklad. S výběrem zakázky (náklad) se soubor uloží jen
                      jako fotodokumentace u zakázky — v tomto seznamu dokladů se neobjeví.
                    </p>
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
            onDelete={requestDeleteDocument}
            onEdit={openEditDocument}
            onAssign={openAssignDialog}
            search={receivedSearch}
            onSearchChange={setReceivedSearch}
          />
        </TabsContent>

        <TabsContent value="issued">
          <DocumentTableIssued
            data={issuedDocs}
            isLoading={isLoading}
            onDelete={requestDeleteDocument}
            onEdit={openEditDocument}
            onAssign={openAssignDialog}
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upravit doklad</DialogTitle>
            <DialogDescription>
              Upravte název, částku, DPH, datum a přiřazení k zakázce.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEditDocument} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nazev">Název</Label>
              <Input
                id="edit-nazev"
                value={editForm.nazev}
                onChange={(e) =>
                  setEditForm({ ...editForm, nazev: e.target.value })
                }
                className="bg-background"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-castka">
                {editForm.sDPH ? "Částka bez DPH (základ)" : "Částka"}
              </Label>
              <Input
                id="edit-castka"
                type="number"
                min={0}
                step="0.01"
                required
                value={editForm.castka}
                onChange={(e) =>
                  setEditForm({ ...editForm, castka: e.target.value })
                }
                className="bg-background"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="edit-sdph" className="text-sm font-medium">
                  DPH
                </Label>
                <p className="text-xs text-muted-foreground">
                  Zapnuto: ukládá se základ, DPH a částka s DPH. Vypnuto: jen jedna
                  částka.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm text-muted-foreground">bez DPH</span>
                <Switch
                  id="edit-sdph"
                  checked={editForm.sDPH}
                  onCheckedChange={(v) => setEditForm({ ...editForm, sDPH: v })}
                />
                <span className="text-sm font-medium">s DPH</span>
              </div>
            </div>
            {editForm.sDPH ? (
              <div className="space-y-2">
                <Label htmlFor="edit-dph">Sazba DPH (%)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[21, 15, 12, 0].map((r) => (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant={
                        String(editForm.dphSazba) === String(r)
                          ? "default"
                          : "outline"
                      }
                      className="h-8 text-xs"
                      onClick={() =>
                        setEditForm({ ...editForm, dphSazba: String(r) })
                      }
                    >
                      {r} %
                    </Button>
                  ))}
                </div>
                <Input
                  id="edit-dph"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  placeholder="Vlastní sazba (např. 10)"
                  value={editForm.dphSazba}
                  onChange={(e) =>
                    setEditForm({ ...editForm, dphSazba: e.target.value })
                  }
                  className="bg-background"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="edit-date">Datum</Label>
              <Input
                id="edit-date"
                type="date"
                required
                value={editForm.date}
                onChange={(e) =>
                  setEditForm({ ...editForm, date: e.target.value })
                }
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-poznamka">Poznámka</Label>
              <Textarea
                id="edit-poznamka"
                rows={3}
                value={editForm.poznamka}
                onChange={(e) =>
                  setEditForm({ ...editForm, poznamka: e.target.value })
                }
                className="bg-background resize-y min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Zakázka</Label>
              <Select
                value={editForm.zakazkaId || "__none__"}
                onValueChange={(v) =>
                  setEditForm({
                    ...editForm,
                    zakazkaId: v === "__none__" ? "" : v,
                  })
                }
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Nepřiřazeno" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— bez zakázky —</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!editForm.zakazkaId.trim() ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <Label className="text-xs text-muted-foreground">
                    Bez zakázky
                  </Label>
                  <Select
                    value={editForm.noJobMode}
                    onValueChange={(v) =>
                      setEditForm({
                        ...editForm,
                        noJobMode: v as "pending" | "overhead",
                      })
                    }
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">
                        Musí se zařadit později
                      </SelectItem>
                      <SelectItem value="overhead">Režie</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditOpen(false);
                  setEditRow(null);
                }}
              >
                Zrušit
              </Button>
              <Button type="submit" disabled={isEditSaving}>
                {isEditSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Uložit"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat doklad?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              Opravdu chceš smazat doklad
              {deleteTarget ? (
                <span className="font-medium text-foreground">
                  {" "}
                  „{docDisplayTitle(deleteTarget)}“
                </span>
              ) : null}
              ? Tuto akci nelze vrátit zpět.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void performDeleteDocument();
              }}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Smazat"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DocumentTableReceived({
  data,
  isLoading,
  onDelete,
  onEdit,
  onAssign,
  search,
  onSearchChange,
}: {
  data: CompanyDocumentRow[];
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onEdit: (row: CompanyDocumentRow) => void;
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
          d.nazev,
          d.description,
          d.note ?? "",
          d.poznamka ?? "",
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

                  const amts = docDisplayAmounts(row);
                  const showAmount = !fromJobMedia && amts.amountNet > 0;
                  const title = docDisplayTitle(row);
                  const canEditRow = !fromJobMedia;

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
                              title={title}
                            >
                              {title}
                            </span>
                          </div>
                          {row.fileName?.trim() &&
                          row.fileName.trim() !== title.trim() ? (
                            <span className="text-xs text-muted-foreground truncate pl-6">
                              {row.fileName}
                            </span>
                          ) : null}
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
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {docVatInfoLine(row)}
                            </div>
                            <div className="text-muted-foreground">
                              {inferSDPH(row) ? (
                                <>
                                  Základ {amts.amountNet.toLocaleString("cs-CZ")} Kč
                                </>
                              ) : (
                                <>Částka {amts.amountGross.toLocaleString("cs-CZ")} Kč</>
                              )}
                            </div>
                            {inferSDPH(row) ? (
                              <>
                                <div className="text-muted-foreground text-[11px]">
                                  DPH {amts.vatAmount.toLocaleString("cs-CZ")} Kč
                                </div>
                                <div className="font-bold text-rose-600 dark:text-rose-400">
                                  Celkem {amts.amountGross.toLocaleString("cs-CZ")} Kč
                                </div>
                              </>
                            ) : null}
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
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {row.fileUrl ? (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              asChild
                              title="Otevřít přílohu"
                            >
                              <a
                                href={row.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          ) : null}
                          {row.jobId ? (
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              asChild
                              title="Otevřít zakázku"
                            >
                              <Link href={`/portal/jobs/${row.jobId}`}>
                                <Briefcase className="h-4 w-4 shrink-0" />
                              </Link>
                            </Button>
                          ) : null}
                          {canEditRow ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-muted-foreground hover:text-foreground"
                              title="Upravit"
                              onClick={() => onEdit(row)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                            title="Přiřadit k zakázce"
                            onClick={() => onAssign(row)}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                            title="Smazat"
                            onClick={() => onDelete(row)}
                          >
                            <Trash2 className="h-4 w-4 shrink-0" />
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
  onEdit,
  onAssign,
  search,
  onSearchChange,
}: {
  data: CompanyDocumentRow[];
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onEdit: (row: CompanyDocumentRow) => void;
  onAssign: (row: CompanyDocumentRow) => void;
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
                  <TableHead className="pl-6 min-w-[140px]">Doklad</TableHead>
                  <TableHead className="min-w-[120px]">Zakázka</TableHead>
                  <TableHead className="min-w-[100px]">Datum</TableHead>
                  <TableHead className="text-right min-w-[140px]">Částka / DPH</TableHead>
                  <TableHead className="pr-6 text-right min-w-[120px]">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((docRow) => {
                  const issuedAm = docDisplayAmounts(docRow);
                  const title = docDisplayTitle(docRow);
                  return (
                    <TableRow
                      key={docRow.id}
                      className="border-border hover:bg-muted/30 group"
                    >
                      <TableCell className="pl-6 font-medium">
                        <div className="flex flex-col gap-0.5 min-w-0 max-w-[16rem]">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileDown className="w-4 h-4 text-muted-foreground opacity-50 shrink-0" />
                            <span className="truncate text-sm" title={title}>
                              {title}
                            </span>
                          </div>
                          {docRow.number?.trim() && docRow.number !== title ? (
                            <span className="text-xs text-muted-foreground pl-6 truncate">
                              {docRow.number}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {docRow.jobId || docRow.zakazkaId ? (
                          <span className="font-medium block truncate max-w-[12rem]">
                            {docRow.jobName ?? "Zakázka"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {docRow.assignmentType === "overhead"
                              ? "Režie"
                              : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {docRow.date ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        <div className="space-y-0.5">
                          <div className="text-[10px] uppercase text-muted-foreground">
                            {docVatInfoLine(docRow)}
                          </div>
                          {inferSDPH(docRow) ? (
                            <>
                              <div className="text-muted-foreground">
                                Základ {issuedAm.amountNet.toLocaleString("cs-CZ")} Kč
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                DPH {issuedAm.vatAmount.toLocaleString("cs-CZ")} Kč
                              </div>
                              <div className="font-bold">
                                Celkem {issuedAm.amountGross.toLocaleString("cs-CZ")} Kč
                              </div>
                            </>
                          ) : (
                            <div className="font-bold">
                              {issuedAm.amountGross.toLocaleString("cs-CZ")} Kč
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                            title="Upravit"
                            onClick={() => onEdit(docRow)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                            title="Přiřadit k zakázce"
                            onClick={() => onAssign(docRow)}
                          >
                            <Link2 className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(docRow)}
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                            aria-label="Smazat doklad"
                            title="Smazat"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
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
