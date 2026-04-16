"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
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
  ReceiptText,
  Printer,
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
  arrayRemove,
  arrayUnion,
  setDoc,
  serverTimestamp,
  deleteField,
  getDoc,
  query,
  updateDoc,
  where,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
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
import { reconcileCompanyDocumentJobIncome } from "@/lib/document-job-income-sync";
import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";
import {
  inferJobMediaItemType,
  getJobMediaFileTypeFromFile,
  isAllowedJobMediaFile,
  type JobMediaFileType,
} from "@/lib/job-media-types";
import { uploadJobPhotoFileViaFirebaseSdk } from "@/lib/job-photo-upload";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  companyDocumentMatchesAssignedJobFilter,
  companyDocumentMatchesUnassignedJobFilter,
  documentJobLinkId,
  documentShowsAsPendingAssignment,
  effectiveCompanyDocumentAssignmentTypeForForm,
  resolveDocumentAssignmentBadge,
} from "@/lib/company-document-assignment";
import {
  compareDocumentsForPaymentQueue,
  documentGrossForPayment,
  getDocumentPaymentUrgency,
  isDocumentEligibleForPaymentBox,
  type CompanyDocumentPaymentRow,
  urgencyLabel,
} from "@/lib/company-document-payment";
import { cn } from "@/lib/utils";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { logActivitySafe } from "@/lib/activity-log";
import {
  calculateVatAmountsFromNet,
  normalizeVatRate,
  VAT_RATE_OPTIONS,
  roundMoney2,
} from "@/lib/vat-calculations";
import {
  amountsToCzk,
  grossOriginal,
} from "@/lib/company-document-czk";
import { resolveEurCzkRate } from "@/lib/exchange-rate-eur-czk";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import { PORTAL_MANUAL_INVOICE_TYPE } from "@/lib/portal-manual-invoice";
import { printInvoiceHtmlDocument } from "@/lib/print-html";
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
  documentType?: "invoice" | "document" | "delivery_note";
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
  /** Měna vstupu (původní částky v `castka` / `amountNet` / …). */
  currency?: "CZK" | "EUR";
  /** Hrubá částka v původní měně (stejná soustava jako `castka`). */
  amountOriginal?: number;
  /** Kurz CZK za 1 EUR v okamžiku uložení (u CZK obvykle nevyplněno). */
  exchangeRate?: number;
  /** Hrubá částka v CZK (shodně s `castkaCZK` / `amountGrossCZK`). */
  amountCZK?: number;
  castkaCZK?: number;
  amountNetCZK?: number;
  amountGrossCZK?: number;
  vatAmountCZK?: number;
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
  assignmentType?: AssignmentType;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  assignedTo?: {
    jobId?: string | null;
    companyId?: string | null;
    warehouseId?: string | null;
  } | null;
  /** ID záznamu v jobs/.../expenses pro primární doklad (ne zrcadlo jobExpense_*). */
  linkedExpenseId?: string | null;
  /** ID záznamu v jobs/.../incomes odpovídá ID dokladu (vydaný příjem k zakázce). */
  linkedIncomeId?: string | null;
  /** Doklad má být uhrazen (přehled Nutno uhradit). */
  requiresPayment?: boolean;
  /** Splatnost (YYYY-MM-DD). */
  dueDate?: string | null;
  paid?: boolean;
  paidAt?: unknown;
  paidBy?: string | null;
  /** Měkké smazání — doklad zůstává ve Firestore. */
  isDeleted?: boolean;
  /** Volitelné — klasifikace / fronta nezařazených (když existuje v datech). */
  unassigned?: boolean | null;
  classificationStatus?: string | null;
};

type AssignmentType =
  | "job_cost"
  | "company"
  | "warehouse"
  | "overhead"
  | "pending_assignment";

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

function formatDocMoney(n: number, currency: "CZK" | "EUR"): string {
  const s = roundMoney2(n).toLocaleString("cs-CZ");
  return currency === "EUR" ? `${s} €` : `${s} Kč`;
}

function invoiceDocTypeLabel(inv: Record<string, unknown>): string {
  const t = String(inv.type ?? "");
  if (t === JOB_INVOICE_TYPES.ADVANCE) return "Zálohová faktura";
  if (t === JOB_INVOICE_TYPES.TAX_RECEIPT) return "Daňový doklad (platba)";
  if (t === JOB_INVOICE_TYPES.FINAL_INVOICE) return "Vyúčtovací faktura";
  if (t === PORTAL_MANUAL_INVOICE_TYPE) return "Faktura (portál)";
  return "Faktura";
}

function openInvoicePrintFromRow(
  inv: Record<string, unknown>,
  toast: (o: {
    variant?: "destructive";
    title: string;
    description: string;
  }) => void
) {
  const html = inv.pdfHtml;
  if (typeof html !== "string" || !html.trim()) {
    toast({
      variant: "destructive",
      title: "Nelze tisknout",
      description: "U dokladu není uložený náhled (pdfHtml).",
    });
    return;
  }
  const title = String(inv.invoiceNumber || inv.documentNumber || "Doklad");
  const r = printInvoiceHtmlDocument(html, title);
  if (r === "blocked") {
    toast({
      variant: "destructive",
      title: "Tisk byl zablokován",
      description: "Povolte vyskakovací okna pro tento web.",
    });
  }
}

/**
 * Zobrazení částek — respektuje vlastní sazbu DPH (např. 15 %), nejen 0/12/21.
 * U EUR dokladů jsou `amountNet` / `castka` v eurech; `amountGrossCZK` je přepočet.
 */
function docDisplayAmounts(row: CompanyDocumentRow): {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  label: string;
  currency: "CZK" | "EUR";
  amountGrossCZK: number;
  showCzkHint: boolean;
} {
  const currency: "CZK" | "EUR" = row.currency === "EUR" ? "EUR" : "CZK";
  const czkStored = roundMoney2(
    Number(row.castkaCZK ?? row.amountGrossCZK ?? row.amountCZK ?? 0)
  );

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
    const grossCzk = czkStored > 0 ? czkStored : c;
    return {
      amountNet: c,
      vatAmount: 0,
      amountGross: c,
      label: "bez DPH",
      currency,
      amountGrossCZK: grossCzk,
      showCzkHint: currency === "EUR" && czkStored > 0,
    };
  }
  const rate = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
  let net = roundMoney2(Number(row.amountNet ?? row.amount ?? 0));
  let gross = roundMoney2(Number(row.amountGross ?? 0));
  let vat = roundMoney2(Number(row.vatAmount ?? 0));
  const castkaGross = roundMoney2(Number(row.castka ?? 0));
  if (gross <= 0 && castkaGross > 0) gross = castkaGross;
  if (gross <= 0 && net > 0 && Number.isFinite(rate)) {
    vat = roundMoney2((net * rate) / 100);
    gross = roundMoney2(net + vat);
  } else if (net <= 0 && gross > 0 && Number.isFinite(rate) && rate > 0) {
    net = roundMoney2(gross / (1 + rate / 100));
    vat = roundMoney2(gross - net);
  } else if (vat <= 0 && net > 0 && gross > 0) {
    vat = roundMoney2(gross - net);
  }
  const grossCzk = czkStored > 0 ? czkStored : gross;
  return {
    amountNet: net,
    vatAmount: vat,
    amountGross: gross,
    label: `s DPH ${Number.isFinite(rate) ? rate : 21} %`,
    currency,
    amountGrossCZK: grossCzk,
    showCzkHint: currency === "EUR" && czkStored > 0,
  };
}

function parseVatPercentInput(raw: string): number {
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

function isReceivedDoc(d: CompanyDocumentRow) {
  if (d.documentType === "delivery_note") return true;
  return (
    d.type === "received" ||
    d.documentKind === "prijate" ||
    (d.type !== "issued" &&
      d.type !== "vydane" &&
      d.documentKind !== "vydane")
  );
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

function isDeliveryNote(row: CompanyDocumentRow): boolean {
  return (
    row.documentType === "delivery_note" ||
    row.type === "delivery_note" ||
    row.documentKind === "delivery_note"
  );
}

/** Stejný limit jako u nahrávání médií na kartě zakázky. */
const MAX_JOB_PHOTO_BYTES = 20 * 1024 * 1024;

function DocumentsPageContent() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const documentsMainTab =
    viewParam === "issued" ||
    viewParam === "all" ||
    viewParam === "received" ||
    viewParam === "trash"
      ? viewParam
      : "received";
  const setDocumentsMainTab = (v: string) => {
    router.replace(`/portal/documents?view=${v}`, { scroll: false });
  };

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
  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "invoices");
  }, [firestore, companyId]);
  const { data: invoicesRaw, isLoading: isInvoicesLoading } =
    useCollection(invoicesQuery);
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
  const [newDocKind, setNewDocKind] = useState<"document" | "delivery_note">(
    "document"
  );
  const [newDocType, setNewDocType] = useState<"received" | "issued">("received");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [assignmentType, setAssignmentType] =
    useState<AssignmentType>("pending_assignment");
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
  const [formData, setFormData] = useState({
    number: "",
    entityName: "",
    amount: "",
    currency: "CZK" as "CZK" | "EUR",
    vat: "21",
    date: new Date().toISOString().split("T")[0],
    description: "",
    requiresPayment: false,
    dueDate: "",
  });

  const todayIso = useMemo(
    () => new Date().toISOString().split("T")[0],
    []
  );

  const [receivedSearch, setReceivedSearch] = useState("");
  const [issuedSearch, setIssuedSearch] = useState("");
  const [assigningDocId, setAssigningDocId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTypeNext, setAssignTypeNext] =
    useState<AssignmentType>("pending_assignment");
  const [assignJobIdNext, setAssignJobIdNext] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<CompanyDocumentRow | null>(null);
  const [editInvoiceId, setEditInvoiceId] = useState<string>("");
  const [editAssignmentType, setEditAssignmentType] =
    useState<AssignmentType>("pending_assignment");
  const [editWarehouseId, setEditWarehouseId] = useState<string>("");
  const [editSupplier, setEditSupplier] = useState<string>("");
  const [editForm, setEditForm] = useState({
    nazev: "",
    castka: "",
    currency: "CZK" as "CZK" | "EUR",
    sDPH: true,
    dphSazba: "21",
    date: "",
    poznamka: "",
    zakazkaId: "",
    /** Když není vybraná zakázka: nezařazeno vs. režie. */
    noJobMode: "pending" as "pending" | "overhead",
    requiresPayment: false,
    dueDate: "",
  });
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocumentRow | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteInvoiceOpen, setDeleteInvoiceOpen] = useState(false);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState(false);

  const canSoftDelete = useMemo(() => {
    const r = String((profile as { role?: string })?.role ?? "");
    const gr = (profile as { globalRoles?: string[] })?.globalRoles;
    return (
      r === "owner" ||
      r === "admin" ||
      (Array.isArray(gr) && gr.includes("super_admin"))
    );
  }, [profile]);

  useEffect(() => {
    if (isProfileLoading) return;
    if (viewParam === "trash" && !canSoftDelete) {
      router.replace("/portal/documents?view=received", { scroll: false });
    }
  }, [viewParam, canSoftDelete, isProfileLoading, router]);

  const financialDocumentsActive = useMemo(
    () =>
      ((documents ?? []) as CompanyDocumentRow[]).filter(
        (d) =>
          (isFinancialCompanyDocument(d) || isDeliveryNote(d)) &&
          isActiveFirestoreDoc(d)
      ),
    [documents]
  );

  const financialDocumentsDeleted = useMemo(
    () =>
      ((documents ?? []) as CompanyDocumentRow[]).filter(
        (d) =>
          (isFinancialCompanyDocument(d) || isDeliveryNote(d)) &&
          d.isDeleted === true
      ),
    [documents]
  );

  const financialDocuments =
    documentsMainTab === "trash"
      ? financialDocumentsDeleted
      : financialDocumentsActive;

  const invoicesActiveList = useMemo(() => {
    const raw = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    return raw.filter((inv) =>
      isActiveFirestoreDoc(inv as { isDeleted?: unknown })
    );
  }, [invoicesRaw]);

  const invoicesDeletedList = useMemo(() => {
    const raw = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    return raw.filter(
      (inv) => (inv as { isDeleted?: unknown }).isDeleted === true
    );
  }, [invoicesRaw]);

  const invoicesForCurrentView =
    documentsMainTab === "trash" ? invoicesDeletedList : invoicesActiveList;
  const invoiceSelectOptions = useMemo(() => {
    const raw = Array.isArray(invoicesActiveList) ? invoicesActiveList : [];
    return raw.map((inv) => {
      const id = String((inv as { id?: string }).id ?? "");
      const label = String(
        (inv as { invoiceNumber?: string; documentNumber?: string }).invoiceNumber ??
          (inv as { documentNumber?: string }).documentNumber ??
          id
      ).trim();
      return { id, label: label || id };
    });
  }, [invoicesActiveList]);

  const pendingDocs = useMemo(
    () =>
      financialDocumentsActive
        .filter((d) => documentShowsAsPendingAssignment(d))
        .sort(
          (a, b) => docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt)
        ),
    [financialDocumentsActive]
  );

  const paymentOverviewStats = useMemo(() => {
    const list = financialDocumentsActive as CompanyDocumentPaymentRow[];
    let toPay = 0;
    let overdue = 0;
    let totalKc = 0;
    for (const d of list) {
      if (!isDocumentEligibleForPaymentBox(d)) continue;
      toPay += 1;
      totalKc += documentGrossForPayment(d);
      if (getDocumentPaymentUrgency(d, todayIso) === "overdue") overdue += 1;
    }
    const invList = invoicesActiveList;
    for (const raw of invList) {
      const inv = raw as Record<string, unknown>;
      if (inv.status === "paid") continue;
      const gross = Number(inv.amountGross ?? inv.totalAmount ?? 0);
      if (!Number.isFinite(gross) || gross <= 0) continue;
      toPay += 1;
      totalKc += roundMoney2(gross);
      const due = String(inv.dueDate ?? "").trim();
      if (due && due < todayIso) overdue += 1;
    }
    return { toPay, overdue, totalKc };
  }, [financialDocumentsActive, invoicesActiveList, todayIso]);

  const markDocumentPaid = async (row: CompanyDocumentRow) => {
    if (!companyId || !firestore || !user) return;
    await updateDoc(doc(firestore, "companies", companyId, "documents", row.id), {
      paid: true,
      paidAt: serverTimestamp(),
      paidBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    try {
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: row.id,
        before: { ...row, id: row.id },
        after: { ...row, id: row.id, paid: true },
      });
    } catch (e) {
      console.error("documents: job income reconcile after paid", e);
    }
    toast({ title: "Označeno jako zaplaceno" });
  };

  const markDocumentUnpaid = async (row: CompanyDocumentRow) => {
    if (!companyId || !firestore || !user) return;
    await updateDoc(doc(firestore, "companies", companyId, "documents", row.id), {
      paid: false,
      paidAt: deleteField(),
      paidBy: deleteField(),
      updatedAt: serverTimestamp(),
    });
    try {
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: row.id,
        before: { ...row, id: row.id },
        after: { ...row, id: row.id, paid: false },
      });
    } catch (e) {
      console.error("documents: job income reconcile after unpaid", e);
    }
    toast({ title: "Platba zrušena" });
  };

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

  const syncDeliveryNoteInvoiceLink = async (params: {
    documentId: string;
    prevInvoiceId?: string | null;
    nextInvoiceId?: string | null;
  }) => {
    if (!firestore || !companyId) return;
    const prev = String(params.prevInvoiceId ?? "").trim();
    const next = String(params.nextInvoiceId ?? "").trim();
    if (prev && prev !== next) {
      await updateDoc(doc(firestore, "companies", companyId, "invoices", prev), {
        deliveryNoteIds: arrayRemove(params.documentId),
        updatedAt: serverTimestamp(),
      });
    }
    if (next) {
      await updateDoc(doc(firestore, "companies", companyId, "invoices", next), {
        deliveryNoteIds: arrayUnion(params.documentId),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !firestore || !user) return;
    setIsSubmitting(true);

    try {
      const amountStr = formData.amount.trim();
      const amountParsed =
        amountStr === "" ? NaN : Number(String(amountStr).replace(",", "."));
      const docCurrency = formData.currency === "EUR" ? "EUR" : "CZK";
      const amountNetRaw =
        Number.isFinite(amountParsed) && amountParsed >= 0
          ? roundMoney2(amountParsed)
          : 0;
      const hasFinancialAmount =
        amountStr !== "" &&
        Number.isFinite(amountParsed) &&
        amountNetRaw > 0;

      if (newDocKind === "delivery_note") {
        if (!formData.number.trim()) {
          toast({ variant: "destructive", title: "Vyplňte číslo dokladu" });
          return;
        }
        if (!formData.entityName.trim()) {
          toast({ variant: "destructive", title: "Vyplňte dodavatele" });
          return;
        }
        const uploadMeta = newDocFile ? await uploadDocumentFile(newDocFile) : null;
        const selectedJob = jobs.find((j) => j.id === selectedJobId);
        const assignmentFinal: AssignmentType =
          assignmentType === "job_cost" ||
          assignmentType === "warehouse" ||
          assignmentType === "company" ||
          assignmentType === "pending_assignment"
            ? assignmentType
            : "pending_assignment";
        const invoiceId = selectedInvoiceId.trim() || null;
        const newDocRef = await addDoc(
          collection(firestore, "companies", companyId, "documents"),
          {
            documentType: "delivery_note",
            type: "delivery_note",
            documentKind: "delivery_note",
            number: formData.number.trim(),
            documentNumber: formData.number.trim(),
            entityName: formData.entityName.trim(),
            supplier: formData.entityName.trim(),
            date: formData.date?.trim() || null,
            note: formData.description.trim() || null,
            description: formData.description.trim() || null,
            assignmentType: assignmentFinal,
            jobId: assignmentFinal === "job_cost" ? selectedJobId || null : null,
            zakazkaId: assignmentFinal === "job_cost" ? selectedJobId || null : null,
            jobName: assignmentFinal === "job_cost" ? selectedJob?.name ?? null : null,
            assignedTo: {
              jobId: assignmentFinal === "job_cost" ? selectedJobId || null : null,
              companyId: assignmentFinal === "company" ? companyId : null,
              warehouseId:
                assignmentFinal === "warehouse" ? selectedWarehouseId || "main" : null,
            },
            invoiceId,
            fileUrl: uploadMeta?.fileUrl ?? null,
            fileName: uploadMeta?.fileName ?? null,
            fileType: uploadMeta?.fileType ?? null,
            mimeType: uploadMeta?.mimeType ?? null,
            storagePath: uploadMeta?.storagePath ?? null,
            organizationId: companyId,
            createdBy: user.uid,
            uploadedBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            isDeleted: false,
          }
        );
        if (invoiceId) {
          await syncDeliveryNoteInvoiceLink({
            documentId: newDocRef.id,
            nextInvoiceId: invoiceId,
          });
        }
        void sendModuleEmailNotificationFromBrowser({
          companyId: companyId!,
          module: "documents",
          eventKey: "newDocument",
          entityId: newDocRef.id,
          title: `Nový doklad: ${formData.number.trim()}`,
          lines: [
            `Dodavatel: ${formData.entityName.trim()}`,
            assignmentFinal === "pending_assignment" ? "Zařazení: čeká na přiřazení" : "",
          ].filter(Boolean),
          actionPath: `/portal/documents`,
        });
        if (assignmentFinal === "pending_assignment") {
          void sendModuleEmailNotificationFromBrowser({
            companyId: companyId!,
            module: "documents",
            eventKey: "pendingAssignment",
            entityId: newDocRef.id,
            title: `Doklad k zařazení: ${formData.number.trim()}`,
            lines: [formData.entityName.trim()],
            actionPath: `/portal/documents`,
          });
        }
        toast({ title: "Dodací list uložen" });
        setIsAddDocOpen(false);
        setNewDocKind("document");
        setFormData({
          number: "",
          entityName: "",
          amount: "",
          currency: "CZK",
          vat: "21",
          date: new Date().toISOString().split("T")[0],
          description: "",
          requiresPayment: false,
          dueDate: "",
        });
        setNewDocFile(null);
        setAssignmentType("pending_assignment");
        setSelectedJobId("");
        setSelectedInvoiceId("");
        setSelectedWarehouseId("");
        return;
      }

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
        currency: "CZK",
        vat: "21",
        date: new Date().toISOString().split("T")[0],
        description: "",
        requiresPayment: false,
        dueDate: "",
      });
        setNewDocFile(null);
        setAssignmentType("pending_assignment");
        setSelectedJobId("");
        setSelectedInvoiceId("");
        setSelectedWarehouseId("");
        return;
      }

      const vatRate = normalizeVatRate(Number(formData.vat));
      let amountNet: number;
      let vatAmount: number;
      let amountGross: number;
      if (docCurrency === "EUR") {
        amountNet = amountNetRaw;
        vatAmount = roundMoney2((amountNet * vatRate) / 100);
        amountGross = roundMoney2(amountNet + vatAmount);
      } else {
        const netInt = Math.round(amountNetRaw);
        const c = calculateVatAmountsFromNet(netInt, vatRate);
        amountNet = netInt;
        vatAmount = c.vatAmount;
        amountGross = c.amountGross;
      }

      let rateEurCzk = 1;
      let rateUsedFallback = false;
      if (docCurrency === "EUR") {
        const r = await resolveEurCzkRate();
        rateEurCzk = r.rate;
        rateUsedFallback = r.usedFallback;
      }
      const czk = amountsToCzk(docCurrency, rateEurCzk, {
        amountNet,
        vatAmount,
        amountGross,
      });
      const amountOriginal = grossOriginal({
        amountNet,
        vatAmount,
        amountGross,
      });

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
      if (formData.requiresPayment && !formData.dueDate.trim()) {
        toast({
          title: "Upozornění: chybí splatnost",
          description:
            "Doklad je označený k úhradě, ale nemáte vyplněné datum splatnosti. Doplňte ho v přehledu úhrad nebo upravte doklad.",
        });
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
        documentKind: newDocType === "received" ? "prijate" : "vydane",
        currency: docCurrency,
        amountOriginal,
        amountCZK: czk.castkaCZK,
        exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
        amount: amountNet,
        amountNet,
        castka: amountGross,
        castkaCZK: czk.castkaCZK,
        amountNetCZK: czk.amountNetCZK,
        amountGrossCZK: czk.amountGrossCZK,
        vatAmountCZK: czk.vatAmountCZK,
        sDPH: true,
        vatRate,
        dphSazba: vatRate,
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
        requiresPayment: formData.requiresPayment,
        dueDate: formData.dueDate.trim() || null,
        paid: false,
        isDeleted: false,
      });

      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.create",
        actionLabel:
          newDocType === "received" ? "Nový přijatý doklad" : "Nový vydaný doklad",
        entityType: "company_document",
        entityId: newDocRef.id,
        entityName: formData.number?.trim() || newDocRef.id,
        details: `${formData.entityName?.trim() || "—"} · ${amountNet} ${docCurrency === "EUR" ? "EUR" : "Kč"} bez DPH / ${amountGross} ${docCurrency === "EUR" ? "EUR" : "Kč"} s DPH (≈ ${czk.castkaCZK} Kč)`,
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

      /**
       * Náklady zakázky musí vzniknout vždy, i když zápis do `finance` selže (jiná pravidla / chybějící kolekce).
       * Dříve při výjimce z `addDoc(finance)` vůbec neproběhl reconcile → doklad bez nákladu v zakázce.
       */
      const jobIdForCost =
        assignmentType === "job_cost"
          ? selectedJob?.id ?? selectedJobId
          : null;
      const afterReconcile: CompanyDocumentExpenseReconcileBefore = {
        assignmentType,
        jobId: jobIdForCost,
        zakazkaId: jobIdForCost,
        number: formData.number.trim(),
        entityName: formData.entityName.trim(),
        nazev: formData.entityName.trim(),
        description: formData.description.trim(),
        date: formData.date,
        currency: docCurrency,
        amountOriginal,
        amountCZK: czk.castkaCZK,
        exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
        castka: amountGross,
        castkaCZK: czk.castkaCZK,
        amountNetCZK: czk.amountNetCZK,
        amountGrossCZK: czk.amountGrossCZK,
        vatAmountCZK: czk.vatAmountCZK,
        amountNet,
        amount: amountNet,
        amountGross,
        vatAmount,
        vatRate,
        dphSazba: vatRate,
        vat: vatRate,
        sDPH: true,
        type: newDocType,
        documentKind: newDocType === "received" ? "prijate" : "vydane",
        source: undefined,
        sourceType: undefined,
        fileUrl: uploadMeta?.fileUrl ?? null,
        fileName: uploadMeta?.fileName ?? null,
        fileType: uploadMeta?.fileType ?? null,
        mimeType: uploadMeta?.mimeType ?? null,
        storagePath: uploadMeta?.storagePath ?? null,
        requiresPayment: formData.requiresPayment,
        paid: false,
      };
      await reconcileCompanyDocumentJobExpense({
        firestore,
        companyId,
        userId: user.uid,
        documentId: newDocRef.id,
        before: null,
        after: afterReconcile,
      });
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: newDocRef.id,
        before: null,
        after: afterReconcile,
      });

      const financeRef = collection(firestore, "companies", companyId, "finance");
      try {
        await addDoc(financeRef, {
          amount: czk.castkaCZK,
          amountNet: czk.amountNetCZK,
          amountGross: czk.amountGrossCZK,
          vatRate,
          type: newDocType === "received" ? "expense" : "revenue",
          date: formData.date,
          description: `Doklad ${formData.number}: ${formData.description}`,
          createdAt: serverTimestamp(),
        });
      } catch (financeErr) {
        console.error("documents: finance ledger write failed", financeErr);
      }

      void sendModuleEmailNotificationFromBrowser({
        companyId: companyId!,
        module: "documents",
        eventKey: "newDocument",
        entityId: newDocRef.id,
        title: `Nový doklad: ${formData.number.trim()}`,
        lines: [
          newDocType === "received" ? "Přijatý doklad" : "Vydaný doklad",
          `Subjekt: ${formData.entityName.trim()}`,
          assignmentType === "pending_assignment" ? "Zařazení: čeká na přiřazení" : "",
        ].filter(Boolean),
        actionPath: `/portal/documents`,
      });
      if (assignmentType === "pending_assignment") {
        void sendModuleEmailNotificationFromBrowser({
          companyId: companyId!,
          module: "documents",
          eventKey: "pendingAssignment",
          entityId: newDocRef.id,
          title: `Doklad k zařazení: ${formData.number.trim()}`,
          lines: [formData.entityName.trim()],
          actionPath: `/portal/documents`,
        });
      }

      toast({
        title: "Doklad uložen",
        description:
          docCurrency === "EUR" && rateUsedFallback
            ? `Záznam ${formData.number} byl přidán. Kurz EUR použit z poslední známé hodnoty nebo výchozího přepočtu (API nedostupné).`
            : `Záznam ${formData.number} byl úspěšně přidán.`,
        variant: docCurrency === "EUR" && rateUsedFallback ? "default" : undefined,
      });
      setIsAddDocOpen(false);
      setFormData({
        number: "",
        entityName: "",
        amount: "",
        currency: "CZK",
        vat: "21",
        date: new Date().toISOString().split("T")[0],
        description: "",
        requiresPayment: false,
        dueDate: "",
      });
      setNewDocFile(null);
      setAssignmentType("pending_assignment");
      setSelectedJobId("");
      setSelectedInvoiceId("");
      setSelectedWarehouseId("");
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
    setAssignTypeNext(effectiveCompanyDocumentAssignmentTypeForForm(row));
    setAssignJobIdNext(documentJobLinkId(row));
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
    try {
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
      const isDl = isDeliveryNote(beforeRow);
      const before: CompanyDocumentExpenseReconcileBefore = {
        ...beforeRow,
        id: assigningDocId,
      };
      await updateDoc(docRef, {
        assignmentType: assignTypeNext,
        jobId: jid,
        zakazkaId: jid,
        jobName: assignTypeNext === "job_cost" ? selected?.name ?? null : null,
        assignedTo: {
          jobId: assignTypeNext === "job_cost" ? jid : null,
          companyId: assignTypeNext === "company" ? companyId : null,
          warehouseId: assignTypeNext === "warehouse" ? "main" : null,
        },
        updatedAt: serverTimestamp(),
      });
      if (
        documentShowsAsPendingAssignment(beforeRow) &&
        assignTypeNext !== "pending_assignment"
      ) {
        const docTitle =
          beforeRow.number?.trim() ||
          beforeRow.entityName?.trim() ||
          assigningDocId;
        let placementLine = "";
        if (assignTypeNext === "job_cost") {
          placementLine = `Zařazeno do nákladů zakázky: ${selected?.name?.trim() || jid || "—"}`;
        } else if (assignTypeNext === "warehouse") {
          placementLine = "Zařazeno ke skladu";
        } else if (assignTypeNext === "company" || assignTypeNext === "overhead") {
          placementLine = "Zařazeno jako režie firmy";
        }
        void sendModuleEmailNotificationFromBrowser({
          companyId: companyId!,
          module: "documents",
          eventKey: "updated",
          entityId: assigningDocId,
          title: `Doklad zařazen: ${docTitle}`,
          lines: [placementLine].filter(Boolean),
          actionPath: `/portal/documents`,
        });
      }
      if (isDl) {
        setAssignDialogOpen(false);
        setAssigningDocId(null);
        toast({ title: "Zařazení uloženo" });
        return;
      }
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
      await reconcileCompanyDocumentJobIncome({
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
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Zařazení se nepovedlo",
        description:
          e instanceof Error
            ? e.message
            : "Zkontrolujte oprávnění a data dokladu (částka, typ přijatého dokladu).",
      });
    }
  };

  const openEditDocument = (row: CompanyDocumentRow) => {
    if (isDeliveryNote(row)) {
      setEditInvoiceId(String(row.invoiceId ?? "").trim());
      {
        let at = effectiveCompanyDocumentAssignmentTypeForForm(row);
        if (at === "overhead") at = "company";
        setEditAssignmentType(
          at === "job_cost" ||
            at === "company" ||
            at === "warehouse" ||
            at === "pending_assignment"
            ? at
            : "pending_assignment"
        );
      }
      setEditWarehouseId(String(row.assignedTo?.warehouseId ?? "").trim());
      setEditSupplier(String((row as { supplier?: string }).supplier ?? row.entityName ?? ""));
      setEditRow(row);
      setEditForm({
        nazev: row.number?.trim() || docDisplayTitle(row),
        castka: "",
        currency: "CZK",
        sDPH: false,
        dphSazba: "0",
        date: row.date ?? "",
        poznamka: String(row.note ?? row.description ?? ""),
        zakazkaId: row.zakazkaId ?? row.jobId ?? "",
        noJobMode:
          row.assignmentType === "warehouse"
            ? "overhead"
            : row.assignmentType === "company"
              ? "overhead"
              : "pending",
        requiresPayment: false,
        dueDate: "",
      });
      setEditOpen(true);
      return;
    }
    const sDPH = inferSDPH(row);
    const am = docDisplayAmounts(row);
    const baseAmount = sDPH ? am.amountNet : am.amountGross;
    const rate = String(
      row.dphSazba ?? row.vatRate ?? row.vat ?? 21
    );
    setEditRow(row);
    setEditInvoiceId(String(row.invoiceId ?? "").trim());
    setEditAssignmentType(effectiveCompanyDocumentAssignmentTypeForForm(row));
    setEditWarehouseId(String(row.assignedTo?.warehouseId ?? "").trim());
    setEditSupplier(String((row as { supplier?: string }).supplier ?? row.entityName ?? ""));
    setEditForm({
      nazev: docDisplayTitle(row),
      castka: baseAmount > 0 ? String(baseAmount) : "",
      currency: row.currency === "EUR" ? "EUR" : "CZK",
      sDPH,
      dphSazba: rate,
      date: row.date ?? new Date().toISOString().split("T")[0],
      poznamka: String(row.poznamka ?? row.note ?? row.description ?? ""),
      zakazkaId: row.zakazkaId ?? row.jobId ?? "",
      noJobMode: row.assignmentType === "overhead" ? "overhead" : "pending",
      requiresPayment: row.requiresPayment === true,
      dueDate: row.dueDate?.trim() ?? "",
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
    if (isDeliveryNote(editRow)) {
      setIsEditSaving(true);
      try {
        const selectedJob = jobs.find((j) => j.id === editForm.zakazkaId.trim());
        const assign =
          editAssignmentType === "job_cost" ||
          editAssignmentType === "warehouse" ||
          editAssignmentType === "company" ||
          editAssignmentType === "pending_assignment"
            ? editAssignmentType
            : "pending_assignment";
        const payload: Record<string, unknown> = {
          number: editForm.nazev.trim(),
          documentNumber: editForm.nazev.trim(),
          supplier: editSupplier.trim() || null,
          entityName: editSupplier.trim() || null,
          date: editForm.date?.trim() || null,
          note: editForm.poznamka.trim() || null,
          description: editForm.poznamka.trim() || null,
          assignmentType: assign,
          jobId: assign === "job_cost" ? editForm.zakazkaId.trim() || null : null,
          zakazkaId: assign === "job_cost" ? editForm.zakazkaId.trim() || null : null,
          jobName: assign === "job_cost" ? selectedJob?.name ?? null : null,
          assignedTo: {
            jobId: assign === "job_cost" ? editForm.zakazkaId.trim() || null : null,
            companyId: assign === "company" ? companyId : null,
            warehouseId: assign === "warehouse" ? editWarehouseId.trim() || "main" : null,
          },
          invoiceId: editInvoiceId.trim() || null,
          updatedAt: serverTimestamp(),
        };
        await updateDoc(
          doc(firestore, "companies", companyId, "documents", editRow.id),
          payload as unknown as UpdateData<DocumentData>
        );
        await syncDeliveryNoteInvoiceLink({
          documentId: editRow.id,
          prevInvoiceId: editRow.invoiceId ?? null,
          nextInvoiceId: editInvoiceId.trim() || null,
        });
        toast({ title: "Dodací list uložen" });
        setEditOpen(false);
        setEditRow(null);
      } catch {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Nepodařilo se uložit změny dodacího listu.",
        });
      } finally {
        setIsEditSaving(false);
      }
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
    const docCurrency = editForm.currency === "EUR" ? "EUR" : "CZK";
    setIsEditSaving(true);
    try {
      const nazev = editForm.nazev.trim();
      const poznamka = editForm.poznamka.trim();
      const zid = editForm.zakazkaId.trim();
      const selectedJob = jobs.find((j) => j.id === zid);

      let rateEurCzk = 1;
      let rateUsedFallback = false;
      if (docCurrency === "EUR") {
        const stored = Number(editRow.exchangeRate ?? 0);
        if (Number.isFinite(stored) && stored > 0) {
          rateEurCzk = stored;
        } else {
          const r = await resolveEurCzkRate();
          rateEurCzk = r.rate;
          rateUsedFallback = r.usedFallback;
        }
      }

      const basePayload: Record<string, unknown> = {
        nazev,
        entityName: nazev,
        date: editForm.date,
        poznamka: poznamka || null,
        note: poznamka || null,
        description: poznamka || null,
        currency: docCurrency,
        updatedAt: serverTimestamp(),
      };

      if (editForm.sDPH) {
        const net = roundMoney2(castkaNum);
        const vatAmount = roundMoney2((net * dphPct) / 100);
        const gross = roundMoney2(net + vatAmount);
        const czk = amountsToCzk(docCurrency, rateEurCzk, {
          amountNet: net,
          vatAmount,
          amountGross: gross,
        });
        const amountOriginal = grossOriginal({
          amountNet: net,
          vatAmount,
          amountGross: gross,
        });
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
          amountOriginal,
          amountCZK: czk.castkaCZK,
          exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
          castkaCZK: czk.castkaCZK,
          amountNetCZK: czk.amountNetCZK,
          amountGrossCZK: czk.amountGrossCZK,
          vatAmountCZK: czk.vatAmountCZK,
        });
      } else {
        const c = roundMoney2(castkaNum);
        const czk = amountsToCzk(docCurrency, rateEurCzk, {
          amountNet: c,
          vatAmount: 0,
          amountGross: c,
        });
        const amountOriginal = grossOriginal({
          amountNet: c,
          vatAmount: 0,
          amountGross: c,
        });
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
          amountOriginal,
          amountCZK: czk.castkaCZK,
          exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
          castkaCZK: czk.castkaCZK,
          amountNetCZK: czk.amountNetCZK,
          amountGrossCZK: czk.amountGrossCZK,
          vatAmountCZK: czk.vatAmountCZK,
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
        basePayload.assignmentType =
          editForm.noJobMode === "overhead" ? "overhead" : "pending_assignment";
      }

      basePayload.requiresPayment = editForm.requiresPayment;
      basePayload.dueDate = editForm.dueDate.trim() || null;

      if (editForm.requiresPayment && !editForm.dueDate.trim()) {
        toast({
          title: "Upozornění: chybí splatnost",
          description:
            "Doklad je označený k úhradě bez data splatnosti. Doplňte splatnost pro správné řazení a připomínky.",
        });
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
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: editRow.id,
        before: { ...editRow, id: editRow.id },
        after: afterForExpense,
      });
      toast({
        title: "Doklad uložen",
        description:
          docCurrency === "EUR" && rateUsedFallback
            ? "Kurz EUR byl doplněn z poslední známé hodnoty nebo výchozího přepočtu (API nedostupné)."
            : undefined,
      });
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
    if (!canSoftDelete) {
      toast({
        variant: "destructive",
        title: "Nedostatečné oprávnění",
        description: "Smazat doklad může pouze administrátor organizace.",
      });
      return;
    }
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const requestDeleteInvoice = (inv: Record<string, unknown> & { id: string }) => {
    if (!canSoftDelete) {
      toast({
        variant: "destructive",
        title: "Nedostatečné oprávnění",
        description: "Smazat fakturu může pouze administrátor organizace.",
      });
      return;
    }
    const label =
      String(inv.invoiceNumber ?? inv.documentNumber ?? inv.id).trim() || inv.id;
    setDeleteInvoiceTarget({ id: inv.id, label });
    setDeleteInvoiceOpen(true);
  };

  const performDeleteDocument = async () => {
    const row = deleteTarget;
    if (!row || !companyId || !firestore || !user?.uid) return;
    if (!canSoftDelete) return;

    setIsDeleting(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "documents", row.id),
        {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: serverTimestamp(),
        } as unknown as UpdateData<DocumentData>
      );
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.soft_delete",
        actionLabel: "Skrytí dokladu (koš)",
        entityType: "company_document",
        entityId: row.id,
        entityName: row.number || row.entityName || row.id,
        sourceModule: "documents",
        route: "/portal/documents",
        metadata: { docType: row.type },
      });
      toast({ title: "Doklad byl smazán" });
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const performDeleteInvoice = async () => {
    const t = deleteInvoiceTarget;
    if (!t || !companyId || !firestore || !user?.uid) return;
    if (!canSoftDelete) return;

    setIsDeletingInvoice(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "invoices", t.id),
        {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        } as unknown as UpdateData<DocumentData>
      );
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "invoice.soft_delete",
        actionLabel: "Skrytí faktury (koš)",
        entityType: "invoice",
        entityId: t.id,
        entityName: t.label,
        sourceModule: "documents",
        route: "/portal/documents",
      });
      toast({ title: "Doklad byl smazán" });
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání faktury" });
    } finally {
      setIsDeletingInvoice(false);
      setDeleteInvoiceOpen(false);
      setDeleteInvoiceTarget(null);
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

  const issuedInvoicesFiltered = useMemo(() => {
    const raw = invoicesForCurrentView as Array<
      Record<string, unknown> & { id: string }
    >;
    const q = issuedSearch.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter((inv) => {
      const hay = [
        inv.invoiceNumber,
        inv.customerName,
        inv.documentNumber,
        String(inv.jobId ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [invoicesForCurrentView, issuedSearch]);

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

  const isEditingDeliveryNote = editRow ? isDeliveryNote(editRow) : false;

  return (
    <TooltipProvider delayDuration={250}>
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl dark:text-gray-50">
            Firemní doklady
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-900 dark:text-gray-200 sm:text-[15px]">
            Přehled přijatých i vydaných dokladů a vystavených faktur (jednotná evidence). Zálohové a
            vyúčtovací faktury ze zakázek jsou ve vydaných dokladech; fotodokumentace bez částky jen u
            zakázky v médiích.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlineLight" className="h-10 gap-2" asChild>
            <Link href="/portal/invoices/new">
              <ReceiptText className="h-4 w-4 shrink-0" /> Nová faktura
            </Link>
          </Button>
          <Dialog open={isAddDocOpen} onOpenChange={setIsAddDocOpen}>
            <DialogTrigger asChild>
              <Button className="h-10 gap-2 px-4 text-sm sm:min-h-0">
                <Plus className="h-4 w-4 shrink-0" /> Přidat doklad
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[min(100%,28rem)] max-w-[28rem] overflow-y-auto border border-gray-200 bg-white p-0 text-gray-950 shadow-lg sm:rounded-xl">
              <DialogHeader className="space-y-1 border-b border-gray-100 px-4 pb-3 pt-4 sm:px-5">
                <DialogTitle className="text-lg font-semibold text-gray-950">
                  Nový obchodní doklad
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-800">
                  Zadejte údaje z faktury, dokladu nebo dodacího listu.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddDocument} className="space-y-3 px-4 py-3 sm:px-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {newDocKind === "document" ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Druh záznamu</Label>
                    <Select
                      value={newDocKind}
                      onValueChange={(v) =>
                        setNewDocKind(v === "delivery_note" ? "delivery_note" : "document")
                      }
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="document">Doklad</SelectItem>
                        <SelectItem value="delivery_note">Dodací list</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
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
                  <div className="space-y-2 sm:col-span-2">
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
                  {newDocKind === "delivery_note" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Přiřadit k faktuře (volitelné)</Label>
                      <Select value={selectedInvoiceId || "__none__"} onValueChange={(v) => setSelectedInvoiceId(v === "__none__" ? "" : v)}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Není přiřazeno k faktuře" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Není přiřazeno k faktuře</SelectItem>
                          {invoiceSelectOptions.map((inv) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
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
                  {newDocKind !== "delivery_note" ? (
                  <div className="space-y-2 sm:col-span-2">
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
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                      <div className="space-y-2">
                        <Label htmlFor="amount">Částka bez DPH</Label>
                        <Input
                          id="amount"
                          type="number"
                          min={0}
                          step={formData.currency === "EUR" ? "0.01" : "1"}
                          placeholder="0 = jen fotodokumentace (u zakázky)"
                          value={formData.amount}
                          onChange={(e) =>
                            setFormData({ ...formData, amount: e.target.value })
                          }
                          className="bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doc-currency">Měna</Label>
                        <Select
                          value={formData.currency}
                          onValueChange={(v) =>
                            setFormData({
                              ...formData,
                              currency: v === "EUR" ? "EUR" : "CZK",
                            })
                          }
                        >
                          <SelectTrigger id="doc-currency" className="bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CZK">CZK</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Bez částky se neuloží jako doklad. S výběrem zakázky (náklad) se soubor uloží jen
                      jako fotodokumentace u zakázky — v tomto seznamu dokladů se neobjeví.
                    </p>
                  </div>
                  {newDocKind !== "delivery_note" ? (
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
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
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
                  {newDocKind !== "delivery_note" ? (
                  <div className="space-y-3 sm:col-span-2 rounded-lg border border-border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <Label htmlFor="requires-payment-new" className="text-base">
                          K úhradě
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Zobrazí v přehledu Nutno uhradit na hlavní stránce (vyžaduje částku).
                        </p>
                      </div>
                      <Switch
                        id="requires-payment-new"
                        checked={formData.requiresPayment}
                        onCheckedChange={(v) =>
                          setFormData({ ...formData, requiresPayment: v })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="due-date-new">Splatnost</Label>
                      <Input
                        id="due-date-new"
                        type="date"
                        value={formData.dueDate}
                        onChange={(e) =>
                          setFormData({ ...formData, dueDate: e.target.value })
                        }
                        className="bg-background"
                      />
                    </div>
                  </div>
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
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
                        <SelectItem value="company">Firma (doklady firmy)</SelectItem>
                        <SelectItem value="warehouse">Sklad</SelectItem>
                        <SelectItem value="pending_assignment">Nezařazený (později)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assignmentType === "job_cost" ? (
                    <div className="space-y-2 sm:col-span-2">
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
                  {assignmentType === "warehouse" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Sklad</Label>
                      <Input
                        value={selectedWarehouseId}
                        onChange={(e) => setSelectedWarehouseId(e.target.value)}
                        placeholder="ID skladu (výchozí: main)"
                        className="bg-background"
                      />
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

      {paymentOverviewStats.toPay > 0 ? (
        <Card className="border-gray-300 bg-white text-gray-900 shadow-sm">
          <CardContent className="py-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Souhrn k úhradě
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              <span>
                Dokladů k úhradě:{" "}
                <strong className="tabular-nums">{paymentOverviewStats.toPay}</strong>
              </span>
              <span>
                Celkem:{" "}
                <strong className="tabular-nums">
                  {Math.round(paymentOverviewStats.totalKc).toLocaleString("cs-CZ")} Kč
                </strong>
              </span>
              {paymentOverviewStats.overdue > 0 ? (
                <span className="text-red-700">
                  Po splatnosti:{" "}
                  <strong className="tabular-nums">{paymentOverviewStats.overdue}</strong>
                </span>
              ) : (
                <span className="text-gray-600">Po splatnosti: 0</span>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs
        value={documentsMainTab}
        onValueChange={setDocumentsMainTab}
        className="w-full min-w-0"
      >
        <TabsList className="flex flex-wrap h-auto gap-1 p-1 mb-6">
          <TabsTrigger
            value="all"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <FileText className="w-4 h-4 shrink-0 text-slate-600" /> Všechny
            doklady
          </TabsTrigger>
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
          {canSoftDelete ? (
            <TabsTrigger
              value="trash"
              className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
            >
              <Trash2 className="w-4 h-4 shrink-0 text-slate-500" />
              Koš
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="all" className="space-y-10">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Přijaté doklady
            </h2>
            <DocumentTableReceived
              data={receivedDocsBase}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={receivedSearch}
              onSearchChange={setReceivedSearch}
              todayIso={todayIso}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash={false}
              showDeleteButton={canSoftDelete}
            />
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Vydané doklady a faktury
            </h2>
            <DocumentTableIssued
              data={issuedDocs}
              invoices={issuedInvoicesFiltered}
              isLoadingInvoices={isInvoicesLoading}
              jobs={jobs}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onDeleteInvoice={requestDeleteInvoice}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={issuedSearch}
              onSearchChange={setIssuedSearch}
              todayIso={todayIso}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash={false}
              showDeleteButton={canSoftDelete}
            />
          </section>
        </TabsContent>

        <TabsContent value="received">
          <DocumentTableReceived
            data={receivedDocsBase}
            isLoading={isLoading}
            onDelete={requestDeleteDocument}
            onEdit={openEditDocument}
            onAssign={openAssignDialog}
            search={receivedSearch}
            onSearchChange={setReceivedSearch}
            todayIso={todayIso}
            onMarkPaid={markDocumentPaid}
            onMarkUnpaid={markDocumentUnpaid}
            readOnlyTrash={false}
            showDeleteButton={canSoftDelete}
          />
        </TabsContent>

        <TabsContent value="issued">
          <DocumentTableIssued
            data={issuedDocs}
            invoices={issuedInvoicesFiltered}
            isLoadingInvoices={isInvoicesLoading}
            jobs={jobs}
            isLoading={isLoading}
            onDelete={requestDeleteDocument}
            onDeleteInvoice={requestDeleteInvoice}
            onEdit={openEditDocument}
            onAssign={openAssignDialog}
            search={issuedSearch}
            onSearchChange={setIssuedSearch}
            todayIso={todayIso}
            onMarkPaid={markDocumentPaid}
            onMarkUnpaid={markDocumentUnpaid}
            readOnlyTrash={false}
            showDeleteButton={canSoftDelete}
          />
        </TabsContent>

        <TabsContent value="trash" className="space-y-8">
          <Alert className="border-gray-200 bg-gray-50 text-gray-900">
            <AlertTitle>Koš</AlertTitle>
            <AlertDescription>
              Doklady a faktury zůstávají uložené ve Firestore a přílohy ve Storage; v běžných
              přehledech se už nezobrazují.
            </AlertDescription>
          </Alert>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Smazané přijaté doklady
            </h2>
            <DocumentTableReceived
              data={receivedDocsBase}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={receivedSearch}
              onSearchChange={setReceivedSearch}
              todayIso={todayIso}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash
              showDeleteButton={false}
            />
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Smazané vydané doklady a faktury
            </h2>
            <DocumentTableIssued
              data={issuedDocs}
              invoices={issuedInvoicesFiltered}
              isLoadingInvoices={isInvoicesLoading}
              jobs={jobs}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onDeleteInvoice={requestDeleteInvoice}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={issuedSearch}
              onSearchChange={setIssuedSearch}
              todayIso={todayIso}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash
              showDeleteButton={false}
            />
          </section>
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
                  <SelectItem value="company">Firma (doklady firmy)</SelectItem>
                  <SelectItem value="warehouse">Sklad</SelectItem>
                  <SelectItem value="pending_assignment">Nezařazený (později)</SelectItem>
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
              {isEditingDeliveryNote
                ? "Upravte dodací list, přiřazení a vazbu na fakturu."
                : "Upravte název, částku, DPH, datum a přiřazení k zakázce."}
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
            {!isEditingDeliveryNote ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
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
              <div className="space-y-2">
                <Label htmlFor="edit-currency">Měna</Label>
                <Select
                  value={editForm.currency}
                  onValueChange={(v) =>
                    setEditForm({
                      ...editForm,
                      currency: v === "EUR" ? "EUR" : "CZK",
                    })
                  }
                >
                  <SelectTrigger id="edit-currency" className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CZK">CZK</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            ) : null}
            {!isEditingDeliveryNote && editRow?.currency === "EUR" && editRow.exchangeRate ? (
              <p className="text-xs text-muted-foreground">
                Uložený kurz: 1 EUR = {Number(editRow.exchangeRate).toLocaleString("cs-CZ")}{" "}
                Kč (při úpravě se nemění).
              </p>
            ) : null}
            {!isEditingDeliveryNote ? (
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
            ) : null}
            {!isEditingDeliveryNote && editForm.sDPH ? (
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
            {isEditingDeliveryNote ? (
              <>
                <div className="space-y-2">
                  <Label>Dodavatel</Label>
                  <Input
                    value={editSupplier}
                    onChange={(e) => setEditSupplier(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Přiřazení k faktuře</Label>
                  <Select
                    value={editInvoiceId || "__none__"}
                    onValueChange={(v) => setEditInvoiceId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Není přiřazeno k faktuře" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Není přiřazeno k faktuře</SelectItem>
                      {invoiceSelectOptions.map((inv) => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Zařazení dokladu</Label>
                  <Select
                    value={editAssignmentType}
                    onValueChange={(v) => setEditAssignmentType(v as AssignmentType)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending_assignment">Nezařazený (později)</SelectItem>
                      <SelectItem value="job_cost">Zakázka</SelectItem>
                      <SelectItem value="company">Firma</SelectItem>
                      <SelectItem value="warehouse">Sklad</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editAssignmentType === "warehouse" ? (
                  <div className="space-y-2">
                    <Label>ID skladu</Label>
                    <Input
                      value={editWarehouseId}
                      onChange={(e) => setEditWarehouseId(e.target.value)}
                      placeholder="main"
                      className="bg-background"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            {!isEditingDeliveryNote ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label htmlFor="edit-requires-payment">K úhradě</Label>
                  <p className="text-xs text-muted-foreground">
                    Přehled na hlavní stránce a splatnost.
                  </p>
                </div>
                <Switch
                  id="edit-requires-payment"
                  checked={editForm.requiresPayment}
                  onCheckedChange={(v) =>
                    setEditForm({ ...editForm, requiresPayment: v })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-due-date">Splatnost</Label>
                <Input
                  id="edit-due-date"
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) =>
                    setEditForm({ ...editForm, dueDate: e.target.value })
                  }
                  className="bg-background"
                />
              </div>
              {editRow?.paid === true ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                  <p className="font-medium">Zaplaceno</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => editRow && void markDocumentUnpaid(editRow)}
                  >
                    Označit jako nezaplaceno
                  </Button>
                </div>
              ) : editRow &&
                editForm.requiresPayment &&
                docDisplayAmounts(editRow).amountGross > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => editRow && void markDocumentPaid(editRow)}
                >
                  Označit jako zaplaceno
                </Button>
              ) : null}
            </div>
            ) : null}
            <div className="space-y-2">
              <Label>Zakázka</Label>
              {isEditingDeliveryNote && editAssignmentType !== "job_cost" ? (
                <p className="text-xs text-muted-foreground">Doklad není zařazen k zakázce.</p>
              ) : null}
              <Select
                value={editForm.zakazkaId || "__none__"}
                onValueChange={(v) =>
                  setEditForm({
                    ...editForm,
                    zakazkaId: v === "__none__" ? "" : v,
                  })
                }
                disabled={isEditingDeliveryNote && editAssignmentType !== "job_cost"}
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
              {!isEditingDeliveryNote && !editForm.zakazkaId.trim() ? (
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
                  setEditInvoiceId("");
                  setEditAssignmentType("pending_assignment");
                  setEditWarehouseId("");
                  setEditSupplier("");
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
            <AlertDialogDescription className="text-left space-y-2">
              <span>
                Chceš opravdu smazat tento doklad? Akci nelze vrátit.
              </span>
              {deleteTarget ? (
                <span className="block font-medium text-foreground">
                  „{docDisplayTitle(deleteTarget)}“
                </span>
              ) : null}
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

      <AlertDialog open={deleteInvoiceOpen} onOpenChange={setDeleteInvoiceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat fakturu?</AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <span>
                Chceš opravdu smazat tento doklad? Akci nelze vrátit.
              </span>
              {deleteInvoiceTarget ? (
                <span className="block font-medium text-foreground">
                  „{deleteInvoiceTarget.label}“
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingInvoice}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingInvoice}
              onClick={(e) => {
                e.preventDefault();
                void performDeleteInvoice();
              }}
            >
              {isDeletingInvoice ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Smazat"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
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
  todayIso,
  onMarkPaid,
  onMarkUnpaid,
  readOnlyTrash = false,
  showDeleteButton = true,
}: {
  data: CompanyDocumentRow[];
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onEdit: (row: CompanyDocumentRow) => void;
  onAssign: (row: CompanyDocumentRow) => void;
  search: string;
  onSearchChange: (v: string) => void;
  todayIso: string;
  onMarkPaid: (row: CompanyDocumentRow) => void | Promise<void>;
  onMarkUnpaid: (row: CompanyDocumentRow) => void | Promise<void>;
  /** Koš — bez úprav a mazání. */
  readOnlyTrash?: boolean;
  /** Skrýt ikonu koše (např. pro nepřihlášené role). */
  showDeleteButton?: boolean;
}) {
  const [jobFilter, setJobFilter] = useState<string>("__all__");
  const [jobAssignmentFilter, setJobAssignmentFilter] = useState<
    "all" | "assigned" | "unassigned"
  >("all");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [paymentFilter, setPaymentFilter] = useState<string>("__all__");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const jobOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of data) {
      const jid = documentJobLinkId(d);
      if (jid) {
        m.set(jid, d.jobName?.trim() || d.entityName?.trim() || jid);
      }
    }
    return [...m.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "cs", { sensitivity: "base" })
    );
  }, [data]);

  const rows = useMemo(() => {
    let list = [...data];
    if (jobAssignmentFilter === "assigned") {
      list = list.filter((d) => companyDocumentMatchesAssignedJobFilter(d));
    } else if (jobAssignmentFilter === "unassigned") {
      list = list.filter((d) => companyDocumentMatchesUnassignedJobFilter(d));
    }
    if (jobFilter !== "__all__") {
      list = list.filter((d) => documentJobLinkId(d) === jobFilter);
    }
    if (docTypeFilter !== "__all__") {
      list = list.filter((d) => {
        if (docTypeFilter === "delivery_note") return isDeliveryNote(d);
        if (docTypeFilter === "document") return !isDeliveryNote(d);
        return true;
      });
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
    if (paymentFilter !== "__all__") {
      list = list.filter((d) => {
        const pr = d as CompanyDocumentPaymentRow;
        const u = getDocumentPaymentUrgency(pr, todayIso);
        if (paymentFilter === "to_pay") {
          return isDocumentEligibleForPaymentBox(pr);
        }
        if (paymentFilter === "needs_flag") return pr.requiresPayment === true;
        if (paymentFilter === "paid") return pr.paid === true;
        if (paymentFilter === "unpaid") return pr.paid !== true;
        if (paymentFilter === "overdue") return u === "overdue";
        if (paymentFilter === "due_soon") return u === "due_soon";
        return true;
      });
    }
    list.sort((a, b) => {
      const ea = isDocumentEligibleForPaymentBox(a as CompanyDocumentPaymentRow);
      const eb = isDocumentEligibleForPaymentBox(b as CompanyDocumentPaymentRow);
      if (ea && eb) {
        return compareDocumentsForPaymentQueue(
          a as CompanyDocumentPaymentRow,
          b as CompanyDocumentPaymentRow,
          todayIso
        );
      }
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      return docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt);
    });
    return list;
  }, [
    data,
    jobFilter,
    jobAssignmentFilter,
    docTypeFilter,
    typeFilter,
    paymentFilter,
    dateFrom,
    dateTo,
    search,
    todayIso,
  ]);

  const fileKindLabel = (k: JobMediaFileType | "none") => {
    if (k === "pdf") return "PDF";
    if (k === "office") return "Office";
    if (k === "image") return "Obrázek";
    return "—";
  };

  /**
   * Mobil: jeden sloupec → žádné překrývání sloupců; desktop: původní kompaktní mřížka.
   */
  const receivedRowGrid = cn(
    "grid w-full items-start [&>*]:min-w-0 break-words",
    "grid-cols-1 gap-3 px-3 py-3 text-[13px] leading-relaxed sm:text-xs sm:px-2 sm:py-2 sm:gap-2",
    "lg:grid-cols-[92px_minmax(0,1.35fr)_30px_minmax(0,0.95fr)_62px_minmax(0,1.15fr)_minmax(72px,0.9fr)_minmax(0,1fr)] lg:gap-x-1.5 lg:gap-y-0.5 lg:text-[11px] lg:leading-snug"
  );

  return (
    <Card className="min-w-0 overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-gray-200 bg-white p-2 sm:p-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Hledat (název, zakázka, poznámka…)"
            className="h-9 border-gray-300 bg-white pl-8 text-sm text-gray-900"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:gap-x-3">
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">
              Zařazení dokladu
            </Label>
            <Select
              value={jobAssignmentFilter}
              onValueChange={(v) =>
                setJobAssignmentFilter(v as "all" | "assigned" | "unassigned")
              }
            >
              <SelectTrigger
                className={cn(
                  "h-9 w-full border-gray-300 bg-white text-gray-900",
                  jobAssignmentFilter !== "all" &&
                    "border-primary/60 ring-1 ring-primary/25"
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny doklady</SelectItem>
                <SelectItem value="assigned">Zařazené</SelectItem>
                <SelectItem value="unassigned">Nezařazené doklady</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">Zakázka</Label>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
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
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">Kategorie</Label>
            <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny</SelectItem>
                <SelectItem value="document">Doklady</SelectItem>
                <SelectItem value="delivery_note">Dodací listy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">Typ souboru</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
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
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-gray-800">Od data</Label>
            <Input
              type="date"
              className="h-9 border-gray-300 bg-white text-gray-900"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-gray-800">Do data</Label>
            <Input
              type="date"
              className="h-9 border-gray-300 bg-white text-gray-900"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-1 min-w-0 sm:col-span-2 lg:col-span-6">
            <Label className="text-[11px] font-medium text-gray-800">Platba / splatnost</Label>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
                <SelectValue placeholder="Vše" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny doklady</SelectItem>
                <SelectItem value="to_pay">K úhradě (nezaplacené)</SelectItem>
                <SelectItem value="needs_flag">Označené k úhradě</SelectItem>
                <SelectItem value="unpaid">Nezaplacené</SelectItem>
                <SelectItem value="paid">Zaplacené</SelectItem>
                <SelectItem value="overdue">Po splatnosti</SelectItem>
                <SelectItem value="due_soon">Blíží se splatnost</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : rows.length > 0 ? (
          <div className="w-full overflow-hidden bg-white">
            <div
              className={cn(
                receivedRowGrid,
                "hidden border-b border-gray-200 bg-gray-100 font-semibold text-gray-900 lg:grid"
              )}
            >
              <span className="text-left">Akce</span>
              <span>Doklad</span>
              <span className="text-center lg:text-center">Typ</span>
              <span>Zakázka</span>
              <span>Datum</span>
              <span>Úhrada / splatnost / stav</span>
              <span className="text-left tabular-nums lg:text-right">Částka</span>
              <span>Poznámka</span>
            </div>
            {rows.map((row) => {
              const jobLinkId = documentJobLinkId(row);
              const showPendingHighlight = documentShowsAsPendingAssignment(row);
              const fromJobExpense =
                row.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
                row.sourceType === "expense";
              const fromJobMedia =
                row.source === JOB_MEDIA_DOCUMENT_SOURCE ||
                row.sourceType === "job";
              const fk = inferDocRowFileKind(row);
              const RowIcon = fk === "image" ? ImageIcon : FileText;

              const amts = docDisplayAmounts(row);
              const showAmount =
                !fromJobMedia &&
                (amts.amountGross > 0 || amts.amountNet > 0);
              const title = docDisplayTitle(row);
              const canEditRow = !fromJobMedia && !readOnlyTrash;
              const pr = row as CompanyDocumentPaymentRow;
              const payU = getDocumentPaymentUrgency(pr, todayIso);

              const assignmentBadge = resolveDocumentAssignmentBadge(row);

              const iconBtn =
                "h-10 w-10 shrink-0 p-0 text-gray-700 hover:bg-gray-100 hover:text-gray-950 sm:h-7 sm:w-7 touch-manipulation";

              return (
                <div
                  key={row.id}
                  className={cn(
                    receivedRowGrid,
                    "border-b border-gray-200 text-gray-900 hover:bg-gray-50/80 max-lg:rounded-lg max-lg:border max-lg:border-gray-200 max-lg:bg-white",
                    fromJobExpense && "bg-amber-50/90",
                    fromJobMedia && "bg-sky-50/90",
                    showPendingHighlight &&
                      "bg-amber-50/90 ring-1 ring-inset ring-amber-200"
                  )}
                >
                  <div className="flex flex-wrap gap-1.5">
                    <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Akce
                    </span>
                    {!readOnlyTrash && isDocumentEligibleForPaymentBox(pr) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10 px-2 text-[11px] font-medium leading-none sm:h-6 sm:min-h-0 sm:px-1 sm:text-[9px] touch-manipulation"
                        title="Označit jako zaplaceno"
                        onClick={() => void onMarkPaid(row)}
                      >
                        Zapl.
                      </Button>
                    ) : null}
                    {!readOnlyTrash && row.paid === true && row.requiresPayment ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-10 px-2 text-[11px] leading-none sm:h-6 sm:min-h-0 sm:px-1 sm:text-[9px] touch-manipulation"
                        title="Označit jako nezaplaceno"
                        onClick={() => void onMarkUnpaid(row)}
                      >
                        Nezap.
                      </Button>
                    ) : null}
                    {row.fileUrl ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={iconBtn}
                        asChild
                        title="Příloha"
                      >
                        <a
                          href={row.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {jobLinkId ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={iconBtn}
                        asChild
                        title="Zakázka"
                      >
                        <Link href={`/portal/jobs/${jobLinkId}`}>
                          <Briefcase className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    {canEditRow ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={iconBtn}
                        title="Upravit"
                        onClick={() => onEdit(row)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {canEditRow && isDeliveryNote(row) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={iconBtn}
                        title="Přiřadit k faktuře"
                        onClick={() => onEdit(row)}
                      >
                        <ReceiptText className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {!readOnlyTrash ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={iconBtn}
                        title="Přiřadit"
                        onClick={() => onAssign(row)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {showDeleteButton && !readOnlyTrash ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(iconBtn, "hover:text-red-700")}
                        title="Smazat"
                        onClick={() => onDelete(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Doklad
                    </span>
                    <div className="flex items-start gap-1">
                      <RowIcon
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          fk === "pdf" && "text-red-600",
                          fk === "office" && "text-blue-700",
                          fk === "image" && "text-emerald-600",
                          fk === "none" && "text-gray-400"
                        )}
                      />
                      <span
                        className="font-medium text-gray-950 line-clamp-2 break-words"
                        title={title}
                      >
                        {title}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      <Badge
                        variant="secondary"
                        className="h-5 border-gray-300 px-1.5 text-[10px] font-normal text-gray-900"
                      >
                        {isDeliveryNote(row) ? "Dodací list" : "Přijaté"}
                      </Badge>
                      {readOnlyTrash ? (
                        <Badge className="h-5 bg-red-700 px-1.5 text-[10px] text-white hover:bg-red-700">
                          Smazáno
                        </Badge>
                      ) : null}
                      {fromJobExpense ? (
                        <Badge className="h-5 bg-amber-600 px-1.5 text-[10px] font-normal hover:bg-amber-600">
                          Náklad Z
                        </Badge>
                      ) : null}
                      {fromJobMedia ? (
                        <Badge className="h-5 bg-sky-700 px-1.5 text-[10px] text-white hover:bg-sky-700">
                          Média
                        </Badge>
                      ) : null}
                      <Badge
                        className={cn(
                          "h-5 px-1.5 text-[10px] font-normal text-white",
                          showPendingHighlight
                            ? "bg-amber-600 hover:bg-amber-600"
                            : "bg-slate-700 hover:bg-slate-700"
                        )}
                      >
                        {assignmentBadge}
                      </Badge>
                      {isDeliveryNote(row) ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {row.invoiceId ? "Faktura přiřazena" : "Není přiřazeno k faktuře"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-left text-gray-800 lg:text-center">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Typ souboru
                    </span>
                    {fileKindLabel(fk)}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Zakázka
                    </span>
                    {jobLinkId ? (
                      <Link
                        href={`/portal/jobs/${jobLinkId}`}
                        className="font-medium text-blue-800 underline-offset-2 hover:underline line-clamp-2 break-words"
                        title={row.jobName ?? row.entityName ?? ""}
                      >
                        {row.jobName || row.entityName || "Zakázka"}
                      </Link>
                    ) : (
                      <span className="text-gray-800 line-clamp-2 break-words">
                        {showPendingHighlight
                          ? "Doklad není zařazen"
                          : row.assignmentType === "warehouse"
                            ? "Sklad"
                            : row.assignmentType === "company" ||
                                row.assignmentType === "overhead"
                              ? "Firma"
                              : row.entityName ?? "—"}
                      </span>
                    )}
                  </div>

                  <div className="whitespace-normal text-gray-900 lg:whitespace-nowrap">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Datum
                    </span>
                    {row.date ?? "—"}
                  </div>

                  <div className="space-y-0.5 text-gray-900">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Úhrada / stav
                    </span>
                    <div className="flex flex-wrap gap-x-1 gap-y-0">
                      <span>{row.requiresPayment ? "K úhr.: ano" : "K úhr.: ne"}</span>
                      <span className="text-gray-800">·</span>
                      <span className="tabular-nums">
                        {row.dueDate?.trim() || "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5">
                      {row.paid === true ? (
                        <Badge className="h-5 bg-emerald-700 px-1.5 text-[10px] text-white hover:bg-emerald-700">
                          Zaplaceno
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="h-5 border-gray-400 px-1.5 text-[10px] text-gray-900"
                        >
                          Nezaplaceno
                        </Badge>
                      )}
                      {!row.requiresPayment || row.paid === true ? null : (
                        <Badge
                          className={cn(
                            "h-5 px-1.5 text-[10px]",
                            payU === "overdue" &&
                              "border-red-700 bg-red-100 text-red-950",
                            payU === "due_soon" &&
                              "border-amber-600 bg-amber-100 text-amber-950",
                            payU === "incomplete_no_due" &&
                              "border-amber-700 bg-yellow-50 text-yellow-950",
                            payU === "ok" &&
                              "border-gray-400 bg-gray-100 text-gray-900"
                          )}
                        >
                          {urgencyLabel(payU)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-left tabular-nums text-gray-950 lg:text-right">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Částka
                    </span>
                    {showAmount ? (
                      <div className="space-y-0">
                        <div className="text-[10px] font-medium uppercase text-gray-700">
                          {docVatInfoLine(row)}
                        </div>
                        {inferSDPH(row) ? (
                          <>
                            <div className="text-gray-800">
                              Základ{" "}
                              {formatDocMoney(amts.amountNet, amts.currency)}
                            </div>
                            <div className="text-[10px] text-gray-800">
                              DPH {formatDocMoney(amts.vatAmount, amts.currency)}
                            </div>
                            <div className="font-semibold text-gray-950">
                              {formatDocMoney(amts.amountGross, amts.currency)}
                            </div>
                            {amts.showCzkHint ? (
                              <div className="text-[10px] text-gray-600">
                                (≈ {amts.amountGrossCZK.toLocaleString("cs-CZ")}{" "}
                                Kč)
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-gray-950">
                              {formatDocMoney(amts.amountGross, amts.currency)}
                            </div>
                            {amts.showCzkHint ? (
                              <div className="text-[10px] text-gray-600">
                                (≈ {amts.amountGrossCZK.toLocaleString("cs-CZ")}{" "}
                                Kč)
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Poznámka
                    </span>
                    <p className="line-clamp-3 break-words text-gray-900 lg:line-clamp-2">
                      {row.note || row.description || "—"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            Zatím nemáte žádné přijaté doklady.
          </div>
        ) : jobAssignmentFilter === "unassigned" ? (
          <div className="text-center py-20 text-muted-foreground">
            Žádné nezařazené doklady.
          </div>
        ) : jobAssignmentFilter === "assigned" ? (
          <div className="text-center py-20 text-muted-foreground">
            Žádné doklady neodpovídají filtru „Zařazené“ nebo hledání.
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
  invoices = [],
  isLoadingInvoices = false,
  jobs,
  isLoading,
  onDelete,
  onDeleteInvoice,
  onEdit,
  onAssign,
  search,
  onSearchChange,
  todayIso: _todayIso,
  onMarkPaid: _onMarkPaid,
  onMarkUnpaid: _onMarkUnpaid,
  readOnlyTrash = false,
  showDeleteButton = true,
}: {
  data: CompanyDocumentRow[];
  invoices?: Array<Record<string, unknown> & { id: string }>;
  isLoadingInvoices?: boolean;
  jobs: Array<{ id: string; name: string }>;
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onDeleteInvoice: (inv: Record<string, unknown> & { id: string }) => void;
  onEdit: (row: CompanyDocumentRow) => void;
  onAssign: (row: CompanyDocumentRow) => void;
  search: string;
  onSearchChange: (v: string) => void;
  /** Volitelné — rozšíření pro úhrady (vydané tabulce stačí signatura API). */
  todayIso?: string;
  onMarkPaid?: (row: CompanyDocumentRow) => void | Promise<void>;
  onMarkUnpaid?: (row: CompanyDocumentRow) => void | Promise<void>;
  readOnlyTrash?: boolean;
  showDeleteButton?: boolean;
}) {
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const issuedRow = cn(
    "grid w-full items-start border-b border-gray-200 [&>*]:min-w-0 break-words",
    "grid-cols-1 gap-3 px-3 py-3 text-[13px] leading-relaxed sm:text-xs sm:px-2 sm:py-2 sm:gap-2",
    "lg:grid-cols-[88px_minmax(0,1.2fr)_minmax(0,1fr)_72px_minmax(0,1fr)] lg:gap-x-1.5 lg:gap-y-0.5 lg:text-[11px] lg:leading-snug"
  );

  const merged = useMemo(() => {
    type E =
      | { kind: "doc"; row: CompanyDocumentRow; sortKey: string }
      | {
          kind: "inv";
          inv: Record<string, unknown> & { id: string };
          sortKey: string;
        };
    const out: E[] = [];
    for (const row of data) {
      if (categoryFilter === "invoices") {
        continue;
      }
      if (categoryFilter === "delivery_notes" && !isDeliveryNote(row)) continue;
      if (categoryFilter === "documents" && isDeliveryNote(row)) continue;
      out.push({
        kind: "doc",
        row,
        sortKey: String(row.date ?? ""),
      });
    }
    for (const inv of invoices) {
      if (categoryFilter !== "__all__" && categoryFilter !== "invoices") continue;
      out.push({
        kind: "inv",
        inv,
        sortKey: String(inv.issueDate ?? inv.date ?? ""),
      });
    }
    out.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return out;
  }, [data, invoices, categoryFilter]);

  const jobNameForId = (jid: string) =>
    jobs.find((j) => j.id === jid)?.name ?? null;

  const invoiceStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="h-5 bg-emerald-700 px-1.5 text-[10px] text-white">Zaplaceno</Badge>;
      case "partially_paid":
        return <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Částečně</Badge>;
      case "unpaid":
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Neuhrazeno</Badge>;
      case "sent":
        return <Badge className="h-5 bg-blue-600 px-1.5 text-[10px] text-white">Odesláno</Badge>;
      case "draft":
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Koncept</Badge>;
      default:
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {status || "—"}
          </Badge>
        );
    }
  };

  const loading = isLoading || isLoadingInvoices;

  return (
    <Card className="min-w-0 overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col justify-between gap-2 border-b border-gray-200 p-2 sm:flex-row sm:items-center sm:p-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Hledat ve vydaných (doklady i faktury)…"
            className="h-9 border-gray-300 bg-white pl-8 text-sm text-gray-900"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-[180px] border-gray-300 bg-white text-xs text-gray-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Všechny</SelectItem>
              <SelectItem value="invoices">Faktury</SelectItem>
              <SelectItem value="documents">Doklady</SelectItem>
              <SelectItem value="delivery_notes">Dodací listy</SelectItem>
            </SelectContent>
          </Select>
          {!readOnlyTrash ? (
            <Button variant="outlineLight" size="sm" className="h-8 gap-1.5 px-2 text-xs" asChild>
              <Link href="/portal/invoices/new">
                <ReceiptText className="h-3.5 w-3.5 shrink-0" /> Nová faktura
              </Link>
            </Button>
          ) : null}
          <Button variant="outlineLight" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <Filter className="h-3.5 w-3.5 shrink-0" /> Filtr
          </Button>
          <Button variant="outlineLight" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <Download className="h-3.5 w-3.5 shrink-0" /> Export
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : merged.length > 0 ? (
          <div className="w-full overflow-hidden bg-white">
            <div
              className={cn(
                issuedRow,
                "hidden border-b border-gray-200 bg-gray-100 font-semibold text-gray-900 lg:grid"
              )}
            >
              <span>Akce</span>
              <span>Doklad</span>
              <span>Zakázka</span>
              <span>Datum / splatnost</span>
              <span className="text-left tabular-nums lg:text-right">Částka</span>
            </div>
            {merged.map((entry) => {
              const ib =
                "h-10 w-10 shrink-0 p-0 text-gray-700 hover:bg-gray-100 hover:text-gray-950 sm:h-7 sm:w-7 touch-manipulation";
              if (entry.kind === "doc") {
                const docRow = entry.row;
                const issuedAm = docDisplayAmounts(docRow);
                const title = docDisplayTitle(docRow);
                const issuedJobId = documentJobLinkId(docRow);
                return (
                  <div
                    key={`doc-${docRow.id}`}
                    className={cn(
                      issuedRow,
                      "text-gray-900 hover:bg-gray-50/80 max-lg:rounded-lg max-lg:border max-lg:border-gray-200 max-lg:bg-white"
                    )}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Akce
                      </span>
                      {issuedJobId ? (
                        <Button
                          variant="outline"
                          size="icon"
                          className={ib}
                          asChild
                          title="Zakázka"
                        >
                          <Link href={`/portal/jobs/${issuedJobId}`}>
                            <Briefcase className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ) : null}
                      {!readOnlyTrash ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={ib}
                          title="Upravit"
                          onClick={() => onEdit(docRow)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {!readOnlyTrash ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={ib}
                          title="Přiřadit k zakázce"
                          onClick={() => onAssign(docRow)}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {showDeleteButton && !readOnlyTrash ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(docRow)}
                          className={cn(ib, "hover:text-red-700")}
                          aria-label="Smazat doklad"
                          title="Smazat"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="min-w-0 font-medium">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Doklad
                      </span>
                      <Badge variant="outline" className="mb-0.5 h-5 px-1 text-[9px]">
                        {isDeliveryNote(docRow) ? "Dodací list" : "Vydaný doklad"}
                      </Badge>
                      {readOnlyTrash ? (
                        <Badge className="mb-0.5 ml-1 h-5 bg-red-700 px-1 text-[9px] text-white hover:bg-red-700">
                          Smazáno
                        </Badge>
                      ) : null}
                      <div className="flex items-start gap-1">
                        <FileDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                        <span
                          className="line-clamp-2 break-words text-gray-950"
                          title={title}
                        >
                          {title}
                        </span>
                      </div>
                      {docRow.number?.trim() && docRow.number !== title ? (
                        <span className="mt-0.5 block pl-4 text-[10px] text-gray-700 line-clamp-1">
                          {docRow.number}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Zakázka
                      </span>
                      {issuedJobId ? (
                        <Link
                          href={`/portal/jobs/${issuedJobId}`}
                          className="font-medium text-blue-800 underline-offset-2 hover:underline line-clamp-2 break-words"
                          title={docRow.jobName ?? ""}
                        >
                          {docRow.jobName ?? "Zakázka"}
                        </Link>
                      ) : (
                        <span className="text-gray-800">
                          {docRow.assignmentType === "warehouse"
                            ? "Sklad"
                            : docRow.assignmentType === "company" ||
                                docRow.assignmentType === "overhead"
                              ? "Firma"
                              : "Doklad není zařazen"}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 whitespace-normal text-gray-900 lg:whitespace-nowrap">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Datum / splatnost
                      </span>
                      <div>{docRow.date ?? "—"}</div>
                      {docRow.dueDate ? (
                        <div className="text-[10px] text-gray-600">
                          spl. {docRow.dueDate}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-left tabular-nums text-gray-950 lg:text-right">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Částka
                      </span>
                      <div className="text-[10px] font-medium uppercase text-gray-700">
                        {docVatInfoLine(docRow)}
                      </div>
                      {inferSDPH(docRow) ? (
                        <>
                          <div className="text-gray-800">
                            Základ{" "}
                            {formatDocMoney(issuedAm.amountNet, issuedAm.currency)}
                          </div>
                          <div className="text-[10px] text-gray-800">
                            DPH{" "}
                            {formatDocMoney(issuedAm.vatAmount, issuedAm.currency)}
                          </div>
                          <div className="font-semibold text-gray-950">
                            {formatDocMoney(
                              issuedAm.amountGross,
                              issuedAm.currency
                            )}
                          </div>
                          {issuedAm.showCzkHint ? (
                            <div className="text-[10px] text-gray-600">
                              (≈{" "}
                              {issuedAm.amountGrossCZK.toLocaleString("cs-CZ")} Kč)
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="font-semibold text-gray-950">
                            {formatDocMoney(
                              issuedAm.amountGross,
                              issuedAm.currency
                            )}
                          </div>
                          {issuedAm.showCzkHint ? (
                            <div className="text-[10px] text-gray-600">
                              (≈{" "}
                              {issuedAm.amountGrossCZK.toLocaleString("cs-CZ")} Kč)
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                );
              }
              const inv = entry.inv;
              const jid = String(inv.jobId ?? "").trim();
              const gross = roundMoney2(
                Number(inv.amountGross ?? inv.totalAmount ?? 0)
              );
              const net = roundMoney2(Number(inv.amountNet ?? 0));
              const vat = roundMoney2(Number(inv.vatAmount ?? 0));
              const invTitle =
                String(inv.invoiceNumber ?? inv.documentNumber ?? inv.id) ||
                "Faktura";
              const cust = String(inv.customerName ?? "").trim() || "—";
              return (
                <div
                  key={`inv-${inv.id}`}
                  className={cn(
                    issuedRow,
                    "text-gray-900 hover:bg-gray-50/80 max-lg:rounded-lg max-lg:border max-lg:border-emerald-200 max-lg:bg-emerald-50/40",
                    "lg:border-l-2 lg:border-l-emerald-500/80"
                  )}
                >
                  <div className="flex flex-wrap gap-1.5">
                    <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Akce
                    </span>
                    {jid ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={ib}
                        asChild
                        title="Zakázka"
                      >
                        <Link href={`/portal/jobs/${jid}`}>
                          <Briefcase className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon" className={ib} asChild title="Detail faktury">
                      <Link href={`/portal/invoices/${inv.id}`}>
                        <ReceiptText className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    {!readOnlyTrash ? (
                      <Button variant="ghost" size="icon" className={ib} asChild title="Upravit">
                        <Link href={`/portal/invoices/${inv.id}/edit`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={ib}
                      title="Tisk / PDF"
                      onClick={() => openInvoicePrintFromRow(inv, toast)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                    {showDeleteButton && !readOnlyTrash ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(ib, "hover:text-red-700")}
                        title="Smazat fakturu"
                        aria-label="Smazat fakturu"
                        onClick={() => onDeleteInvoice(inv)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="min-w-0 font-medium">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Doklad
                    </span>
                    <div className="mb-0.5 flex flex-wrap items-center gap-1">
                      <Badge className="h-5 bg-emerald-700/90 px-1 text-[9px] text-white">
                        {invoiceDocTypeLabel(inv)}
                      </Badge>
                      {invoiceStatusBadge(String(inv.status ?? ""))}
                      {readOnlyTrash ? (
                        <Badge className="h-5 bg-red-700 px-1 text-[9px] text-white hover:bg-red-700">
                          Smazáno
                        </Badge>
                      ) : null}
                    </div>
                    <span
                      className="line-clamp-2 break-words text-gray-950"
                      title={invTitle}
                    >
                      {invTitle}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-gray-700 line-clamp-2 break-words">
                      {cust}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Zakázka
                    </span>
                    {jid ? (
                      <Link
                        href={`/portal/jobs/${jid}`}
                        className="font-medium text-blue-800 underline-offset-2 hover:underline line-clamp-2 break-words"
                      >
                        {jobNameForId(jid) ?? "Zakázka"}
                      </Link>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </div>
                  <div className="space-y-0.5 whitespace-normal text-gray-900 lg:whitespace-nowrap">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Datum / splatnost
                    </span>
                    <div>{String(inv.issueDate ?? "—")}</div>
                    {inv.dueDate ? (
                      <div className="text-[10px] text-amber-800">
                        spl. {String(inv.dueDate)}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-left tabular-nums text-gray-950 lg:text-right">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Částka
                    </span>
                    <div className="text-[10px] font-medium uppercase text-gray-700">
                      s DPH
                    </div>
                    <div className="text-gray-800">
                      Základ {net.toLocaleString("cs-CZ")} Kč
                    </div>
                    <div className="text-[10px] text-gray-800">
                      DPH {vat.toLocaleString("cs-CZ")} Kč
                    </div>
                    <div className="font-semibold text-gray-950">
                      {gross.toLocaleString("cs-CZ")} Kč
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            Zatím nemáte žádné vydané doklady ani faktury.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <DocumentsPageContent />
    </Suspense>
  );
}
