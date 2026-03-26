"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
  useCompany,
} from "@/firebase";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  uploadJobPhotoFileViaFirebaseSdk,
  uploadJobPhotoBlobViaFirebaseSdk,
  uploadJobFolderImageBlobViaFirebaseSdk,
} from "@/lib/job-photo-upload";
import {
  isAllowedJobMediaFile,
  getJobMediaFileTypeFromFile,
  type JobPhotoAnnotationTarget,
} from "@/lib/job-media-types";
import { JobMediaSection } from "@/components/jobs/job-media-section";
import {
  buildJobMediaMirrorAnnotatedUrlPatch,
  buildNewJobLegacyPhotoMirrorDocument,
  companyDocumentRefForJobFolderImage,
  companyDocumentRefForJobLegacyPhoto,
} from "@/lib/job-linked-document-sync";
import { JobExpensesSection } from "@/components/jobs/job-expenses-section";
import { JobTasksSection } from "@/components/jobs/job-tasks-section";
import type { JobExpenseRow } from "@/lib/job-expense-types";
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
  serverTimestamp,
  deleteDoc,
  getDocs,
  getDoc,
  setDoc,
  deleteField,
} from "firebase/firestore";
import {
  User,
  Trash2,
  Calendar,
  Users,
  Clock,
  ChevronLeft,
  Edit2,
  FileText,
  FileStack,
  MapPin,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JobTemplate, JobTemplateValues } from "@/lib/job-templates";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
  NATIVE_SELECT_CLASS,
} from "@/lib/light-form-control-classes";
import {
  JOB_TAG_CUSTOM_VALUE,
  JOB_TAG_PRESETS,
  jobTagLabel,
} from "@/lib/job-tags";
import { cn } from "@/lib/utils";
import { logActivitySafe } from "@/lib/activity-log";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JobTemplateFormFields } from "@/components/jobs/job-template-form-fields";
import { WorkContractTemplatesManagerDialog } from "@/components/contracts/work-contract-templates-manager-dialog";
import {
  buildContractPlaceholderValues,
  applyContractTemplatePlaceholders,
  formatWorkContractAmountKc,
  formatWorkContractAmountKcFromNumber,
  CONTRACT_FINANCIAL_PLACEHOLDER_KEYS,
} from "@/lib/contract-template-placeholders";
import {
  computeDepositAmountKc,
  computeDoplatekKc,
  validateWorkContractDeposit,
  parsePercentValue,
  parseAmountKc,
  formatPercentForTemplate,
} from "@/lib/work-contract-deposit";
import {
  buildJobBudgetFirestorePayload,
  normalizeBudgetType,
  normalizeVatRate,
  resolveExpenseAmounts,
  resolveJobBudgetFromFirestore,
  roundMoney2,
  VAT_RATE_OPTIONS,
  type JobBudgetType,
} from "@/lib/vat-calculations";
import { allocateNextSodContractNumber } from "@/lib/work-contract-counter";
import {
  buildWorkContractPrintHtml,
  withLineBreaks,
} from "@/lib/work-contract-print-html";
import {
  buildJobTemplateDataSectionInnerHtml,
  formatJobTemplateDataPlainText,
} from "@/lib/work-contract-job-template-data";
import {
  CONTRACT_TEMPLATES_COLLECTION,
  updateContractTemplate,
  deleteContractTemplate,
} from "@/lib/contract-templates-firestore";
import {
  buildClientTextFromJobSnapshot,
  deriveCustomerDisplayNameFromJob,
  parseCustomerNameForParty,
  pickEntityDic,
} from "@/lib/job-customer-client";
import { buildJobCustomerAddressBlock } from "@/lib/customer-address-display";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ref, getDownloadURL, deleteObject, getBlob } from "firebase/storage";
import { FirebaseError } from "firebase/app";
import Link from "next/link";
import {
  deserializeJobPhotoAnnotations,
  readAnnotationPayloadFromPhotoDoc,
  serializeJobPhotoAnnotations,
  type DimensionColor,
  type JobPhotoAnnotation as Annotation,
  type JobPhotoDimensionAnnotation as DimensionAnnotation,
  type JobPhotoNoteAnnotation as NoteAnnotation,
} from "@/lib/job-photo-annotations";
import {
  computeNoteLayout,
  drawNoteAnnotationOnCanvas,
  noteResizeHandleSize,
} from "@/lib/job-photo-annotation-canvas";

type AnnotationTool = "dimension" | "note" | "select";

type DragMode =
  | "none"
  | "dim-start"
  | "dim-end"
  | "dim-move"
  | "dim-draw"
  | "note-target"
  | "note-box"
  | "note-rect-draw"
  | "note-resize-br";

type WorkContractForm = {
  templateName: string;
  contractHeader: string;
  mainContractContent: string;
  client: string;
  contractor: string;
  additionalInfo: string;
  depositPercentage: string;
  depositAmount: string;
  bankAccountNumber: string;
  bankAccountId?: string | null;
  /** Např. SOD-2026-0001 — přidělí se při uložení */
  contractNumber: string;
  /** Datum vystavení / smlouvy (cs-CZ), pro tisk a proměnné */
  contractDateLabel: string;
};

type WorkContractDoc = {
  id: string;
  jobId?: string;
  contractType?: string;
  templateDocId?: string | null;
  templateName?: string | null;
  contractHeader?: string;
  mainContractContent?: string;
  client?: string;
  contractor?: string;
  additionalInfo?: string;
  depositPercentage?: string | number | null;
  depositAmount?: string | number | null;
  /** Uložená částka zálohy (Kč), dopočtená při ukládání. */
  zalohovaCastka?: string | number | null;
  /** Uložené procento zálohy (0–100), pokud bylo zadáno. */
  zalohovaProcenta?: string | number | null;
  bankAccountNumber?: string | null;
  bankAccountId?: string | null;
  contractNumber?: string | null;
  contractIssuedAt?: any;
  pdfHtml?: string;
  pdfSavedAt?: any;
  createdAt?: any;
  updatedAt?: any;
};

type JobEditForm = {
  name: string;
  description: string;
  status: string;
  /** Částka v Kč — význam podle `budgetType`. */
  budget: string;
  budgetType: JobBudgetType;
  /** Sazba DPH 0 / 12 / 21 */
  vatRate: string;
  startDate: string;
  endDate: string;
  measuring: string;
  measuringDetails: string;
  customerId: string;
  assignedEmployeeIdsText: string;
  jobTag: string;
  jobTagCustom: string;
};

type PhotoDoc = {
  id: string;
  imageUrl?: string;
  originalImageUrl?: string;
  annotatedImageUrl?: string;
  /** Firebase Storage fullPath (primární pro mazání / anotace). */
  storagePath?: string;
  annotatedStoragePath?: string;
  path?: string;
  fullPath?: string;
  url?: string;
  downloadURL?: string;
  fileName?: string;
  name?: string;
  createdAt?: any;
  createdBy?: string;
  uploadedBy?: string;
  companyId?: string;
  jobId?: string;
  /** Editovatelné anotace (normalizované souřadnice), viz job-photo-annotations.ts */
  annotationData?: unknown;
  annotationsJson?: string;
  note?: string;
  noteUpdatedAt?: unknown;
  noteUpdatedBy?: string;
};

function omitUndefinedFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function getScaleAwareSizes(canvas: HTMLCanvasElement) {
  const longest = Math.max(canvas.width, canvas.height);
  const scale = Math.max(1, longest / 1200);
  const fontSize = Math.round(25 * scale);
  const lineWidth = Math.max(6, Math.round(6 * scale));
  const endpointRadius = Math.max(8, Math.round(8 * scale));
  const arrowLen = Math.max(18, Math.round(18 * scale));
  const hitRadius = Math.max(18, Math.round(18 * scale));
  return { fontSize, lineWidth, endpointRadius, arrowLen, hitRadius };
}

function getPhotoStorageFullPath(p: PhotoDoc): string {
  const raw = p as PhotoDoc & Record<string, unknown>;
  const candidates = [raw.storagePath, raw.path, raw.fullPath];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function isUsablePhotoRow(p: unknown): p is PhotoDoc & { id: string } {
  if (!p || typeof p !== "object") return false;
  const id = (p as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0;
}

const MAX_JOB_PHOTO_BYTES = 20 * 1024 * 1024;
/** Fail-safe: pokud SDK visí (síť/CORS), UI se stejně uvolní. */
const JOB_PHOTO_UPLOAD_BYTES_TIMEOUT_MS = 3 * 60 * 1000;
const JOB_PHOTO_DOWNLOAD_URL_TIMEOUT_MS = 60 * 1000;

function promiseWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new Error(
          `${label}: překročen čas ${Math.round(ms / 1000)} s (zkontrolujte síť, Firebase Storage a pravidla).`
        )
      );
    }, ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

function jobPhotoUploadErrorTitle(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (
      err.code === "storage/invalid-argument" ||
      err.code === "storage/no-default-bucket" ||
      err.code === "storage/bucket-not-found" ||
      err.code === "storage/project-not-found"
    ) {
      return "Chybná konfigurace Storage bucketu";
    }
  }
  return "Nepodařilo se nahrát fotku do Firebase Storage";
}

function jobPhotoUploadErrorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (err.code === "permission-denied") {
      return "Operace byla zamítnuta (pravidla Firestore nebo Storage). Zkontrolujte nasazení storage.rules.";
    }
    if (err.code === "storage/unauthorized") {
      return "Nemáte oprávnění nahrát soubor do úložiště (zkontrolujte pravidla Storage).";
    }
    if (err.code === "storage/canceled") {
      return "Nahrávání bylo zrušeno.";
    }
    if (err.code === "storage/quota-exceeded") {
      return "Byla překročena kvóta úložiště.";
    }
    if (err.code === "storage/invalid-checksum") {
      return "Soubor se při přenosu poškodil, zkuste to znovu.";
    }
    return err.message || "Chyba úložiště.";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Fotografii se nepodařilo nahrát.";
}

function describeStorageUploadFailure(err: unknown): string {
  const base = jobPhotoUploadErrorMessage(err);
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes("cors") ||
    lower.includes("access-control") ||
    lower.includes("access-control-allow-origin")
  ) {
    return (
      base +
      " U oficiálního SDK jde často o zamítnutí Storage rules (nasadit firebase deploy --only storage), " +
      "nebo o NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, který neodpovídá bucketu projektu v Firebase Console. " +
      "Zkuste vypnout blokující rozšíření prohlížeče."
    );
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed")
  ) {
    return (
      base +
      " Zkontrolujte připojení k internetu a dostupnost Firebase Storage pro tento projekt."
    );
  }
  return base;
}

type CompanyBankAccountDoc = {
  id: string;
  name?: string;
  accountNumber?: string;
  bankCode?: string;
  iban?: string;
  swift?: string;
  currency?: string;
  companyId?: string;
  createdAt?: any;
  updatedAt?: any;
};

function formatCsDateFromFirestore(value: unknown): string {
  if (value == null) return "";
  try {
    const d =
      typeof (value as { toDate?: () => Date })?.toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : value instanceof Date
          ? value
          : new Date(value as string | number);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("cs-CZ").format(d);
  } catch {
    return "";
  }
}

export default function JobDetailPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedSodFromQueryRef = useRef(false);
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId;
  const { company: companyDoc, companyName: companyNameFromDoc } = useCompany();

  const companyBankAccountNumber = useMemo(() => {
    const c: any = companyDoc;
    return (
      c?.bankAccountNumber ||
      c?.bankAccount ||
      c?.bank_account ||
      c?.accountNumber ||
      c?.ucet ||
      c?.account ||
      c?.iban ||
      c?.IBAN ||
      ""
    );
  }, [companyDoc]);

  const bankAccountsColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "bankAccounts")
        : null,
    [firestore, companyId]
  );
  const { data: bankAccounts, isLoading: isLoadingBankAccounts } =
    useCollection<CompanyBankAccountDoc>(bankAccountsColRef);

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? doc(firestore, "companies", companyId, "jobs", jobId as string)
        : null,
    [firestore, companyId, jobId]
  );
  const { data: job, isLoading } = useDoc(jobRef);

  const jobBudgetBreakdown = useMemo(
    () =>
      resolveJobBudgetFromFirestore(
        job as Record<string, unknown> | null | undefined
      ),
    [job]
  );
  const jobBudgetKc = jobBudgetBreakdown?.budgetGross ?? null;

  const templateRef = useMemoFirebase(
    () =>
      firestore && companyId && job?.templateId
        ? doc(firestore, "companies", companyId, "jobTemplates", job.templateId)
        : null,
    [firestore, companyId, job?.templateId]
  );
  const { data: template } = useDoc(templateRef);

  const isAdmin =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.globalRoles?.includes("super_admin");

  const canManageFolders =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "accountant" ||
    profile?.globalRoles?.includes("super_admin");

  const photosColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId as string,
            "photos"
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: photos } = useCollection(photosColRef);

  const expensesQueryRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? query(
            collection(
              firestore,
              "companies",
              companyId,
              "jobs",
              jobId as string,
              "expenses"
            ),
            orderBy("createdAt", "desc")
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobExpenses } = useCollection<JobExpenseRow>(expensesQueryRef);

  const jobExpenseTotals = useMemo(() => {
    let net = 0;
    let gross = 0;
    for (const row of jobExpenses ?? []) {
      const r = resolveExpenseAmounts(row);
      net += r.amountNet;
      gross += r.amountGross;
    }
    return { net: roundMoney2(net), gross: roundMoney2(gross) };
  }, [jobExpenses]);

  const remainingBudgetAfterExpensesNetKc = useMemo(() => {
    if (jobBudgetBreakdown == null) return null;
    return jobBudgetBreakdown.budgetNet - jobExpenseTotals.net;
  }, [jobBudgetBreakdown, jobExpenseTotals.net]);

  const remainingBudgetAfterExpensesGrossKc = useMemo(() => {
    if (jobBudgetBreakdown == null) return null;
    return jobBudgetBreakdown.budgetGross - jobExpenseTotals.gross;
  }, [jobBudgetBreakdown, jobExpenseTotals.gross]);

  const customerId =
    (job as any)?.customerId ||
    (job as any)?.customer_id ||
    (job as any)?.customerID ||
    null;

  const customerRef = useMemoFirebase(
    () =>
      firestore && companyId && customerId
        ? doc(
            firestore,
            "companies",
            companyId,
            "customers",
            customerId
          )
        : null,
    [firestore, companyId, customerId]
  );
  const { data: customer } = useDoc<any>(customerRef);

  const customersColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "customers")
        : null,
    [firestore, companyId]
  );
  const { data: customers } = useCollection(customersColRef);

  const workContractTemplatesColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(
            firestore,
            "companies",
            companyId,
            "workContractTemplates"
          )
        : null,
    [firestore, companyId]
  );
  const {
    data: workContractTemplates,
    isLoading: isWorkContractTemplatesLoading,
  } = useCollection(workContractTemplatesColRef);

  const contractTemplatesQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(
            collection(firestore, CONTRACT_TEMPLATES_COLLECTION),
            where("companyId", "==", companyId)
          )
        : null,
    [firestore, companyId]
  );
  const {
    data: contractTemplates,
    isLoading: isContractTemplatesLoading,
  } = useCollection(contractTemplatesQuery);

  const workContractsColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId as string,
            "workContracts"
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: workContracts, isLoading: isWorkContractsLoading } =
    useCollection<WorkContractDoc>(workContractsColRef);

  const workContractsForJob = useMemo(() => {
    const list = (workContracts || []) as WorkContractDoc[];
    const filtered = list.filter(
      (c) => !c.contractType || c.contractType === "smlouva_o_dilo"
    );

    const getTime = (t: any) => {
      if (!t) return 0;
      if (typeof t === "number") return t;
      if (typeof t.toMillis === "function") return t.toMillis();
      if (typeof t.toDate === "function") return t.toDate().getTime();
      return 0;
    };

    return filtered
      .slice()
      .sort(
        (a, b) => getTime(b.updatedAt) - getTime(a.updatedAt) ||
          getTime(b.createdAt) - getTime(a.createdAt)
      );
  }, [workContracts]);

  const jobCustomerAddressBlock = useMemo(
    () => buildJobCustomerAddressBlock(job, customer),
    [job, customer]
  );

  const formatContractDate = useCallback((t: any): string => {
    try {
      if (!t) return "-";
      if (typeof t.toDate === "function") {
        return t.toDate().toLocaleString("cs-CZ");
      }
      if (typeof t === "number") {
        return new Date(t).toLocaleString("cs-CZ");
      }
      return "-";
    } catch {
      return "-";
    }
  }, []);

  const [isUploading, setIsUploading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [photoToEdit, setPhotoToEdit] = useState<JobPhotoAnnotationTarget | null>(
    null
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [imageForCanvas, setImageForCanvas] = useState<HTMLImageElement | null>(null);
  const [baseImageLoaded, setBaseImageLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<AnnotationTool>("dimension");
  const [activeColor, setActiveColor] = useState<DimensionColor>("red");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [draftAnnotationId, setDraftAnnotationId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>("none");
  const [dragLastPoint, setDragLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  /** Tažení nové poznámky jako obdélník (x0,y0) → (x1,y1) v souřadnicích canvasu. */
  const [noteRectDraft, setNoteRectDraft] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const noteRectDraftRef = useRef(noteRectDraft);
  noteRectDraftRef.current = noteRectDraft;

  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [contractDialogMode, setContractDialogMode] = useState<"view" | "edit">(
    "edit"
  );
  const isContractReadOnly = contractDialogMode === "view";
  const [isContractDirty, setIsContractDirty] = useState(false);
  const [selectedWorkContractTemplateId, setSelectedWorkContractTemplateId] =
    useState<string>("__new__");
  const CONTRACT_DOC_ID_DEFAULT = "smlouva_o_dilo";
  const [activeWorkContractId, setActiveWorkContractId] = useState<string>(
    CONTRACT_DOC_ID_DEFAULT
  );
  const [hasLoadedWorkContract, setHasLoadedWorkContract] = useState(false);
  const [isSavingContract, setIsSavingContract] = useState(false);
  const [contractForm, setContractForm] = useState<WorkContractForm>({
    templateName: "",
    contractHeader: "",
    mainContractContent: "",
    client: "",
    contractor: "",
    additionalInfo: "",
    depositPercentage: "",
    depositAmount: "",
    bankAccountNumber: "",
    bankAccountId: null,
    contractNumber: "",
    contractDateLabel: "",
  });

  const selectedBankAccount = useMemo(() => {
    if (!contractForm.bankAccountId) return null;
    return (bankAccounts || []).find(
      (a) => a.id === contractForm.bankAccountId
    );
  }, [bankAccounts, contractForm.bankAccountId]);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [workContractTemplatesManagerOpen, setWorkContractTemplatesManagerOpen] =
    useState(false);

  const [editJobDialogOpen, setEditJobDialogOpen] = useState(false);
  const [isSavingJobEdit, setIsSavingJobEdit] = useState(false);
  const [jobEditForm, setJobEditForm] = useState<JobEditForm>({
    name: "",
    description: "",
    status: "nová",
    budget: "",
    budgetType: "net",
    vatRate: "21",
    startDate: "",
    endDate: "",
    measuring: "",
    measuringDetails: "",
    customerId: "",
    assignedEmployeeIdsText: "",
    jobTag: "",
    jobTagCustom: "",
  });
  const [jobEditTemplateValues, setJobEditTemplateValues] =
    useState<JobTemplateValues>({});

  const setCanvasNode = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasReady(!!node);
  }, []);

  const resetAnnotationState = useCallback(() => {
    setImageError(null);
    setImageForCanvas(null);
    setBaseImageLoaded(false);
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setDraftAnnotationId(null);
    setDragMode("none");
    setDragLastPoint(null);
    setNoteRectDraft(null);
    setImageObjectUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
      }
      return null;
    });
  }, []);

  const annotationSource = useMemo(() => {
    if (!photoToEdit) return null;

    const pe = photoToEdit;
    return (
      pe.originalImageUrl ||
      pe.imageUrl ||
      pe.annotatedImageUrl ||
      pe.url ||
      pe.downloadURL ||
      pe.storagePath ||
      pe.path ||
      pe.fullPath ||
      pe.annotatedStoragePath ||
      null
    );
  }, [photoToEdit]);

  const loadHtmlImage = useCallback(
    (src: string, useCrossOrigin = false): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        if (!src) {
          reject(new Error("Missing image URL."));
          return;
        }

        const img = new Image();

        if (useCrossOrigin) {
          img.crossOrigin = "anonymous";
        }

        const timeout = window.setTimeout(() => {
          reject(new Error("Image load timeout after 15 seconds."));
        }, 15000);

        img.onload = () => {
          window.clearTimeout(timeout);
          resolve(img);
        };

        img.onerror = (e) => {
          window.clearTimeout(timeout);
          console.error("[JobDetailPage] Image load failed", e);
          reject(new Error(`Image load failed for: ${src}`));
        };

        img.src = src;
      });
    },
    []
  );

  const resolveAnnotationImageUrl = useCallback(async (rawValue: string): Promise<string> => {
    const value = rawValue?.trim();
    if (!value) {
      throw new Error("Missing image URL.");
    }

    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }

    if (value.startsWith("gs://")) {
      const withoutBucket = value.replace(/^gs:\/\/[^/]+\//, "");
      return await getDownloadURL(ref(getFirebaseStorage(), withoutBucket));
    }

    return await getDownloadURL(ref(getFirebaseStorage(), value));
  }, []);

  const colorToHex = (c: DimensionColor) => {
    switch (c) {
      case "red":
        return "#ef4444";
      case "yellow":
        return "#facc15";
      case "white":
        return "#ffffff";
      case "black":
        return "#000000";
      case "blue":
        return "#3b82f6";
      default:
        return "#ef4444";
    }
  };

  const createId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const distance = (x1: number, y1: number, x2: number, y2: number) =>
    Math.hypot(x2 - x1, y2 - y1);

  const distancePointToSegment = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return distance(px, py, x1, y1);
    const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    const cx = x1 + clamped * dx;
    const cy = y1 + clamped * dy;
    return distance(px, py, cx, cy);
  };

  const deriveCustomerDisplayName = (c: any): string => {
    if (!c) return "";
    return (
      c.companyName ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      ""
    );
  };

  const deriveClientText = (c: any): string => {
    if (!c) return "";
    const name = deriveCustomerDisplayName(c);
    const address = c.address || "";
    const ico = c.ico ? `IČO: ${c.ico}` : "";
    const dicRaw = pickEntityDic(c);
    const dic = dicRaw ? `DIČ: ${dicRaw}` : "";
    const email = c.email ? `Email: ${c.email}` : "";
    const phone = c.phone ? `Telefon: ${c.phone}` : "";
    return [name, address, ico, dic, email, phone].filter(Boolean).join("\n");
  };

  const buildFullCompanyAddress = (co: any): string => {
    const streetAndNumber = (co as any)?.companyAddressStreetAndNumber;
    const city = (co as any)?.companyAddressCity;
    const postalCode = (co as any)?.companyAddressPostalCode;
    const country = (co as any)?.companyAddressCountry;

    const structured =
      streetAndNumber || city || postalCode || country
        ? [
            streetAndNumber ? String(streetAndNumber).trim() : "",
            [postalCode ? String(postalCode).trim() : "", city ? String(city).trim() : ""]
              .filter(Boolean)
              .join(" "),
            country ? String(country).trim() : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "";

    if (structured) return structured;

    // Legacy fallbacks.
    return (
      co?.registeredOfficeAddress ||
      co?.registeredOffice ||
      co?.address ||
      co?.sidlo ||
      ""
    );
  };

  const formatCompanyBankAccountNumber = (
    ba?: CompanyBankAccountDoc | null
  ): string => {
    if (!ba) return companyBankAccountNumber || "";
    const iban = (ba.iban || "").trim();
    if (iban) return iban;
    const acc = (ba.accountNumber || "").trim();
    const code = (ba.bankCode || "").trim();
    if (acc && code) return `${acc}/${code}`;
    return acc || "";
  };

  const formatCompanyBankAccountDisplay = (
    ba: CompanyBankAccountDoc
  ): string => {
    const name = (ba.name || "").trim();
    const currency = (ba.currency || "").trim() || "CZK";
    const iban = (ba.iban || "").trim();
    const acc = (ba.accountNumber || "").trim();
    const code = (ba.bankCode || "").trim();
    const czech = acc && code ? `${acc}/${code}` : acc || "";
    const core = iban ? `IBAN: ${iban}` : czech ? `Účet: ${czech}` : "—";
    return `${name ? name + " — " : ""}${core} (${currency})`;
  };

  /**
   * Číslo účtu firmy pro smlouvu: nejdřív pole na dokumentu firmy, jinak první záznam z bankAccounts.
   */
  const companyProfileBankAccountDisplay = useMemo(() => {
    const fromDoc = (companyBankAccountNumber || "").trim();
    if (fromDoc) return fromDoc;
    if (bankAccounts && bankAccounts.length > 0) {
      return formatCompanyBankAccountNumber(bankAccounts[0]).trim();
    }
    return "";
  }, [companyBankAccountNumber, bankAccounts]);

  const deriveContractorText = (
    co: any,
    coName: string,
    bankAccount?: CompanyBankAccountDoc | null
  ): string => {
    const name = coName || co?.companyName || co?.name || "";
    const address = buildFullCompanyAddress(co);
    const ico = co?.ico ? `IČO: ${co.ico}` : "";
    const dicRaw = pickEntityDic(co);
    const dic = dicRaw ? `DIČ: ${dicRaw}` : "";
    const email = co?.email ? `Email: ${co.email}` : "";
    const phone = co?.phone ? `Telefon: ${co.phone}` : "";

    const iban = (bankAccount?.iban || "").trim();
    const swift = (bankAccount?.swift || "").trim();
    const acc = (bankAccount?.accountNumber || "").trim();
    const bankCode = (bankAccount?.bankCode || "").trim();
    const czechAcc = acc && bankCode ? `${acc}/${bankCode}` : acc || "";

    const czechLine =
      czechAcc && bankCode
        ? `Číslo účtu / kód banky: ${czechAcc}`
        : czechAcc
          ? `Číslo účtu: ${czechAcc}`
          : "";

    const ibanLine = iban ? `IBAN: ${iban}` : "";
    const swiftLine = swift ? `SWIFT: ${swift}` : "";

    return [
      name,
      address,
      ico,
      dic,
      email,
      phone,
      czechLine,
      ibanLine,
      swiftLine,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const applyTemplateVariables = useCallback(
    (
      input: string,
      formOverride?: WorkContractForm,
      templateOpts?: { freezePlaceholders?: ReadonlySet<string> }
    ): string => {
      const today = new Intl.DateTimeFormat("cs-CZ").format(new Date());

      console.log("[WorkContract] template context — customer, companyDoc", {
        customer,
        companyDoc,
        customerDic: pickEntityDic(customer),
        supplierDic: pickEntityDic(companyDoc),
      });

      const supplierName =
        companyNameFromDoc ||
        companyDoc?.companyName ||
        (companyDoc as any)?.name ||
        "";
      const supplierAddress = buildFullCompanyAddress(companyDoc as any);
      const supplierIco = companyDoc?.ico || "";
      const supplierDicRaw = pickEntityDic(companyDoc);

      const bankAccountForTokens =
        formOverride?.bankAccountId
          ? (bankAccounts || []).find(
              (a) => a.id === formOverride.bankAccountId
            ) || null
          : selectedBankAccount;

      const supplierAutoText = deriveContractorText(
        companyDoc,
        companyNameFromDoc,
        bankAccountForTokens
      );

      const customerName = customer
        ? deriveCustomerDisplayName(customer)
        : deriveCustomerDisplayNameFromJob(job as any);
      const customerAddress =
        (customer?.address as string | undefined) ||
        (typeof (job as any)?.customerAddress === "string"
          ? (job as any).customerAddress
          : "") ||
        "";
      const customerIco = customer?.ico || "";
      const customerDicRaw = pickEntityDic(customer);

      const customerAutoText = customer
        ? deriveClientText(customer)
        : buildClientTextFromJobSnapshot(job as any);

      const partySplit = parseCustomerNameForParty(customerName);
      const objednatelJmeno = customer
        ? String(customer.firstName || "").trim()
        : partySplit.type === "person"
          ? partySplit.firstName
          : "";
      const objednatelPrijmeni = customer
        ? String(customer.lastName || "").trim()
        : partySplit.type === "person"
          ? partySplit.lastName
          : "";

      const depositPercentage =
        formOverride?.depositPercentage ?? contractForm.depositPercentage;
      const depositAmount =
        formOverride?.depositAmount ?? contractForm.depositAmount;

      const depKc = computeDepositAmountKc({
        depositAmountStr: depositAmount ?? "",
        depositPercentStr: depositPercentage ?? "",
        budgetKc: jobBudgetKc,
      });
      const doplatekKc = computeDoplatekKc(jobBudgetKc, depKc);
      const doplatekFormatted =
        doplatekKc != null ? formatWorkContractAmountKcFromNumber(doplatekKc) : "";

      // DEBUG (SOD): dočasné — rozpočet, záloha, doplatek
      console.log("[SOD deposit]", {
        rozpočetKč: jobBudgetKc,
        zálohaKč: depKc,
        doplatekKč: doplatekKc,
      });

      const pctFieldOnly = String(depositPercentage ?? "").trim();
      const zalohovaProcentaTemplate = pctFieldOnly
        ? formatPercentForTemplate(pctFieldOnly)
        : "";

      const bankAccountNumber =
        formOverride?.bankAccountNumber ?? contractForm.bankAccountNumber;

      const contractNo =
        formOverride?.contractNumber?.trim() ||
        contractForm.contractNumber?.trim() ||
        "";
      const contractDateForTokens =
        formOverride?.contractDateLabel?.trim() ||
        contractForm.contractDateLabel?.trim() ||
        today;

      const cenaZakazky =
        jobBudgetKc != null && Number.isFinite(jobBudgetKc)
          ? `${Math.round(jobBudgetKc).toLocaleString("cs-CZ")} Kč`
          : "";

      const tokenMap: Record<string, string> = {
        "smlouva.cislo": contractNo,
        "smlouva.vs": contractNo,
        "smlouva.datum": contractDateForTokens,
        nazev_firmy: supplierName,
        ico: supplierIco ? String(supplierIco) : "",
        dic: supplierDicRaw ? String(supplierDicRaw) : "—",
        adresa: supplierAddress,
        cislo_uctu_firmy: companyProfileBankAccountDisplay,
        variabilni_symbol: contractNo,
        jmeno_zakaznika: customerName,
        nazev_zakazky: job?.name || "",
        cena: cenaZakazky,
        "dodavatel.nazev": supplierName,
        "dodavatel.sidlo": supplierAddress,
        "dodavatel.ico": supplierIco ? String(supplierIco) : "",
        "dodavatel.dic": supplierDicRaw ? String(supplierDicRaw) : "—",
        dodavatel: supplierAutoText,
        "dodavatel.email": companyDoc?.email
          ? String(companyDoc.email)
          : "",
        "dodavatel.telefon": companyDoc?.phone
          ? String(companyDoc.phone)
          : "",
        "dodavatel.ucet":
          (bankAccountNumber && String(bankAccountNumber).trim()) ||
          companyProfileBankAccountDisplay ||
          "",
        "dodavatel.iban": bankAccountForTokens?.iban
          ? String(bankAccountForTokens.iban)
          : "",
        "dodavatel.swift": bankAccountForTokens?.swift
          ? String(bankAccountForTokens.swift)
          : "",

        "objednatel.nazev": customerName,
        "objednatel.jmeno": objednatelJmeno,
        "objednatel.prijmeni": objednatelPrijmeni,
        "objednatel.sidlo": customerAddress,
        "objednatel.ico": customerIco ? String(customerIco) : "",
        "objednatel.dic": customerDicRaw || "—",
        objednatel: customerAutoText,

        "zakazka.nazev": job?.name || "",
        "zakazka.id": jobId?.toString() || "",
        datum: today,

        "zaloha.procenta": zalohovaProcentaTemplate,
        "zaloha.castka": formatWorkContractAmountKcFromNumber(depKc),
        "zaloha.ucet":
          (bankAccountNumber && String(bankAccountNumber).trim()) ||
          companyProfileBankAccountDisplay ||
          "",
        zaloha: formatWorkContractAmountKcFromNumber(depKc),
        zalohova_castka: formatWorkContractAmountKcFromNumber(depKc),
        zalohova_procenta: zalohovaProcentaTemplate,
        doplatek: doplatekFormatted,

        data_sablony: formatJobTemplateDataPlainText(
          template as JobTemplate | undefined,
          (job?.templateValues as JobTemplateValues | undefined) ?? undefined
        ),
      };

      if (!input) return "";
      return input.replace(
        /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
        (match, token) => {
          if (templateOpts?.freezePlaceholders?.has(token)) return match;
          const v = tokenMap[token];
          return v !== undefined ? v : match;
        }
      );
    },
    [
      companyDoc,
      companyNameFromDoc,
      customer,
      job,
      deriveClientText,
      deriveContractorText,
      deriveCustomerDisplayName,
      job?.name,
      jobId,
      contractForm.depositPercentage,
      contractForm.depositAmount,
      contractForm.bankAccountNumber,
      contractForm.contractNumber,
      contractForm.contractDateLabel,
      selectedBankAccount,
      bankAccounts,
      template,
      job?.templateValues,
      companyProfileBankAccountDisplay,
      jobBudgetKc,
    ]
  );

  /** Chybějící základní údaje pro smlouvu (bez pádu při generování). */
  const getWorkContractPartyDataIssues = useCallback((): string[] => {
    const issues: string[] = [];
    const supplierName =
      companyNameFromDoc ||
      companyDoc?.companyName ||
      (companyDoc as { name?: string } | null)?.name ||
      "";
    if (!String(supplierName).trim()) {
      issues.push("Název firmy (dodavatele)");
    }
    const customerLabel = customer
      ? deriveCustomerDisplayName(customer)
      : deriveCustomerDisplayNameFromJob(job as any);
    if (!String(customerLabel).trim()) {
      issues.push("Zákazník (objednatel)");
    }
    return issues;
  }, [companyNameFromDoc, companyDoc, customer, job]);

  const buildContractHtmlForForm = useCallback(
    (form: WorkContractForm) => {
      const headerRaw = applyTemplateVariables(
        form.contractHeader || "",
        form
      );
      const bodyRaw = applyTemplateVariables(
        form.mainContractContent || "",
        form
      );
      const additionalRaw = applyTemplateVariables(
        form.additionalInfo || "",
        form
      );
      const clientRaw = applyTemplateVariables(form.client || "", form);
      const contractorRaw = applyTemplateVariables(form.contractor || "", form);

      const payCompanyAcct = companyProfileBankAccountDisplay.trim();
      const payFormAcct = (form.bankAccountNumber || "").trim();
      const depPctForm = (form.depositPercentage || "").trim();
      const depKcForm = computeDepositAmountKc({
        depositAmountStr: form.depositAmount ?? "",
        depositPercentStr: form.depositPercentage ?? "",
        budgetKc: jobBudgetKc,
      });
      const depPctDisplay = depPctForm
        ? formatPercentForTemplate(depPctForm)
        : "";
      const paymentLines = [
        payCompanyAcct ? `Číslo účtu: ${payCompanyAcct}` : "",
        form.contractNumber?.trim()
          ? `Variabilní symbol: ${form.contractNumber.trim()}`
          : "",
        depPctForm
          ? `Záloha ve výši ${depPctDisplay} z ceny díla.`
          : "",
        depKcForm > 0
          ? `Částka zálohy: ${formatWorkContractAmountKcFromNumber(depKcForm)}.`
          : "",
        payFormAcct && payFormAcct !== payCompanyAcct
          ? `Úhrada zálohy na účet: ${payFormAcct}.`
          : "",
      ].filter(Boolean);
      const paymentTermsHtml = withLineBreaks(paymentLines.join("\n"));

      const jobTitle = job?.name || "";
      const jobDesc = job?.description || "";
      const priceFormatted =
        jobBudgetKc != null && Number.isFinite(jobBudgetKc)
          ? `${Math.round(jobBudgetKc).toLocaleString("cs-CZ")} Kč`
          : "";
      const deadlineFormatted = (job?.endDate || "").trim();

      const templateDataSectionInnerHtml = buildJobTemplateDataSectionInnerHtml(
        template as JobTemplate | undefined,
        (job?.templateValues as JobTemplateValues | undefined) ?? undefined
      );

      return buildWorkContractPrintHtml({
        pageTitle: form.templateName?.trim() || "Smlouva o dílo",
        contractNumber: form.contractNumber?.trim() || "",
        variableSymbol: form.contractNumber?.trim() || "",
        documentDate:
          form.contractDateLabel?.trim() ||
          new Intl.DateTimeFormat("cs-CZ").format(new Date()),
        contractHeaderHtml: withLineBreaks(headerRaw),
        mainBodyHtml: withLineBreaks(bodyRaw),
        additionalInfoHtml: withLineBreaks(additionalRaw),
        zhotovitelHtml: withLineBreaks(contractorRaw),
        objednatelHtml: withLineBreaks(clientRaw),
        jobTitle,
        jobDescription: jobDesc,
        priceFormatted,
        deadlineFormatted,
        paymentTermsHtml,
        templateDataSectionInnerHtml,
      });
    },
    [
      applyTemplateVariables,
      job?.name,
      job?.description,
      job?.endDate,
      job?.templateValues,
      template,
      jobBudgetKc,
      companyProfileBankAccountDisplay,
    ]
  );

  const depositValidationError = useMemo(
    () =>
      validateWorkContractDeposit({
        depositAmountStr: contractForm.depositAmount,
        depositPercentStr: contractForm.depositPercentage,
        budgetKc: jobBudgetKc,
      }),
    [contractForm.depositAmount, contractForm.depositPercentage, jobBudgetKc]
  );

  /** Okamžitý přehled záloha / doplatek ve formuláři (stejná logika jako ve šabloně). */
  const depositAndDoplatekPreview = useMemo(() => {
    const depKc = computeDepositAmountKc({
      depositAmountStr: contractForm.depositAmount,
      depositPercentStr: contractForm.depositPercentage,
      budgetKc: jobBudgetKc,
    });
    const dopKc = computeDoplatekKc(jobBudgetKc, depKc);
    return {
      depKc,
      dopKc,
      doplatekFormatted:
        dopKc != null ? formatWorkContractAmountKcFromNumber(dopKc) : "—",
    };
  }, [
    contractForm.depositAmount,
    contractForm.depositPercentage,
    jobBudgetKc,
  ]);

  const buildPrefilledContractHeader = useCallback((): string => {
    const jobName = job?.name || "Zakázka";
    const clientName = customer ? deriveCustomerDisplayName(customer) : "";
    const supplierName =
      companyNameFromDoc ||
      companyDoc?.companyName ||
      (companyDoc as any)?.name ||
      "";
    const dateStr = new Intl.DateTimeFormat("cs-CZ").format(new Date());

    return [
      "Smlouva o dílo",
      `Zakázka: ${jobName}`,
      clientName ? `Objednatel: ${clientName}` : "",
      supplierName ? `Dodavatel: ${supplierName}` : "",
      `Datum: ${dateStr}`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [job?.name, customer, companyDoc, companyNameFromDoc]);

  const buildTemplateValuesText = useCallback((): string => {
    return formatJobTemplateDataPlainText(
      template as JobTemplate | undefined,
      (job?.templateValues as JobTemplateValues | undefined) ?? undefined
    );
  }, [template, job?.templateValues]);

  const buildJobSpecificationContractBody = useCallback((): string => {
    const popis = job?.description || "";
    const mer = job?.measuring || "";
    const merDet = job?.measuringDetails || "";
    const zamereni = buildTemplateValuesText();

    return [
      "Popis zakázky:",
      popis ? popis : "—",
      "",
      "Měření:",
      mer ? mer : "—",
      merDet ? merDet : "",
      "",
      "Zaměření podle šablony:",
      zamereni ? zamereni : "—",
      "",
      "Platební podmínky (záloha):",
      "• Záloha: {{zaloha.procenta}}",
      "• Částka zálohy: {{zaloha.castka}}",
      "• Číslo účtu: {{zaloha.ucet}}",
    ]
      .filter((l) => l !== "")
      .join("\n");
  }, [job?.description, job?.measuring, job?.measuringDetails, buildTemplateValuesText]);

  const openHtmlBlobWindow = useCallback(
    (html: string, opts?: { print?: boolean }) => {
      const doPrint = opts?.print !== false;
      const w = window.open("", "_blank");
      if (!w) {
        throw new Error(
          "Popup blokováno prohlížečem. Povolit vyskakovací okna a zkuste znovu."
        );
      }

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const cleanup = () => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      };

      w.location.href = url;
      w.focus();

      if (doPrint) {
        setTimeout(() => {
          try {
            w.print();
          } catch (err) {
            console.error("[WorkContract] print failed", err);
          } finally {
            cleanup();
          }
        }, 300);
      } else {
        setTimeout(cleanup, 60_000);
      }
    },
    []
  );

  const openPrintableWindow = useCallback(
    (html: string) => openHtmlBlobWindow(html, { print: true }),
    [openHtmlBlobWindow]
  );

  const openContractPreviewWindow = useCallback(
    (html: string) => openHtmlBlobWindow(html, { print: false }),
    [openHtmlBlobWindow]
  );

  const prefillContractFormFromJobAndCustomer = useCallback(() => {
    const clientText = customer
      ? deriveClientText(customer)
      : buildClientTextFromJobSnapshot(job as any);
    const contractorText = deriveContractorText(
      companyDoc,
      companyNameFromDoc,
      selectedBankAccount
    );

    setContractForm((prev) => ({
      ...prev,
      contractHeader: prev.contractHeader || buildPrefilledContractHeader(),
      client: prev.client || clientText,
      contractor: prev.contractor || contractorText,
    }));
  }, [
    customer,
    job,
    companyDoc,
    companyNameFromDoc,
    selectedBankAccount,
    buildPrefilledContractHeader,
  ]);

  useEffect(() => {
    if (!contractDialogOpen) return;
    if (isContractDirty) return;
    if (hasLoadedWorkContract) return;
    prefillContractFormFromJobAndCustomer();
  }, [
    contractDialogOpen,
    isContractDirty,
    hasLoadedWorkContract,
    prefillContractFormFromJobAndCustomer,
  ]);

  const openContractDialog = useCallback(async () => {
    if (!firestore || !companyId || !jobId) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Chybí data pro načtení smlouvy.",
      });
      return;
    }

    // Create a new contract version id for each click.
    const newContractId = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    setContractDialogMode("edit");
    setContractDialogOpen(true);
    setHasLoadedWorkContract(true);
    setIsContractDirty(false);

    setActiveWorkContractId(newContractId);
    setSelectedWorkContractTemplateId("__new__");

    const autoClientText = customer
      ? deriveClientText(customer)
      : buildClientTextFromJobSnapshot(job as any);
    const defaultBankAccount = bankAccounts && bankAccounts.length > 0 ? bankAccounts[0] : null;
    const autoContractorText = deriveContractorText(
      companyDoc,
      companyNameFromDoc,
      defaultBankAccount
    );

    setContractForm({
      templateName: "",
      contractHeader: buildPrefilledContractHeader(),
      mainContractContent: buildJobSpecificationContractBody(),
      client: autoClientText,
      contractor: autoContractorText,
      additionalInfo: "",
      depositPercentage: "",
      depositAmount: "",
      bankAccountNumber: defaultBankAccount
        ? formatCompanyBankAccountNumber(defaultBankAccount)
        : companyBankAccountNumber,
      bankAccountId: defaultBankAccount?.id || null,
      contractNumber: "",
      contractDateLabel: "",
    });
  }, [
    firestore,
    companyId,
    jobId,
    toast,
    customer,
    job,
    companyDoc,
    companyNameFromDoc,
    deriveClientText,
    deriveContractorText,
    buildPrefilledContractHeader,
    buildJobSpecificationContractBody,
    bankAccounts,
    companyBankAccountNumber,
    formatCompanyBankAccountNumber,
  ]);

  useEffect(() => {
    openedSodFromQueryRef.current = false;
  }, [jobId]);

  useEffect(() => {
    if (!job || !jobId) return;
    if (searchParams.get("openSod") !== "1") return;
    if (openedSodFromQueryRef.current) return;
    openedSodFromQueryRef.current = true;
    void openContractDialog();
    router.replace(`/portal/jobs/${jobId}`, { scroll: false });
  }, [job, jobId, searchParams, openContractDialog, router]);

  const openWorkContract = useCallback(
    async (contractId: string, mode: "view" | "edit") => {
      if (!firestore || !companyId || !jobId) return;

      try {
        const contractRef = doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId as string,
          "workContracts",
          contractId
        );

        const snap = await getDoc(contractRef);
        if (!snap.exists()) {
          toast({
            variant: "destructive",
            title: "Smlouva nenalezena",
            description: "Záznam se nepodařilo načíst.",
          });
          return;
        }

        const data = snap.data() as WorkContractDoc;

        setContractDialogMode(mode);
        setContractDialogOpen(true);
        setActiveWorkContractId(contractId);
        setSelectedWorkContractTemplateId(
          data.templateDocId || "__new__"
        );
        setHasLoadedWorkContract(true);
        setIsContractDirty(false);

        setContractForm({
          templateName: (data.templateName as any) || "",
          contractHeader: (data.contractHeader as any) || "",
          mainContractContent: (data.mainContractContent as any) || "",
          client: (data.client as any) || "",
          contractor: (data.contractor as any) || "",
          additionalInfo: (data.additionalInfo as any) || "",
          depositPercentage:
            data.zalohovaProcenta != null && String(data.zalohovaProcenta) !== ""
              ? String(data.zalohovaProcenta)
              : data.depositPercentage != null
                ? String(data.depositPercentage)
                : "",
          depositAmount:
            data.zalohovaCastka != null && String(data.zalohovaCastka) !== ""
              ? String(data.zalohovaCastka)
              : data.depositAmount != null
                ? String(data.depositAmount)
                : "",
          bankAccountNumber: (data.bankAccountNumber as any) || companyBankAccountNumber || "",
          bankAccountId: (data.bankAccountId as any) || null,
          contractNumber: (data.contractNumber as any) || "",
          contractDateLabel:
            formatCsDateFromFirestore(data.contractIssuedAt) ||
            formatCsDateFromFirestore(data.createdAt) ||
            "",
        });
      } catch (err: any) {
        console.error("[WorkContract] openWorkContract failed", err);
        toast({
          variant: "destructive",
          title: "Chyba při otevření",
          description: err?.message || "Nepodařilo se načíst smlouvu.",
        });
      }
    },
    [firestore, companyId, jobId, toast, companyBankAccountNumber]
  );

  const generatePDFFromContractId = useCallback(
    async (contractId: string) => {
      if (!firestore || !companyId || !jobId || !user) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Chybí data pro generování PDF.",
        });
        return;
      }

      try {
        const contractRef = doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId as string,
          "workContracts",
          contractId
        );

        const snap = await getDoc(contractRef);
        if (!snap.exists()) {
          toast({
            variant: "destructive",
            title: "Smlouva nenalezena",
            description: "Záznam se nepodařilo načíst.",
          });
          return;
        }

        const data = snap.data() as WorkContractDoc;

        let contractNumber = String(data.contractNumber || "").trim();
        let allocatedNow = false;
        if (!contractNumber) {
          contractNumber = await allocateNextSodContractNumber(
            firestore,
            companyId
          );
          allocatedNow = true;
          await setDoc(
            contractRef,
            {
              contractNumber,
              contractIssuedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        const contractDateLabel = allocatedNow
          ? new Intl.DateTimeFormat("cs-CZ").format(new Date())
          : formatCsDateFromFirestore(data.contractIssuedAt) ||
            formatCsDateFromFirestore(data.createdAt) ||
            new Intl.DateTimeFormat("cs-CZ").format(new Date());

        const form: WorkContractForm = {
          templateName: (data.templateName as any) || "",
          contractHeader: (data.contractHeader as any) || "",
          mainContractContent: (data.mainContractContent as any) || "",
          client: (data.client as any) || "",
          contractor: (data.contractor as any) || "",
          additionalInfo: (data.additionalInfo as any) || "",
          depositPercentage:
            data.zalohovaProcenta != null && String(data.zalohovaProcenta) !== ""
              ? String(data.zalohovaProcenta)
              : data.depositPercentage != null
                ? String(data.depositPercentage)
                : "",
          depositAmount:
            data.zalohovaCastka != null && String(data.zalohovaCastka) !== ""
              ? String(data.zalohovaCastka)
              : data.depositAmount != null
                ? String(data.depositAmount)
                : "",
          bankAccountNumber:
            (data.bankAccountNumber as any) || companyBankAccountNumber || "",
          bankAccountId: (data.bankAccountId as any) || null,
          contractNumber,
          contractDateLabel,
        };

        const depErrListed = validateWorkContractDeposit({
          depositAmountStr: form.depositAmount,
          depositPercentStr: form.depositPercentage,
          budgetKc: jobBudgetKc,
        });
        if (depErrListed) {
          toast({
            variant: "destructive",
            title: "Nelze vytvořit PDF",
            description: depErrListed,
          });
          return;
        }

        const html = buildContractHtmlForForm(form);

        // Persist the generated document HTML to the job.
        await setDoc(
          contractRef,
          {
            pdfHtml: html,
            pdfSavedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        openPrintableWindow(html);

        toast({
          title: "PDF se připravuje",
          description: "Otevřelo se tiskové okno. Uložte jako PDF.",
        });
      } catch (err: any) {
        console.error("[WorkContract] generatePDFFromContractId failed", err);
        toast({
          variant: "destructive",
          title: "Chyba při generování PDF",
          description:
            err?.message || "Nepodařilo se vygenerovat PDF.",
        });
      }
    },
    [
      firestore,
      companyId,
      jobId,
      user,
      toast,
      buildContractHtmlForForm,
      openPrintableWindow,
      companyBankAccountNumber,
      jobBudgetKc,
    ]
  );

  const deleteWorkContract = useCallback(
    async (contractId: string) => {
      if (!firestore || !companyId || !jobId) return;

      const ok = window.confirm(
        "Opravdu chcete smazat smlouvu o dílo pro tuto zakázku?"
      );
      if (!ok) return;

      try {
        const contractRef = doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId as string,
          "workContracts",
          contractId
        );

        await deleteDoc(contractRef);
        toast({
          title: "Smlouva smazána",
          description: "Záznam byl odstraněn.",
        });

        if (activeWorkContractId === contractId) {
          setContractDialogOpen(false);
        }
      } catch (err: any) {
        console.error("[WorkContract] deleteWorkContract failed", err);
        toast({
          variant: "destructive",
          title: "Chyba při mazání",
          description:
            err?.message || "Nepodařilo se smlouvu smazat.",
        });
      }
    },
    [firestore, companyId, jobId, toast, activeWorkContractId]
  );

  const handleLoadWorkContractTemplate = useCallback(
    (templateId: string) => {
      if (templateId === "__new__") {
        setSelectedWorkContractTemplateId("__new__");
        setIsContractDirty(false);
        setContractForm({
          templateName: "",
          contractHeader: "",
          mainContractContent: "",
          client: "",
          contractor: "",
          additionalInfo: "",
          depositPercentage: "",
          depositAmount: "",
          bankAccountNumber: companyBankAccountNumber,
          bankAccountId: null,
          contractNumber: "",
          contractDateLabel: "",
        });
        return;
      }

      if (templateId.startsWith("ct:")) {
        const rawId = templateId.slice(3);
        const tmpl = contractTemplates?.find((t: any) => t.id === rawId);
        if (!tmpl || (companyId && tmpl.companyId !== companyId)) {
          toast({
            variant: "destructive",
            title: "Nepodařilo se načíst šablonu",
            description: "Šablona nebyla nalezena nebo nepatří vaší firmě.",
          });
          return;
        }

        setSelectedWorkContractTemplateId(templateId);
        setIsContractDirty(true);

        const nazevFirmy =
          companyNameFromDoc ||
          companyDoc?.companyName ||
          (companyDoc as any)?.name ||
          "";
        const jmenoZakaznika = customer
          ? deriveCustomerDisplayName(customer)
          : deriveCustomerDisplayNameFromJob(job as any);
        const adresa = customer?.address
          ? String(customer.address)
          : String((job as any)?.customerAddress || "");
        const icoCust =
          customer?.ico != null && String(customer.ico).trim() !== ""
            ? String(customer.ico)
            : "";
        const datum = new Intl.DateTimeFormat("cs-CZ").format(new Date());
        const nazevZakazky = job?.name || "";
        const cena =
          jobBudgetKc != null && Number.isFinite(jobBudgetKc)
            ? `${Math.round(jobBudgetKc).toLocaleString("cs-CZ")} Kč`
            : "";

        const preDepositNum = computeDepositAmountKc({
          depositAmountStr: "",
          depositPercentStr: "",
          budgetKc: jobBudgetKc,
        });
        const preDepositRaw = String(preDepositNum);
        const preDopKc = computeDoplatekKc(jobBudgetKc, preDepositNum);
        const fullPlaceholderMap = buildContractPlaceholderValues({
          nazevFirmy,
          jmenoZakaznika,
          adresa,
          ico: icoCust,
          datum,
          nazevZakazky,
          cena,
          zalohovaCastkaRaw: preDepositRaw,
          zalohovaProcentaDisplay: "",
          doplatekFormatted:
            preDopKc != null
              ? formatWorkContractAmountKcFromNumber(preDopKc)
              : "",
        });

        // Nevkládat zálohu/doplatek v prvním kroku — jinak by se do textu zapeklo „0 Kč“ / celý rozpočet
        // a proměnné by zmizely dřív, než uživatel vyplní formulář.
        const {
          zalohova_castka: _omitZalohaCastka,
          zalohova_procenta: _omitZalohaPct,
          doplatek: _omitDoplatek,
          ...ctStaticPlaceholders
        } = fullPlaceholderMap;

        let mainBody = applyContractTemplatePlaceholders(
          tmpl.content || "",
          ctStaticPlaceholders
        );
        mainBody = applyTemplateVariables(mainBody, undefined, {
          freezePlaceholders: CONTRACT_FINANCIAL_PLACEHOLDER_KEYS,
        });

        setContractForm({
          templateName: tmpl.name || "",
          contractHeader: buildPrefilledContractHeader(),
          mainContractContent: mainBody,
          client: customer
            ? deriveClientText(customer)
            : buildClientTextFromJobSnapshot(job as any),
          contractor: deriveContractorText(
            companyDoc,
            companyNameFromDoc || nazevFirmy,
            null
          ),
          additionalInfo: "",
          depositPercentage: "",
          depositAmount: "",
          bankAccountNumber: companyBankAccountNumber,
          bankAccountId: null,
          contractNumber: "",
          contractDateLabel: "",
        });
        return;
      }

      const tmpl = workContractTemplates?.find((t: any) => t.id === templateId);
      if (!tmpl) {
        toast({
          variant: "destructive",
          title: "Nepodařilo se načíst šablonu",
          description: "Šablona nebyla nalezena.",
        });
        return;
      }

      setSelectedWorkContractTemplateId(templateId);
      setIsContractDirty(true);

      const loadedDepositPercentage =
        tmpl.depositPercentage != null ? String(tmpl.depositPercentage) : "";
      const tmplDepAmountStr =
        tmpl.depositAmount != null ? String(tmpl.depositAmount) : "";
      const computedDepositAmount = String(
        computeDepositAmountKc({
          depositAmountStr: tmplDepAmountStr,
          depositPercentStr: loadedDepositPercentage,
          budgetKc: jobBudgetKc,
        })
      );

      setContractForm({
        templateName: tmpl.templateName || "",
        contractHeader: tmpl.contractHeader || "",
        mainContractContent: tmpl.mainContractContent || "",
        client: tmpl.client || "",
        contractor: tmpl.contractor || "",
        additionalInfo: tmpl.additionalInfo || "",
        depositPercentage: loadedDepositPercentage,
        depositAmount:
          tmplDepAmountStr.trim() !== ""
            ? tmplDepAmountStr
            : computedDepositAmount !== "0"
              ? computedDepositAmount
              : "",
        bankAccountNumber:
          (tmpl.bankAccountNumber as any) || companyBankAccountNumber || "",
        bankAccountId: (tmpl.bankAccountId as any) || null,
        contractNumber: "",
        contractDateLabel: "",
      });
    },
    [
      toast,
      workContractTemplates,
      contractTemplates,
      companyId,
      companyDoc,
      companyNameFromDoc,
      customer,
      job?.name,
      jobBudgetKc,
      applyTemplateVariables,
      buildPrefilledContractHeader,
      deriveClientText,
      deriveContractorText,
      deriveCustomerDisplayName,
      companyBankAccountNumber,
    ]
  );

  const toTemplateDocId = (name: string) => {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return slug ? `t-${slug}` : `t-${Date.now()}`;
  };

  const saveTemplate = useCallback(async () => {
    if (!firestore || !companyId) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Chybí identifikace organizace.",
      });
      return;
    }

    const trimmedName = contractForm.templateName.trim();
    if (!trimmedName) {
      toast({
        variant: "destructive",
        title: "Chybí název šablony",
        description: "Vyplňte pole „Název šablony“.",
      });
      return;
    }

    const isEditingExistingTemplate =
      selectedWorkContractTemplateId !== "__new__";

    setIsSavingTemplate(true);
    try {
      if (selectedWorkContractTemplateId.startsWith("ct:")) {
        const rawId = selectedWorkContractTemplateId.slice(3);
        await updateContractTemplate(firestore, rawId, {
          name: trimmedName,
          content: contractForm.mainContractContent || "",
        });
        toast({
          title: "Šablona uložena",
          description: `„${trimmedName}“ (contractTemplates) byla aktualizována.`,
        });
        setIsContractDirty(true);
        return;
      }

      const templateDocId = isEditingExistingTemplate
        ? selectedWorkContractTemplateId
        : toTemplateDocId(trimmedName);
      const templateDocRef = doc(
        firestore,
        "companies",
        companyId,
        "workContractTemplates",
        templateDocId
      );

      await setDoc(
        templateDocRef,
        {
          id: templateDocId,
          templateName: trimmedName,
          isTemplate: true,
          contractType: "smlouva_o_dilo",
          contractHeader: contractForm.contractHeader,
          mainContractContent: contractForm.mainContractContent,
          client: contractForm.client,
          contractor: contractForm.contractor,
          additionalInfo: contractForm.additionalInfo,
          depositPercentage: contractForm.depositPercentage,
          depositAmount: contractForm.depositAmount,
          bankAccountNumber: contractForm.bankAccountNumber,
          bankAccountId: contractForm.bankAccountId ?? null,
          createdBy: user?.uid || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      toast({
        title: "Šablona uložena",
        description: `„${trimmedName}“ je připravena k opětovnému použití.`,
      });
      setSelectedWorkContractTemplateId(templateDocId);
      setIsContractDirty(true);
    } catch (err: any) {
      console.error("[WorkContract] saveTemplate failed", err);
      toast({
        variant: "destructive",
        title: "Chyba při ukládání šablony",
        description: err?.message || "Nepodařilo se uložit šablonu.",
      });
    } finally {
      setIsSavingTemplate(false);
    }
  }, [
    firestore,
    companyId,
    contractForm,
    toast,
    user?.uid,
    selectedWorkContractTemplateId,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (!firestore || !companyId) return;
    if (selectedWorkContractTemplateId === "__new__") return;

    let templateNameForConfirm = "";
    if (selectedWorkContractTemplateId.startsWith("ct:")) {
      const rawId = selectedWorkContractTemplateId.slice(3);
      templateNameForConfirm =
        contractTemplates?.find((t: any) => t.id === rawId)?.name || "";
    } else {
      templateNameForConfirm =
        workContractTemplates?.find(
          (t: any) => t.id === selectedWorkContractTemplateId
        )?.templateName || "";
    }

    const ok = window.confirm(
      `Opravdu chcete smazat šablonu${
        templateNameForConfirm ? ` „${templateNameForConfirm}“` : ""
      }?`
    );
    if (!ok) return;

    setIsSavingTemplate(true);
    try {
      if (selectedWorkContractTemplateId.startsWith("ct:")) {
        const rawId = selectedWorkContractTemplateId.slice(3);
        const tmpl = contractTemplates?.find((t: any) => t.id === rawId);
        if (tmpl && tmpl.companyId !== companyId) {
          throw new Error("Šablona nepatří vaší firmě.");
        }
        await deleteContractTemplate(firestore, rawId);
      } else {
        await deleteDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "workContractTemplates",
            selectedWorkContractTemplateId
          )
        );
      }

      toast({
        title: "Šablona smazána",
        description: templateNameForConfirm
          ? `„${templateNameForConfirm}“ byl odstraněn.`
          : "Šablona byla odstraněna.",
      });

      setSelectedWorkContractTemplateId("__new__");
      setIsContractDirty(false);
      setContractForm({
        templateName: "",
        contractHeader: "",
        mainContractContent: "",
        client: "",
        contractor: "",
        additionalInfo: "",
        depositPercentage: "",
        depositAmount: "",
        bankAccountNumber: companyBankAccountNumber,
        bankAccountId: null,
        contractNumber: "",
        contractDateLabel: "",
      });
    } catch (err: any) {
      console.error("[WorkContract] deleteTemplate failed", err);
      toast({
        variant: "destructive",
        title: "Chyba při mazání šablony",
        description: err?.message || "Nepodařilo se šablonu smazat.",
      });
    } finally {
      setIsSavingTemplate(false);
    }
  }, [
    firestore,
    companyId,
    selectedWorkContractTemplateId,
    toast,
    workContractTemplates,
    contractTemplates,
    companyBankAccountNumber,
  ]);

  const upsertWorkContractBase = useCallback(async () => {
    if (!firestore || !companyId || !jobId || !user) {
      throw new Error("Chybí data pro uložení smlouvy.");
    }

    const contractRef = doc(
      firestore,
      "companies",
      companyId,
      "jobs",
      jobId as string,
      "workContracts",
      activeWorkContractId
    );

    const existingSnap = await getDoc(contractRef);
    const existing = existingSnap.exists()
      ? (existingSnap.data() as WorkContractDoc)
      : null;

    let contractNumber = String(existing?.contractNumber || "").trim();
    const allocatedNew = !contractNumber;
    if (allocatedNew) {
      contractNumber = await allocateNextSodContractNumber(
        firestore,
        companyId
      );
    }

    let contractDateLabel: string;
    if (allocatedNew) {
      contractDateLabel = new Intl.DateTimeFormat("cs-CZ").format(new Date());
    } else {
      contractDateLabel =
        formatCsDateFromFirestore(existing?.contractIssuedAt) ||
        formatCsDateFromFirestore(existing?.createdAt) ||
        new Intl.DateTimeFormat("cs-CZ").format(new Date());
    }

    const zalohovaCastkaPersist = computeDepositAmountKc({
      depositAmountStr: contractForm.depositAmount,
      depositPercentStr: contractForm.depositPercentage,
      budgetKc: jobBudgetKc,
    });
    const pctFormRaw = String(contractForm.depositPercentage ?? "").trim();
    const zalohovaProcentaPersist = pctFormRaw
      ? parsePercentValue(pctFormRaw)
      : null;

    const payload: Record<string, any> = {
      id: activeWorkContractId,
      jobId: jobId as string,
      isTemplate: false,
      contractType: "smlouva_o_dilo",
      templateDocId:
        selectedWorkContractTemplateId !== "__new__"
          ? selectedWorkContractTemplateId
          : null,
      templateName: contractForm.templateName || null,
      contractHeader: contractForm.contractHeader,
      mainContractContent: contractForm.mainContractContent,
      client: contractForm.client,
      contractor: contractForm.contractor,
      additionalInfo: contractForm.additionalInfo,
      depositPercentage: contractForm.depositPercentage,
      depositAmount: contractForm.depositAmount,
      zalohovaCastka: zalohovaCastkaPersist,
      zalohovaProcenta:
        zalohovaProcentaPersist != null ? zalohovaProcentaPersist : null,
      bankAccountNumber: contractForm.bankAccountNumber,
      bankAccountId: contractForm.bankAccountId ?? null,
      contractNumber,
      updatedAt: serverTimestamp(),
    };

    if (allocatedNew) {
      payload.contractIssuedAt = serverTimestamp();
    }

    if (existingSnap.exists()) {
      await updateDoc(contractRef, payload);
    } else {
      await setDoc(contractRef, {
        ...payload,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    }

    return { contractRef, contractNumber, contractDateLabel };
  }, [
    firestore,
    companyId,
    jobId,
    user,
    activeWorkContractId,
    selectedWorkContractTemplateId,
    contractForm,
    jobBudgetKc,
  ]);

  const saveContract = useCallback(async () => {
    if (!firestore || !companyId || !jobId) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Chybí data pro uložení smlouvy.",
      });
      return;
    }

    const missing: string[] = [];
    if (!contractForm.contractHeader.trim())
      missing.push("Hlavička smlouvy");
    if (!contractForm.mainContractContent.trim())
      missing.push("Text smlouvy");
    if (!contractForm.client.trim()) missing.push("Objednatel");
    if (!contractForm.contractor.trim()) missing.push("Dodavatel");

    if (missing.length) {
      toast({
        variant: "destructive",
        title: "Nelze uložit smlouvu",
        description: `Chybí: ${missing.join(", ")}`,
      });
      return;
    }

    const depErrSave = validateWorkContractDeposit({
      depositAmountStr: contractForm.depositAmount,
      depositPercentStr: contractForm.depositPercentage,
      budgetKc: jobBudgetKc,
    });
    if (depErrSave) {
      toast({
        variant: "destructive",
        title: "Nelze uložit smlouvu",
        description: depErrSave,
      });
      return;
    }

    setIsSavingContract(true);
    try {
      const { contractNumber, contractDateLabel } =
        await upsertWorkContractBase();
      setContractForm((prev) => ({
        ...prev,
        contractNumber,
        contractDateLabel,
      }));
      toast({
        title: "Smlouva uložena",
        description: contractNumber
          ? `Číslo smlouvy: ${contractNumber}`
          : "Změny byly uloženy do zakázky.",
      });
      setHasLoadedWorkContract(true);
    } catch (err: any) {
      console.error("[WorkContract] saveContract failed", err);
      toast({
        variant: "destructive",
        title: "Chyba při ukládání",
        description: err?.message || "Nepodařilo se uložit smlouvu.",
      });
    } finally {
      setIsSavingContract(false);
    }
  }, [
    firestore,
    companyId,
    jobId,
    toast,
    contractForm,
    upsertWorkContractBase,
    jobBudgetKc,
  ]);

  const generatePDF = useCallback(async () => {
    if (!firestore || !companyId || !jobId || !user) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Chybí data pro vygenerování smlouvy.",
      });
      return;
    }

    const missing: string[] = [];
    if (!contractForm.contractHeader.trim())
      missing.push("Hlavička smlouvy");
    if (!contractForm.mainContractContent.trim())
      missing.push("Text smlouvy");
    if (!contractForm.client.trim()) missing.push("Objednatel");
    if (!contractForm.contractor.trim()) missing.push("Dodavatel");

    if (missing.length) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit PDF",
        description: `Chybí: ${missing.join(", ")}`,
      });
      return;
    }

    const partyIssues = getWorkContractPartyDataIssues();
    if (partyIssues.length) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit PDF",
        description: `Chybí: ${partyIssues.join(", ")}`,
      });
      return;
    }

    const depErrPdf = validateWorkContractDeposit({
      depositAmountStr: contractForm.depositAmount,
      depositPercentStr: contractForm.depositPercentage,
      budgetKc: jobBudgetKc,
    });
    if (depErrPdf) {
      toast({
        variant: "destructive",
        title: "Nelze vytvořit PDF",
        description: depErrPdf,
      });
      return;
    }

    setIsGeneratingPdf(true);
    try {
      // 1) Save contract (create/update) + assign SOD number if new
      const { contractRef, contractNumber, contractDateLabel } =
        await upsertWorkContractBase();

      const mergedForm: WorkContractForm = {
        ...contractForm,
        contractNumber,
        contractDateLabel,
      };
      setContractForm(mergedForm);

      // 2) Same HTML as print — čistý dokument bez UI
      const html = buildContractHtmlForForm(mergedForm);

      // Persist generated HTML for the job record as well.
      await setDoc(
        contractRef,
        {
          pdfHtml: html,
          pdfSavedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      openPrintableWindow(html);

      toast({
        title: "PDF se připravuje",
        description: "Otevřelo se tiskové okno. Uložte jako PDF.",
      });
      // Nezavíráme modal okamžitě (Radix/React může během tisku/unmountu
      // vyhazovat chyby s DOM uzly). Uživatel může modal zavřít ručně.
    } catch (err: any) {
      console.error("[WorkContract] generatePDF failed", err);
      toast({
        variant: "destructive",
        title: "Chyba při generování PDF",
        description: err?.message || "Nepodařilo se vytvořit PDF.",
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [
    firestore,
    companyId,
    jobId,
    user,
    toast,
    contractForm,
    upsertWorkContractBase,
    buildContractHtmlForForm,
    openPrintableWindow,
    jobBudgetKc,
    getWorkContractPartyDataIssues,
  ]);

  const previewWorkContractDocument = useCallback(() => {
    const missing: string[] = [];
    if (!contractForm.contractHeader.trim())
      missing.push("Hlavička smlouvy");
    if (!contractForm.mainContractContent.trim())
      missing.push("Text smlouvy");
    if (!contractForm.client.trim()) missing.push("Objednatel");
    if (!contractForm.contractor.trim()) missing.push("Dodavatel");

    if (missing.length) {
      toast({
        variant: "destructive",
        title: "Nelze zobrazit náhled",
        description: `Chybí: ${missing.join(", ")}`,
      });
      return;
    }

    const partyIssuesPrev = getWorkContractPartyDataIssues();
    if (partyIssuesPrev.length) {
      toast({
        variant: "destructive",
        title: "Nelze zobrazit náhled",
        description: `Chybí: ${partyIssuesPrev.join(", ")}`,
      });
      return;
    }

    const depErrPrev = validateWorkContractDeposit({
      depositAmountStr: contractForm.depositAmount,
      depositPercentStr: contractForm.depositPercentage,
      budgetKc: jobBudgetKc,
    });
    if (depErrPrev) {
      toast({
        variant: "destructive",
        title: "Nelze zobrazit náhled",
        description: depErrPrev,
      });
      return;
    }

    try {
      const html = buildContractHtmlForForm(contractForm);
      openContractPreviewWindow(html);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Chyba náhledu",
        description: err?.message || "Nepodařilo se vygenerovat náhled.",
      });
    }
  }, [
    contractForm,
    buildContractHtmlForForm,
    openContractPreviewWindow,
    toast,
    jobBudgetKc,
    getWorkContractPartyDataIssues,
  ]);

  useEffect(() => {
    if (!editorOpen) return;
    if (!canvasReady) return;
    if (!canvasRef.current) return;

    if (!annotationSource) {
      setImageError("Nebyla nalezena fotografie pro anotaci.");
      setBaseImageLoaded(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        resetAnnotationState();

        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        if (cancelled) return;

        // Prefer Storage SDK blob -> objectUrl to avoid CORS/tainted canvas.
        let resolvedUrl = await resolveAnnotationImageUrl(annotationSource);
        if (photoToEdit) {
          /** Základní fotka — ne PNG s anotací (anotace jsou v annotationData). */
          const storagePath =
            photoToEdit.storagePath ||
            photoToEdit.path ||
            getPhotoStorageFullPath(photoToEdit);
          if (storagePath) {
            const blob = await getBlob(ref(getFirebaseStorage(), storagePath));
            const objectUrl = URL.createObjectURL(blob);
            setImageObjectUrl(objectUrl);
            resolvedUrl = objectUrl;
          }
        }
        if (cancelled) return;

        let image: HTMLImageElement;

        try {
          image = await loadHtmlImage(resolvedUrl, false);
        } catch {
          image = await loadHtmlImage(resolvedUrl, true);
        }

        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error("Canvas is not available.");
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("2D canvas context is not available.");
        }

        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);

        setImageForCanvas(image);
        setBaseImageLoaded(true);
        setImageError(null);

        const raw = photoToEdit
          ? readAnnotationPayloadFromPhotoDoc(photoToEdit as Record<string, unknown>)
          : null;
        const loaded = deserializeJobPhotoAnnotations(
          raw,
          canvas.width,
          canvas.height
        );
        setAnnotations(loaded as Annotation[]);
      } catch (error) {
        if (cancelled) return;

        console.error("[JobDetailPage] Image load failed", error);
        setBaseImageLoaded(false);
        setImageForCanvas(null);
        setImageError(
          error instanceof Error
            ? error.message
            : "Fotografii se nepodařilo načíst."
        );
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    editorOpen,
    canvasReady,
    annotationSource,
    resolveAnnotationImageUrl,
    loadHtmlImage,
    resetAnnotationState,
    photoToEdit,
    photoToEdit?.storagePath,
    photoToEdit?.annotationData,
  ]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageForCanvas || !baseImageLoaded) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageForCanvas, 0, 0, canvas.width, canvas.height);

    const { fontSize, lineWidth, endpointRadius, arrowLen } =
      getScaleAwareSizes(canvas);

    const drawArrowHead = (x: number, y: number, ang: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x - arrowLen * Math.cos(ang - Math.PI / 6),
        y - arrowLen * Math.sin(ang - Math.PI / 6)
      );
      ctx.lineTo(
        x - arrowLen * Math.cos(ang + Math.PI / 6),
        y - arrowLen * Math.sin(ang + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    };

    const drawDimension = (a: DimensionAnnotation, isSelected: boolean) => {
      const stroke = colorToHex(a.color);
      ctx.lineWidth = isSelected ? lineWidth + 2 : lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;
      ctx.fillStyle = stroke;

      ctx.beginPath();
      ctx.moveTo(a.startX, a.startY);
      ctx.lineTo(a.endX, a.endY);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(a.startX, a.startY, endpointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(a.endX, a.endY, endpointRadius, 0, Math.PI * 2);
      ctx.fill();

      const angle = Math.atan2(a.endY - a.startY, a.endX - a.startX);
      drawArrowHead(a.startX, a.startY, angle + Math.PI);
      drawArrowHead(a.endX, a.endY, angle);

      const label = (a.label || "").trim();
      if (label) {
        const midX = (a.startX + a.endX) / 2;
        const midY = (a.startY + a.endY) / 2;
        const paddingX = Math.round(fontSize * 0.6);
        const paddingY = Math.round(fontSize * 0.45);
        const offset = Math.round(fontSize * 0.6);

        ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textBaseline = "alphabetic";
        const textWidth = ctx.measureText(label).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const boxX = midX - boxWidth / 2;
        const boxY = midY - boxHeight / 2 - offset;

        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        ctx.lineWidth = 2;
        ctx.strokeStyle = isSelected ? stroke : "rgba(255,255,255,0.35)";
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, boxX + paddingX, boxY + paddingY + fontSize);
      }
    };

    annotations.forEach((a) => {
      const isSelected = a.id === selectedAnnotationId;
      if (a.type === "dimension") drawDimension(a, isSelected);
      if (a.type === "note") {
        drawNoteAnnotationOnCanvas(ctx, canvas, a, isSelected, {
          fontSize,
          lineWidth,
          endpointRadius,
          arrowLen,
          colorToHex,
        });
      }
    });

    if (noteRectDraft) {
      const bx = Math.min(noteRectDraft.x0, noteRectDraft.x1);
      const by = Math.min(noteRectDraft.y0, noteRectDraft.y1);
      const bw = Math.abs(noteRectDraft.x1 - noteRectDraft.x0);
      const bh = Math.abs(noteRectDraft.y1 - noteRectDraft.y0);
      ctx.fillStyle = "rgba(250,204,21,0.18)";
      ctx.strokeStyle = "rgba(250,204,21,0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
    }
  }, [
    imageForCanvas,
    baseImageLoaded,
    annotations,
    selectedAnnotationId,
    noteRectDraft,
    colorToHex,
  ]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getCanvasCoordsFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const hitTestAnnotation = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const { hitRadius, fontSize, endpointRadius } = getScaleAwareSizes(canvas);

      // Top-most first (last drawn)
      for (let i = annotations.length - 1; i >= 0; i--) {
        const a = annotations[i];

        if (a.type === "dimension") {
          const nearStart = distance(x, y, a.startX, a.startY) <= hitRadius;
          if (nearStart) return { id: a.id, part: "dim-start" as const };
          const nearEnd = distance(x, y, a.endX, a.endY) <= hitRadius;
          if (nearEnd) return { id: a.id, part: "dim-end" as const };

          const dLine = distancePointToSegment(
            x,
            y,
            a.startX,
            a.startY,
            a.endX,
            a.endY
          );
          if (dLine <= hitRadius) return { id: a.id, part: "dim-move" as const };
        }

        if (a.type === "note") {
          const layout = computeNoteLayout(a, canvas, ctx, fontSize);

          if (
            selectedAnnotationId === a.id &&
            layout.explicitBox &&
            typeof a.boxWidth === "number" &&
            typeof a.boxHeight === "number"
          ) {
            const h = noteResizeHandleSize(endpointRadius);
            const hx = layout.boxX + layout.boxW - h;
            const hy = layout.boxY + layout.boxH - h;
            if (x >= hx && x <= hx + h && y >= hy && y <= hy + h) {
              return { id: a.id, part: "note-resize-br" as const };
            }
          }

          const inBox =
            x >= layout.boxX &&
            x <= layout.boxX + layout.boxW &&
            y >= layout.boxY &&
            y <= layout.boxY + layout.boxH;
          if (inBox) return { id: a.id, part: "note-box" as const };

          if (a.showArrow !== false) {
            const nearTarget = distance(x, y, a.targetX, a.targetY) <= hitRadius;
            if (nearTarget) return { id: a.id, part: "note-target" as const };
          }
        }
      }

      return null;
    },
    [annotations, selectedAnnotationId]
  );

  const updateSelectedColor = useCallback(
    (newColor: DimensionColor) => {
      setActiveColor(newColor);
      if (!selectedAnnotationId) return;
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedAnnotationId ? { ...a, color: newColor } : a
        )
      );
    },
    [selectedAnnotationId]
  );

  const editSelectedText = useCallback(() => {
    if (!selectedAnnotationId) return;
    const a = annotations.find((x) => x.id === selectedAnnotationId);
    if (!a) return;
    if (a.type === "dimension") {
      const next = window.prompt("Upravit kótu:", a.label || "") ?? null;
      if (next === null) return;
      setAnnotations((prev) =>
        prev.map((x) =>
          x.id === a.id && x.type === "dimension"
            ? { ...x, label: next.trim() }
            : x
        )
      );
      return;
    }
    if (a.type === "note") {
      const next = window.prompt("Upravit poznámku:", a.text || "") ?? null;
      if (next === null) return;
      setAnnotations((prev) =>
        prev.map((x) =>
          x.id === a.id && x.type === "note" ? { ...x, text: next.trim() } : x
        )
      );
    }
  }, [annotations, selectedAnnotationId]);

  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId) return;
    setAnnotations((prev) => prev.filter((a) => a.id !== selectedAnnotationId));
    setSelectedAnnotationId(null);
    setDraftAnnotationId(null);
    setDragMode("none");
    setDragLastPoint(null);
  }, [selectedAnnotationId]);

  const undoLast = useCallback(() => {
    setAnnotations((prev) => prev.slice(0, -1));
    setSelectedAnnotationId(null);
    setDraftAnnotationId(null);
    setDragMode("none");
    setDragLastPoint(null);
  }, []);

  const clearAllAnnotations = useCallback(() => {
    if (!annotations.length) return;
    if (
      !window.confirm(
        "Opravdu chcete smazat všechny anotace na této fotografii?"
      )
    ) {
      return;
    }
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setDraftAnnotationId(null);
    setDragMode("none");
    setDragLastPoint(null);
    setNoteRectDraft(null);
  }, [annotations.length]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageForCanvas || !baseImageLoaded) return;
    if (!canvasRef.current) return;
    e.preventDefault();

    const pt = getCanvasCoordsFromClient(e.clientX, e.clientY);
    const hit = hitTestAnnotation(pt.x, pt.y);

    if (activeTool === "dimension") {
      if (hit) {
        setSelectedAnnotationId(hit.id);
        setDraftAnnotationId(hit.id);
        setDragMode(hit.part as DragMode);
        setDragLastPoint(pt);
        return;
      }

      const id = createId();
      const a: DimensionAnnotation = {
        id,
        type: "dimension",
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y,
        label: "",
        color: activeColor,
      };
      setAnnotations((prev) => [...prev, a]);
      setSelectedAnnotationId(id);
      setDraftAnnotationId(id);
      setDragMode("dim-draw");
      setDragLastPoint(pt);
      return;
    }

    if (activeTool === "note") {
      if (hit) {
        setSelectedAnnotationId(hit.id);
        setDraftAnnotationId(hit.id);
        setDragMode(hit.part as DragMode);
        setDragLastPoint(pt);
        return;
      }

      setSelectedAnnotationId(null);
      setDraftAnnotationId(null);
      setNoteRectDraft({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      setDragMode("note-rect-draw");
      setDragLastPoint(pt);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    // select tool
    if (hit) {
      setSelectedAnnotationId(hit.id);
      setDraftAnnotationId(hit.id);
      setDragMode(hit.part as DragMode);
      setDragLastPoint(pt);
    } else {
      setSelectedAnnotationId(null);
      setDraftAnnotationId(null);
      setDragMode("none");
      setDragLastPoint(null);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageForCanvas || !baseImageLoaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pt = getCanvasCoordsFromClient(e.clientX, e.clientY);

    if (dragMode === "note-rect-draw") {
      e.preventDefault();
      setNoteRectDraft((d) =>
        d ? { ...d, x1: pt.x, y1: pt.y } : null
      );
      return;
    }

    if (dragMode === "none") return;
    if (!draftAnnotationId) return;
    if (!dragLastPoint) return;
    e.preventDefault();

    const dx = pt.x - dragLastPoint.x;
    const dy = pt.y - dragLastPoint.y;

    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== draftAnnotationId) return a;

        if (a.type === "dimension") {
          if (dragMode === "dim-draw" || dragMode === "dim-end") {
            return { ...a, endX: pt.x, endY: pt.y };
          }
          if (dragMode === "dim-start") {
            return { ...a, startX: pt.x, startY: pt.y };
          }
          if (dragMode === "dim-move") {
            return {
              ...a,
              startX: a.startX + dx,
              startY: a.startY + dy,
              endX: a.endX + dx,
              endY: a.endY + dy,
            };
          }
        }

        if (a.type === "note") {
          if (dragMode === "note-target") {
            return { ...a, targetX: pt.x, targetY: pt.y };
          }
          if (dragMode === "note-box") {
            return {
              ...a,
              boxX: a.boxX + dx,
              boxY: a.boxY + dy,
              targetX: a.targetX + dx,
              targetY: a.targetY + dy,
            };
          }
          if (dragMode === "note-resize-br") {
            const maxW = canvas.width - a.boxX;
            const maxH = canvas.height - a.boxY;
            const newW = Math.max(40, Math.min(pt.x - a.boxX, maxW));
            const newH = Math.max(24, Math.min(pt.y - a.boxY, maxH));
            const next: NoteAnnotation = {
              ...a,
              boxWidth: newW,
              boxHeight: newH,
            };
            if (next.showArrow === false) {
              next.targetX = a.boxX + newW / 2;
              next.targetY = a.boxY + newH / 2;
            }
            return next;
          }
        }

        return a;
      })
    );

    setDragLastPoint(pt);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageForCanvas || !baseImageLoaded) return;

    if (dragMode === "note-rect-draw") {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const d = noteRectDraftRef.current;
      setNoteRectDraft(null);
      setDragMode("none");
      setDragLastPoint(null);
      if (!d) return;

      const bx = Math.min(d.x0, d.x1);
      const by = Math.min(d.y0, d.y1);
      const bw = Math.abs(d.x1 - d.x0);
      const bh = Math.abs(d.y1 - d.y0);
      if (bw < 8 || bh < 8) return;

      const text = (window.prompt("Text poznámky:", "") || "").trim();
      if (!text) return;

      const id = createId();
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const note: NoteAnnotation = {
        id,
        type: "note",
        boxX: bx,
        boxY: by,
        boxWidth: bw,
        boxHeight: bh,
        targetX: cx,
        targetY: cy,
        text,
        color: activeColor,
        showArrow: false,
      };
      setAnnotations((prev) => [...prev, note]);
      setSelectedAnnotationId(id);
      setDraftAnnotationId(null);
      return;
    }

    if (!draftAnnotationId) {
      setDragMode("none");
      setDragLastPoint(null);
      return;
    }
    e.preventDefault();

    const a = annotations.find((x) => x.id === draftAnnotationId);
    if (a?.type === "dimension" && dragMode === "dim-draw") {
      // If it was just a tap, discard.
      const len = distance(a.startX, a.startY, a.endX, a.endY);
      if (len < 8) {
        setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
        setSelectedAnnotationId(null);
        setDraftAnnotationId(null);
        setDragMode("none");
        setDragLastPoint(null);
        return;
      }
      const label = window.prompt("Zadejte rozměr (např. 1200 mm):", a.label) ?? null;
      if (label !== null) {
        setAnnotations((prev) =>
          prev.map((x) =>
            x.id === a.id && x.type === "dimension"
              ? { ...x, label: label.trim() }
              : x
          )
        );
      }
    }

    setDragMode("none");
    setDragLastPoint(null);
  };

  const handlePhotoUpload = async (
    file: File,
    uploadOpts?: { skipUploadingFlag?: boolean }
  ) => {
    const manageUploadingFlag = !uploadOpts?.skipUploadingFlag;

    if (!file || file.size === 0) {
      toast({
        variant: "destructive",
        title: "Soubor nebyl vybrán",
        description: "Nebyl vybrán žádný soubor nebo je soubor prázdný.",
      });
      return;
    }

    if (!isAllowedJobMediaFile(file)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný soubor",
        description: "Použijte JPG, PNG, WEBP nebo PDF.",
      });
      return;
    }

    if (file.size > MAX_JOB_PHOTO_BYTES) {
      toast({
        variant: "destructive",
        title: "Soubor je příliš velký",
        description: `Maximální velikost je ${Math.round(MAX_JOB_PHOTO_BYTES / (1024 * 1024))} MB.`,
      });
      return;
    }

    if (!companyId || !jobId || !photosColRef || !user || !firestore) {
      toast({
        variant: "destructive",
        title: "Nelze nahrát fotografii",
        description: "Chybí identifikace zakázky nebo uživatele.",
      });
      return;
    }

    if (manageUploadingFlag) {
      setIsUploading(true);
    }

    const safeBaseName =
      file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
    const fileType = getJobMediaFileTypeFromFile(file);

    try {
      const { resolvedFullPath, downloadURL } = await uploadJobPhotoFileViaFirebaseSdk(
        file,
        companyId,
        jobId as string
      );

      const photoDocRef = doc(photosColRef);
      const photoPayload = omitUndefinedFields({
        id: photoDocRef.id,
        companyId,
        jobId: jobId as string,
        imageUrl: downloadURL,
        url: downloadURL,
        originalImageUrl: downloadURL,
        downloadURL,
        fileType,
        storagePath: resolvedFullPath,
        path: resolvedFullPath,
        fileName: safeBaseName,
        name: safeBaseName,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        uploadedBy: user.uid,
      });

      if (process.env.NODE_ENV === "development") {
        console.log("[JobDetailPage] photo upload: normalized payload (bez serverTimestamp serializace)", {
          ...photoPayload,
          createdAt: "[serverTimestamp]",
        });
      }

      try {
        await setDoc(photoDocRef, photoPayload);
      } catch (metaErr) {
        console.error("[JobDetailPage] photo metadata save failed", metaErr);
        toast({
          variant: "destructive",
          title: "Nelze uložit metadata souboru",
          description:
            metaErr instanceof FirebaseError
              ? metaErr.message
              : "Záznam fotky se nepodařilo uložit do databáze (zkontrolujte oprávnění Firestore).",
        });
        return;
      }

      try {
        await setDoc(
          companyDocumentRefForJobLegacyPhoto(
            firestore,
            companyId,
            photoDocRef.id
          ),
          buildNewJobLegacyPhotoMirrorDocument({
            companyId,
            jobId: jobId as string,
            jobDisplayName: job?.name?.trim() ?? null,
            photoId: photoDocRef.id,
            userId: user.uid,
            fileName: safeBaseName,
            fileType,
            mimeType: file.type?.trim() || null,
            fileUrl: downloadURL,
            storagePath: resolvedFullPath,
            note: null,
          }),
          { merge: true }
        );
      } catch (mirrorErr) {
        console.error("[JobDetailPage] company document mirror failed", mirrorErr);
      }

      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.upload",
        actionLabel: "Nahrání souboru do fotodokumentace zakázky",
        entityType: "job_photo",
        entityId: photoDocRef.id,
        entityName: safeBaseName,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: {
          jobId: jobId as string,
          fileName: safeBaseName,
          fileType,
          mimeType: file.type?.trim() || null,
        },
      });

      toast({
        title: "Soubor nahrán",
        description: safeBaseName,
      });
    } catch (err: unknown) {
      console.error("[JobPhotoUpload] upload error", err);
      toast({
        variant: "destructive",
        title: jobPhotoUploadErrorTitle(err),
        description: describeStorageUploadFailure(err),
      });
    } finally {
      if (manageUploadingFlag) {
        setIsUploading(false);
      }
    }
  };

  const handleSaveAnnotated = async () => {
    if (!baseImageLoaded || !imageForCanvas) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Základní fotografie není načtena, export nelze provést.",
      });
      return;
    }

    if (!companyId || !jobId || !photoToEdit || !firestore) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Chybí data pro uložení anotace.",
      });
      return;
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = imageForCanvas.naturalWidth || imageForCanvas.width;
    exportCanvas.height = imageForCanvas.naturalHeight || imageForCanvas.height;

    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Nepodařilo se inicializovat plátno pro export.",
      });
      return;
    }

    ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(imageForCanvas, 0, 0);

    const drawAll = (targetCtx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
      const { fontSize, lineWidth, endpointRadius, arrowLen } =
        getScaleAwareSizes(canvas);

      const drawArrowHead = (x: number, y: number, ang: number, fill: string) => {
        targetCtx.fillStyle = fill;
        targetCtx.beginPath();
        targetCtx.moveTo(x, y);
        targetCtx.lineTo(
          x - arrowLen * Math.cos(ang - Math.PI / 6),
          y - arrowLen * Math.sin(ang - Math.PI / 6)
        );
        targetCtx.lineTo(
          x - arrowLen * Math.cos(ang + Math.PI / 6),
          y - arrowLen * Math.sin(ang + Math.PI / 6)
        );
        targetCtx.closePath();
        targetCtx.fill();
      };

      annotations.forEach((a) => {
        const stroke = colorToHex(a.color);
        targetCtx.lineWidth = lineWidth;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";
        targetCtx.strokeStyle = stroke;
        targetCtx.fillStyle = stroke;

        if (a.type === "dimension") {
          targetCtx.beginPath();
          targetCtx.moveTo(a.startX, a.startY);
          targetCtx.lineTo(a.endX, a.endY);
          targetCtx.stroke();

          targetCtx.beginPath();
          targetCtx.arc(a.startX, a.startY, endpointRadius, 0, Math.PI * 2);
          targetCtx.fill();
          targetCtx.beginPath();
          targetCtx.arc(a.endX, a.endY, endpointRadius, 0, Math.PI * 2);
          targetCtx.fill();

          const angle = Math.atan2(a.endY - a.startY, a.endX - a.startX);
          drawArrowHead(a.startX, a.startY, angle + Math.PI, stroke);
          drawArrowHead(a.endX, a.endY, angle, stroke);

          const label = (a.label || "").trim();
          if (label) {
            const midX = (a.startX + a.endX) / 2;
            const midY = (a.startY + a.endY) / 2;
            const paddingX = Math.round(fontSize * 0.6);
            const paddingY = Math.round(fontSize * 0.45);
            const offset = Math.round(fontSize * 0.6);
            targetCtx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
            const textWidth = targetCtx.measureText(label).width;
            const boxWidth = textWidth + paddingX * 2;
            const boxHeight = fontSize + paddingY * 2;
            const boxX = midX - boxWidth / 2;
            const boxY = midY - boxHeight / 2 - offset;

            targetCtx.fillStyle = "rgba(0,0,0,0.75)";
            targetCtx.fillRect(boxX, boxY, boxWidth, boxHeight);
            targetCtx.lineWidth = 2;
            targetCtx.strokeStyle = stroke;
            targetCtx.strokeRect(boxX, boxY, boxWidth, boxHeight);
            targetCtx.fillStyle = "#ffffff";
            targetCtx.fillText(label, boxX + paddingX, boxY + paddingY + fontSize);
          }
        }

        if (a.type === "note") {
          drawNoteAnnotationOnCanvas(targetCtx, canvas, a, false, {
            fontSize,
            lineWidth,
            endpointRadius,
            arrowLen,
            colorToHex,
          });
        }
      });
    };

    drawAll(ctx, exportCanvas);

    const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas export failed."))),
          "image/png"
        );
      });

    try {
      const blob = await canvasToBlob(exportCanvas);

      const annotationData = serializeJobPhotoAnnotations(
        annotations,
        exportCanvas.width,
        exportCanvas.height
      );

      const target = photoToEdit.annotationTarget;
      let annotatedPath: string;
      let annotatedUrl: string;

      if (target.kind === "photos") {
        const up = await uploadJobPhotoBlobViaFirebaseSdk(
          blob,
          companyId,
          jobId as string,
          `${photoToEdit.id}-annotated.png`
        );
        annotatedPath = up.storagePath;
        annotatedUrl = up.downloadURL;
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId as string,
            "photos",
            photoToEdit.id
          ),
          {
            originalImageUrl: photoToEdit.originalImageUrl || photoToEdit.imageUrl || null,
            annotatedImageUrl: annotatedUrl,
            annotatedStoragePath: annotatedPath,
            annotationData,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        const up = await uploadJobFolderImageBlobViaFirebaseSdk(
          blob,
          companyId,
          jobId as string,
          target.folderId,
          `${photoToEdit.id}-annotated.png`
        );
        annotatedPath = up.storagePath;
        annotatedUrl = up.downloadURL;
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId as string,
            "folders",
            target.folderId,
            "images",
            photoToEdit.id
          ),
          {
            originalImageUrl: photoToEdit.originalImageUrl || photoToEdit.imageUrl || null,
            annotatedImageUrl: annotatedUrl,
            annotatedStoragePath: annotatedPath,
            annotationData,
            updatedAt: serverTimestamp(),
          }
        );
      }

      try {
        const mirrorPatch = buildJobMediaMirrorAnnotatedUrlPatch({
          fileUrl: annotatedUrl,
          jobDisplayName: job?.name?.trim() ?? null,
        });
        if (target.kind === "photos") {
          await setDoc(
            companyDocumentRefForJobLegacyPhoto(
              firestore,
              companyId,
              photoToEdit.id
            ),
            mirrorPatch,
            { merge: true }
          );
        } else {
          await setDoc(
            companyDocumentRefForJobFolderImage(
              firestore,
              companyId,
              target.folderId,
              photoToEdit.id
            ),
            mirrorPatch,
            { merge: true }
          );
        }
      } catch (mirrorErr) {
        console.error("[JobDetailPage] dokument mirror po anotaci", mirrorErr);
      }

      toast({
        title: "Fotografie upravena",
        description: "Kóty a poznámky byly uloženy.",
      });

      setEditorOpen(false);
      setPhotoToEdit(null);
      resetAnnotationState();
    } catch (err: any) {
      console.error("[JobDetailPage] saving annotated photo failed", err);
      toast({
        variant: "destructive",
        title: jobPhotoUploadErrorTitle(err),
        description: describeStorageUploadFailure(err),
      });
    }
  };

  const handleDeleteJob = async () => {
    if (!companyId || !jobId || !firestore) return;
    if (!window.confirm("Opravdu chcete tuto zakázku smazat včetně fotografií?")) return;

    try {
      const photosCol = collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId as string,
        "photos"
      );
      const snap = await getDocs(photosCol);

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as any;

        const baseStoragePath =
          (typeof data.storagePath === "string" && data.storagePath) ||
          (typeof data.path === "string" && data.path) ||
          (typeof data.fullPath === "string" && data.fullPath) ||
          "";
        if (baseStoragePath) {
          try {
            await deleteObject(ref(getFirebaseStorage(), baseStoragePath));
          } catch {}
        }

        if (data.annotatedStoragePath) {
          try {
            await deleteObject(ref(getFirebaseStorage(), data.annotatedStoragePath));
          } catch {}
        }

        try {
          await deleteDoc(
            companyDocumentRefForJobLegacyPhoto(
              firestore,
              companyId,
              docSnap.id
            )
          );
        } catch {
          /* */
        }
        await deleteDoc(docSnap.ref);
      }

      const foldersCol = collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId as string,
        "folders"
      );
      const foldersSnap = await getDocs(foldersCol);
      for (const folderDoc of foldersSnap.docs) {
        const folderId = folderDoc.id;
        const imagesCol = collection(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId as string,
          "folders",
          folderId,
          "images"
        );
        const imagesSnap = await getDocs(imagesCol);
        for (const imgSnap of imagesSnap.docs) {
          const data = imgSnap.data() as {
            storagePath?: string;
            path?: string;
            annotatedStoragePath?: string;
          };
          const basePath =
            (typeof data.storagePath === "string" && data.storagePath) ||
            (typeof data.path === "string" && data.path) ||
            "";
          if (basePath) {
            try {
              await deleteObject(ref(getFirebaseStorage(), basePath));
            } catch {
              /* */
            }
          }
          if (data.annotatedStoragePath) {
            try {
              await deleteObject(
                ref(getFirebaseStorage(), data.annotatedStoragePath)
              );
            } catch {
              /* */
            }
          }
          try {
            await deleteDoc(
              companyDocumentRefForJobFolderImage(
                firestore,
                companyId,
                folderId,
                imgSnap.id
              )
            );
          } catch {
            /* */
          }
          await deleteDoc(imgSnap.ref);
        }
        await deleteDoc(folderDoc.ref);
      }

      if (jobRef) {
        const deletedName =
          job && typeof (job as { name?: string }).name === "string"
            ? (job as { name: string }).name
            : jobId as string;
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "job.delete",
          actionLabel: "Smazání zakázky",
          entityType: "job",
          entityId: jobId as string,
          entityName: deletedName,
          sourceModule: "jobs",
          route: `/portal/jobs/${jobId}`,
          metadata: { jobId },
        });
        await deleteDoc(jobRef);
      }

      toast({ title: "Zakázka odstraněna" });
      router.push("/portal/jobs");
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Zakázku se nepodařilo odstranit.",
      });
    }
  };

  const canvasCursor = useMemo(() => {
    if (dragMode === "note-rect-draw") return "crosshair";
    if (dragMode === "note-resize-br") return "nwse-resize";
    if (dragMode !== "none") return "grabbing";
    if (activeTool === "dimension") return "crosshair";
    if (activeTool === "note") return "crosshair";
    return "default";
  }, [activeTool, dragMode]);

  const openEditJobDialog = useCallback(() => {
    if (!isAdmin) {
      toast({
        variant: "destructive",
        title: "Nedostatečná oprávnění",
        description: "Upravit zakázku můžete pouze jako administrátor.",
      });
      return;
    }

    if (!job) return;

    const j = job as any;
    const resolvedCustomerId =
      j.customerId || j.customer_id || j.customerID || "";

    const rawTag =
      typeof j.jobTag === "string" ? j.jobTag.trim() : "";
    const isPreset =
      rawTag &&
      JOB_TAG_PRESETS.some((p) => p.value === rawTag);

    const bdOpen = resolveJobBudgetFromFirestore(
      j as Record<string, unknown>
    );
    setJobEditForm({
      name: j.name || "",
      description: j.description || "",
      status: j.status || "nová",
      budget: bdOpen
        ? String(bdOpen.budgetInput)
        : j.budget != null && j.budget !== ""
          ? String(j.budget)
          : "",
      budgetType: bdOpen ? bdOpen.budgetType : "net",
      vatRate: String(normalizeVatRate(j.vatRate)),
      startDate: j.startDate || "",
      endDate: j.endDate || "",
      measuring: j.measuring || "",
      measuringDetails: j.measuringDetails || "",
      customerId: resolvedCustomerId || "",
      assignedEmployeeIdsText: Array.isArray(j.assignedEmployeeIds)
        ? j.assignedEmployeeIds.join(", ")
        : "",
      jobTag: isPreset ? rawTag : rawTag ? JOB_TAG_CUSTOM_VALUE : "",
      jobTagCustom: isPreset ? "" : rawTag,
    });

    setJobEditTemplateValues((j.templateValues as JobTemplateValues) || {});
    setEditJobDialogOpen(true);
  }, [isAdmin, job, toast]);

  const saveJobEdit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!jobRef) return;
      if (!firestore || !companyId) return;
      if (!isAdmin) {
        toast({
          variant: "destructive",
          title: "Nedostatečná oprávnění",
          description: "Nemáte oprávnění upravit zakázku.",
        });
        return;
      }

      const budgetTrim = jobEditForm.budget.trim();
      let budgetFields: ReturnType<typeof buildJobBudgetFirestorePayload> | null =
        null;
      if (budgetTrim !== "") {
        const amount = Math.round(Number(budgetTrim));
        if (!Number.isFinite(amount) || amount <= 0) {
          toast({
            variant: "destructive",
            title: "Rozpočet",
            description: "Zadejte částku větší než 0, nebo pole rozpočet vyprázdněte.",
          });
          return;
        }
        const vatRateJob = normalizeVatRate(Number(jobEditForm.vatRate));
        const budgetTypeJob = normalizeBudgetType(jobEditForm.budgetType);
        try {
          budgetFields = buildJobBudgetFirestorePayload({
            budgetInput: amount,
            budgetType: budgetTypeJob,
            vatRate: vatRateJob,
          });
        } catch (err) {
          toast({
            variant: "destructive",
            title: "Rozpočet",
            description:
              err instanceof Error ? err.message : "Neplatná částka rozpočtu.",
          });
          return;
        }
      }

      const budgetClears =
        budgetTrim === ""
          ? {
              budget: deleteField(),
              budgetInput: deleteField(),
              budgetType: deleteField(),
              budgetNet: deleteField(),
              budgetVat: deleteField(),
              budgetGross: deleteField(),
              vatRate: deleteField(),
            }
          : {};

      const assignedIds = jobEditForm.assignedEmployeeIdsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const selectedCustomer =
        jobEditForm.customerId && customers
          ? (customers.find((c: any) => c.id === jobEditForm.customerId) as any)
          : null;

      const customerName = selectedCustomer
        ? selectedCustomer.companyName ||
          `${selectedCustomer.firstName || ""} ${selectedCustomer.lastName || ""}`.trim()
        : "";
      const customerPhone = selectedCustomer?.phone || "";
      const customerEmail = selectedCustomer?.email || "";

      setIsSavingJobEdit(true);
      try {
        const payload: Record<string, any> = {
          name: jobEditForm.name,
          description: jobEditForm.description,
          status: jobEditForm.status,
          ...(budgetFields ? budgetFields : {}),
          ...budgetClears,
          startDate: jobEditForm.startDate,
          endDate: jobEditForm.endDate,
          measuring: jobEditForm.measuring,
          measuringDetails: jobEditForm.measuringDetails,

          customerId: jobEditForm.customerId || null,
          customerName,
          customerPhone,
          customerEmail,
          assignedEmployeeIds: assignedIds,
          updatedAt: serverTimestamp(),
        };

        const resolvedJobTag =
          jobEditForm.jobTag === JOB_TAG_CUSTOM_VALUE
            ? jobEditForm.jobTagCustom.trim()
            : jobEditForm.jobTag.trim();
        if (resolvedJobTag) {
          payload.jobTag = resolvedJobTag;
        } else {
          payload.jobTag = deleteField();
        }

        if (job?.templateId) {
          payload.templateId = job.templateId;
          payload.templateValues = jobEditTemplateValues;
        }

        await updateDoc(jobRef, payload);

        const jPrev = job as Record<string, unknown> | null | undefined;
        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "job.update",
          actionLabel: "Úprava zakázky",
          entityType: "job",
          entityId: jobId as string,
          entityName: jobEditForm.name,
          details: `Stav ${String(jPrev?.status ?? "")} → ${jobEditForm.status}`,
          sourceModule: "jobs",
          route: `/portal/jobs/${jobId}`,
          metadata: {
            jobId,
            previousName: jPrev?.name,
            newName: jobEditForm.name,
            previousStatus: jPrev?.status,
            newStatus: jobEditForm.status,
            previousBudget: jPrev?.budget,
            newBudget: budgetFields?.budgetGross,
            newBudgetNet: budgetFields?.budgetNet,
            budgetType: budgetFields?.budgetType,
            customerId: jobEditForm.customerId || null,
          },
        });

        toast({
          title: "Zakázka aktualizována",
          description: `Uloženo: ${jobEditForm.name || "Bez názvu"}`,
        });

        setEditJobDialogOpen(false);
        router.refresh();
      } catch (err: any) {
        console.error("[JobEdit] save failed", err);
        toast({
          variant: "destructive",
          title: "Chyba při ukládání",
          description: err?.message || "Nepodařilo se uložit změny zakázky.",
        });
      } finally {
        setIsSavingJobEdit(false);
      }
    },
    [
      jobRef,
      firestore,
      companyId,
      isAdmin,
      jobEditForm,
      customers,
      job,
      jobId,
      user,
      profile,
      job?.templateId,
      jobEditTemplateValues,
      toast,
      router,
    ]
  );

  const handleStatusChange = async (newStatus: string) => {
    if (!jobRef) return;

    try {
      const previousStatus =
        job && typeof (job as { status?: string }).status === "string"
          ? (job as { status: string }).status
          : "";
      await updateDoc(jobRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });

      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "job.status_change",
        actionLabel: "Změna stavu zakázky",
        entityType: "job",
        entityId: jobId as string,
        entityName:
          job && typeof (job as { name?: string }).name === "string"
            ? (job as { name: string }).name
            : null,
        details: `${previousStatus || "—"} → ${newStatus}`,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: { previousStatus, newStatus, jobId },
      });

      toast({
        title: "Stav aktualizován",
        description: `Zakázka je nyní ve stavu: ${newStatus}`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se změnit stav.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Zakázka nenalezena</h2>
        <Button variant="link" onClick={() => router.push("/portal/jobs")}>
          Zpět na seznam
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/portal/jobs")}>
          <ChevronLeft className="w-6 h-6" />
        </Button>

        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="portal-page-title">{job.name}</h1>
            {(job as { jobTag?: string }).jobTag?.trim() ? (
              <Badge variant="secondary" className="font-normal max-w-[12rem] truncate">
                {jobTagLabel((job as { jobTag?: string }).jobTag)}
              </Badge>
            ) : null}
            <Badge variant="outline" className="border-primary/30 text-primary">
              ID: {jobId?.toString().substring(0, 8)}
            </Badge>
          </div>
          <p className="text-muted-foreground">Detailní přehled projektu</p>
          {(job as any)?.sourceMeasurementId ? (
            <p className="text-sm text-slate-600 mt-1">
              <Link
                href="/portal/jobs/measurements"
                className="text-primary font-medium hover:underline"
              >
                Přehled zaměření
              </Link>
              <span className="text-slate-500"> · zakázka vznikla ze zaměření</span>
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <Select value={job.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-[180px] bg-surface">
                <SelectValue placeholder="Změnit stav" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="nová">Nová</SelectItem>
                <SelectItem value="rozpracovaná">Rozpracovaná</SelectItem>
                <SelectItem value="čeká">Čeká</SelectItem>
                <SelectItem value="dokončená">Dokončená</SelectItem>
                <SelectItem value="fakturována">Fakturována</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            className="gap-2"
            onClick={openEditJobDialog}
          >
            <Edit2 className="w-4 h-4" /> Upravit zakázku
          </Button>

          <Button
            variant="outline"
            className="gap-2"
            onClick={openContractDialog}
          >
            <FileText className="w-4 h-4" /> Vytvořit smlouvu o dílo
          </Button>

          {isAdmin && (
            <Button variant="destructive" className="gap-2" onClick={handleDeleteJob}>
              <Trash2 className="w-4 h-4" /> Smazat
            </Button>
          )}
        </div>
      </div>

      {user && companyId && jobId ? (
        <JobTasksSection
          companyId={companyId}
          jobId={jobId as string}
          user={user}
          canEdit={canManageFolders}
        />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> Popis zakázky
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">
                {job.description || "K této zakázce nebyl přidán žádný popis."}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary" /> Zákazník a adresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobCustomerAddressBlock.displayName ? (
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Zákazník
                  </span>
                  <p className="text-base font-semibold text-foreground">
                    {jobCustomerAddressBlock.displayName}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  U zakázky není uveden název zákazníka.
                </p>
              )}
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Adresa
                </span>
                {jobCustomerAddressBlock.hasAddress ? (
                  <address className="not-italic text-sm leading-relaxed text-foreground">
                    {jobCustomerAddressBlock.addressLines.map((line, i) => (
                      <p key={i} className={i > 0 ? "mt-0.5" : undefined}>
                        {line}
                      </p>
                    ))}
                  </address>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Adresa zákazníka není vyplněna
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> Měření
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">
                {job.measuring || "Žádné poznámky k měření."}
              </p>
              {job.measuringDetails && (
                <p className="mt-2 text-sm text-muted-foreground">{job.measuringDetails}</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> Smlouvy o dílo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isWorkContractsLoading ? (
                <p className="text-sm text-muted-foreground">Načítání…</p>
              ) : workContractsForJob.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Zatím žádné smlouvy.
                </p>
              ) : (
                <div className="space-y-3">
                  {workContractsForJob.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-lg bg-background/50 border border-border/50 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {c.templateName ||
                              c.contractHeader?.split("\n")?.[0] ||
                              "Smlouva o dílo"}
                          </p>
                          {(c as WorkContractDoc).contractNumber ? (
                            <p className="text-xs font-mono text-foreground/90">
                              Číslo: {(c as WorkContractDoc).contractNumber}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            Uloženo: {formatContractDate(c.updatedAt || c.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => openWorkContract(c.id, "view")}
                        >
                          Otevřít
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => openWorkContract(c.id, "edit")}
                        >
                          Upravit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => generatePDFFromContractId(c.id)}
                        >
                          Generovat PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          type="button"
                          onClick={() => deleteWorkContract(c.id)}
                        >
                          Smazat
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {job.templateId &&
            template &&
            job.templateValues != null &&
            Object.keys(job.templateValues).length > 0 && (
              <Card className="bg-surface border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileStack className="w-5 h-5 text-primary" /> Data šablony:{" "}
                    {(template as JobTemplate).name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {(template as JobTemplate).sections?.map((section) => {
                      const fieldsWithValues =
                        section.fields?.filter((f) => {
                          const value = job.templateValues[`${section.id}_${f.id}`];
                          return value !== undefined && value !== "" && value !== null;
                        }) ?? [];

                      if (fieldsWithValues.length === 0) return null;

                      return (
                        <div key={section.id}>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                            {section.name}
                          </p>
                          <dl className="space-y-1.5">
                            {fieldsWithValues.map((f) => {
                              const value = job.templateValues[`${section.id}_${f.id}`];
                              return (
                                <div
                                  key={f.id}
                                  className="flex justify-between gap-4 text-sm"
                                >
                                  <dt className="text-muted-foreground">{f.label}</dt>
                                  <dd className="font-medium text-right">
                                    {typeof value === "boolean"
                                      ? value
                                        ? "Ano"
                                        : "Ne"
                                      : String(value)}
                                  </dd>
                                </div>
                              );
                            })}
                          </dl>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" /> Časová osa a Pokrok
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm mb-2">
                  <span>Celkový pokrok</span>
                  <span className="font-bold">
                    {job.status === "dokončená" || job.status === "fakturována"
                      ? "100%"
                      : "45%"}
                  </span>
                </div>
                <Progress
                  value={
                    job.status === "dokončená" || job.status === "fakturována"
                      ? 100
                      : 45
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-8 pt-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                    Zahájeno
                  </span>
                  <div className="flex items-center gap-2 font-semibold">
                    <Calendar className="w-4 h-4 text-primary" />
                    {job.startDate || "neuvedeno"}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                    Předpokládané dokončení
                  </span>
                  <div className="flex items-center gap-2 font-semibold">
                    <Calendar className="w-4 h-4 text-primary" />
                    {job.endDate || "neuvedeno"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" /> Přiřazení pracovníci
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {job.assignedEmployeeIds?.map((empId: string) => (
                  <div
                    key={empId}
                    className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="font-medium">
                        {empId === user?.uid ? "Já" : `Pracovník (${empId.substring(0, 5)})`}
                      </span>
                    </div>
                    <Badge variant="outline">Aktivní</Badge>
                  </div>
                ))}

                {!job.assignedEmployeeIds?.length && (
                  <p className="text-muted-foreground text-sm">
                    Žádní pracovníci nejsou přiřazeni.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Finanční údaje</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobBudgetBreakdown ? (
                <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      Zadáno
                    </Badge>
                    <span className="text-muted-foreground">
                      {jobBudgetBreakdown.budgetType === "gross"
                        ? "s DPH"
                        : "bez DPH"}
                      :
                    </span>
                    <span className="font-semibold tabular-nums">
                      {jobBudgetBreakdown.budgetInput.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Rozpočet bez DPH</span>
                    <span className="font-semibold tabular-nums">
                      {jobBudgetBreakdown.budgetNet.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      DPH ({jobBudgetBreakdown.vatRate} %)
                    </span>
                    <span className="font-semibold tabular-nums">
                      {jobBudgetBreakdown.budgetVat.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-base font-bold">
                    <span>Rozpočet s DPH</span>
                    <span className="tabular-nums">
                      {jobBudgetBreakdown.budgetGross.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-muted-foreground">Rozpočet</span>
                  <span className="text-xl font-bold tabular-nums">—</span>
                </div>
              )}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-muted-foreground">Náklady bez DPH</span>
                  <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    {jobExpenseTotals.net.toLocaleString("cs-CZ")} Kč
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-muted-foreground">Náklady s DPH</span>
                  <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    {jobExpenseTotals.gross.toLocaleString("cs-CZ")} Kč
                  </span>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-muted-foreground">Zbývá bez DPH</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      remainingBudgetAfterExpensesNetKc != null &&
                        remainingBudgetAfterExpensesNetKc < 0
                        ? "text-destructive"
                        : "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {remainingBudgetAfterExpensesNetKc != null
                      ? `${remainingBudgetAfterExpensesNetKc.toLocaleString("cs-CZ")} Kč`
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-muted-foreground">Zbývá s DPH</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      remainingBudgetAfterExpensesGrossKc != null &&
                        remainingBudgetAfterExpensesGrossKc < 0
                        ? "text-destructive"
                        : "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {remainingBudgetAfterExpensesGrossKc != null
                      ? `${remainingBudgetAfterExpensesGrossKc.toLocaleString("cs-CZ")} Kč`
                      : "-"}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Vyfakturováno (s DPH)</span>
                <span className="font-semibold text-emerald-500">
                  {job.status === "fakturována" && jobBudgetBreakdown
                    ? `${jobBudgetBreakdown.budgetGross.toLocaleString("cs-CZ")} Kč`
                    : "0 Kč"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Poznámky a historie</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-4">
                <div className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Zakázka vytvořena</p>
                    <p className="text-xs text-muted-foreground">
                      {job.createdAt?.toDate
                        ? job.createdAt.toDate().toLocaleString("cs-CZ")
                        : "-"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Stav změněn na "{job.status}"</p>
                    <p className="text-xs text-muted-foreground">
                      {job.updatedAt?.toDate
                        ? job.updatedAt.toDate().toLocaleString("cs-CZ")
                        : "-"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {user && companyId && jobId ? (
            <JobMediaSection
              companyId={companyId}
              jobId={jobId as string}
              jobDisplayName={job?.name ?? null}
              user={user}
              canManageFolders={canManageFolders}
              photos={photos?.filter(isUsablePhotoRow) as PhotoDoc[] | undefined}
              uploadLegacyPhoto={handlePhotoUpload}
              legacyUploading={isUploading}
              onAnnotatePhoto={(target) => {
                setPhotoToEdit(target);
                setEditorOpen(true);
              }}
            />
          ) : null}
        </div>
      </div>
      </div>

      {user && companyId && jobId ? (
        <section
          className="w-full min-w-0 border-t border-border/60 bg-muted/15 py-8 sm:py-10"
          aria-labelledby="job-expenses-heading"
        >
          <div className="mx-auto w-full max-w-[min(100%,1600px)] px-4 sm:px-6 lg:px-8">
            <JobExpensesSection
              companyId={companyId}
              jobId={jobId as string}
              jobDisplayName={
                job?.name != null && String(job.name).trim() !== ""
                  ? String(job.name).trim()
                  : null
              }
              user={user}
              expenses={jobExpenses}
              canEdit={canManageFolders}
              jobBudget={jobBudgetBreakdown}
              layout="jobDetailWide"
            />
          </div>
        </section>
      ) : null}

      <Dialog
        open={editJobDialogOpen}
        onOpenChange={(open) => {
          setEditJobDialogOpen(open);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-4xl w-[95vw] sm:w-full max-h-[90vh] flex flex-col">
          <form
            onSubmit={saveJobEdit}
            className="flex flex-col flex-1 min-h-0"
          >
            <DialogHeader className="shrink-0">
              <DialogTitle>Upravit zakázku</DialogTitle>
              <DialogDescription>
                Změňte údaje a uložte je do databáze.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>Název zakázky</Label>
                  <Input
                    value={jobEditForm.name}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Název projektu"
                    className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[44px] md:min-h-10")}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Stav</Label>
                  <Select
                    value={jobEditForm.status}
                    onValueChange={(v) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        status: v,
                      }))
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        LIGHT_SELECT_TRIGGER_CLASS,
                        "min-h-[44px] md:min-h-10"
                      )}
                    >
                      <SelectValue placeholder="Vyberte stav" />
                    </SelectTrigger>
                    <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                      <SelectItem value="nová">Nová</SelectItem>
                      <SelectItem value="rozpracovaná">Rozpracovaná</SelectItem>
                      <SelectItem value="čeká">Čeká</SelectItem>
                      <SelectItem value="dokončená">Dokončená</SelectItem>
                      <SelectItem value="fakturována">Fakturována</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Typ ceny</Label>
                  <Select
                    value={jobEditForm.budgetType}
                    onValueChange={(v) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        budgetType: normalizeBudgetType(v),
                      }))
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        LIGHT_SELECT_TRIGGER_CLASS,
                        "min-h-[44px] md:min-h-10"
                      )}
                    >
                      <SelectValue placeholder="Bez / s DPH" />
                    </SelectTrigger>
                    <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                      <SelectItem value="net">Cena bez DPH</SelectItem>
                      <SelectItem value="gross">Cena s DPH</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Sazba DPH</Label>
                  <Select
                    value={jobEditForm.vatRate}
                    onValueChange={(v) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        vatRate: v,
                      }))
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        LIGHT_SELECT_TRIGGER_CLASS,
                        "min-h-[44px] md:min-h-10"
                      )}
                    >
                      <SelectValue placeholder="Vyberte sazbu" />
                    </SelectTrigger>
                    <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                      {VAT_RATE_OPTIONS.map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          {r} %
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Rozpočet (Kč)</Label>
                  <Input
                    type="number"
                    value={jobEditForm.budget}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        budget: e.target.value,
                      }))
                    }
                    placeholder={
                      jobEditForm.budgetType === "gross"
                        ? "Částka s DPH"
                        : "Částka bez DPH"
                    }
                    className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[44px] md:min-h-10")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Prázdné pole rozpočet v databázi odebere. Částka odpovídá typu
                    ceny.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Zahájeno</Label>
                  <Input
                    type="date"
                    value={jobEditForm.startDate}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        startDate: e.target.value,
                      }))
                    }
                    className={cn(
                      LIGHT_FORM_CONTROL_CLASS,
                      "[color-scheme:light] min-h-[44px] md:min-h-10"
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Předpokládané dokončení</Label>
                  <Input
                    type="date"
                    value={jobEditForm.endDate}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        endDate: e.target.value,
                      }))
                    }
                    className={cn(
                      LIGHT_FORM_CONTROL_CLASS,
                      "[color-scheme:light] min-h-[44px] md:min-h-10"
                    )}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Popis zakázky</Label>
                  <Textarea
                    value={jobEditForm.description}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Popis zakázky"
                    className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[120px]")}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="edit-job-tag">Typ / štítek zakázky</Label>
                  <select
                    id="edit-job-tag"
                    className={NATIVE_SELECT_CLASS}
                    value={jobEditForm.jobTag}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        jobTag: e.target.value,
                      }))
                    }
                  >
                    <option value="">Bez štítku</option>
                    {JOB_TAG_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                    <option value={JOB_TAG_CUSTOM_VALUE}>Vlastní…</option>
                  </select>
                  {jobEditForm.jobTag === JOB_TAG_CUSTOM_VALUE ? (
                    <Input
                      value={jobEditForm.jobTagCustom}
                      onChange={(e) =>
                        setJobEditForm((prev) => ({
                          ...prev,
                          jobTagCustom: e.target.value,
                        }))
                      }
                      placeholder="Vlastní typ zakázky"
                      className={cn(
                        LIGHT_FORM_CONTROL_CLASS,
                        "mt-2 min-h-[44px] md:min-h-10"
                      )}
                    />
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>Měření</Label>
                  <Textarea
                    value={jobEditForm.measuring}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        measuring: e.target.value,
                      }))
                    }
                    placeholder="Text měření"
                    className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[120px]")}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Podrobnosti měření</Label>
                  <Textarea
                    value={jobEditForm.measuringDetails}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        measuringDetails: e.target.value,
                      }))
                    }
                    placeholder="Další informace k měření"
                    className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[120px]")}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Zákazník</Label>
                  <Select
                    value={jobEditForm.customerId || "none"}
                    onValueChange={(v) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        customerId: v === "none" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        LIGHT_SELECT_TRIGGER_CLASS,
                        "min-h-[44px] md:min-h-10"
                      )}
                    >
                      <SelectValue placeholder="Vyberte zákazníka" />
                    </SelectTrigger>
                    <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                      <SelectItem value="none">Bez zákazníka</SelectItem>
                      {customers?.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.companyName ||
                            `${c.firstName || ""} ${c.lastName || ""}`.trim() ||
                            "Neznámý zákazník"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Přiřazení zaměstnanci (UID, oddělené čárkou)</Label>
                  <Input
                    value={jobEditForm.assignedEmployeeIdsText}
                    onChange={(e) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        assignedEmployeeIdsText: e.target.value,
                      }))
                    }
                    placeholder="Např. uid1, uid2"
                    className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[44px] md:min-h-10")}
                  />
                </div>
              </div>

              {job?.templateId && template && (
                <div className="space-y-3">
                  <Label>Hodnoty šablony</Label>
                  <div className="rounded-md border border-gray-300 bg-white p-3">
                    <JobTemplateFormFields
                      template={template as JobTemplate}
                      values={jobEditTemplateValues}
                      onChange={(v) => setJobEditTemplateValues(v)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-between gap-3 shrink-0 px-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditJobDialogOpen(false)}
                disabled={isSavingJobEdit}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Zrušit
              </Button>

              <Button
                type="submit"
                disabled={isSavingJobEdit}
                className="min-h-[44px] w-full sm:w-auto"
              >
                {isSavingJobEdit ? "Ukládání..." : "Uložit změny"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={contractDialogOpen}
        onOpenChange={(open) => {
          setContractDialogOpen(open);
          if (!open) setIsContractDirty(false);
        }}
      >
        <DialogContent className="max-w-[95vw] w-[95vw] md:w-[760px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {isContractReadOnly ? "Zobrazení smlouvy o dílo" : "Vytvořit smlouvu o dílo"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label className="text-slate-900 shrink-0">Vybrat šablonu</Label>
                {!isContractReadOnly && (
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-[40px] w-full sm:w-auto bg-orange-500 hover:bg-orange-600 text-white border-0 shadow-sm"
                    onClick={() => setWorkContractTemplatesManagerOpen(true)}
                  >
                    Šablony SOD
                  </Button>
                )}
              </div>
              <select
                id="work-contract-template-select"
                value={selectedWorkContractTemplateId}
                disabled={isContractReadOnly}
                aria-busy={
                  isWorkContractTemplatesLoading || isContractTemplatesLoading
                }
                onChange={(e) => {
                  if (isContractReadOnly) return;
                  handleLoadWorkContractTemplate(e.target.value);
                }}
                className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="__new__">
                  {isWorkContractTemplatesLoading || isContractTemplatesLoading
                    ? "Načítání..."
                    : "Vytvořit od začátku"}
                </option>
                {(contractTemplates || [])
                  .filter((t: any) => t.companyId === companyId)
                  .map((t: any) => (
                    <option key={t.id} value={`ct:${t.id}`}>
                      {t.name || "Bez názvu"}
                    </option>
                  ))}
                {workContractTemplates
                  ?.filter(
                    (t: any) =>
                      !t.contractType || t.contractType === "smlouva_o_dilo"
                  )
                  ?.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.templateName || "Bez názvu"} (dřívější úložiště)
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Číslo smlouvy</Label>
                <Input
                  value={contractForm.contractNumber}
                  readOnly
                  placeholder="Přidělí se při uložení"
                  className="font-mono bg-muted/40 text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label>Datum smlouvy (tisk / VS)</Label>
                <Input
                  value={contractForm.contractDateLabel}
                  readOnly
                  placeholder="—"
                  className="bg-muted/40 text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Název šablony</Label>
              <Input
                value={contractForm.templateName}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    templateName: e.target.value,
                  }));
                }}
                placeholder="Např. Smlouva o dílo - standard"
                disabled={isContractReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label>Hlavička smlouvy</Label>
              <Textarea
                value={contractForm.contractHeader}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    contractHeader: e.target.value,
                  }));
                }}
                placeholder="Hlavička smlouvy"
                className="min-h-[120px] resize-y"
                disabled={isContractReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label>Text smlouvy</Label>
              <Textarea
                value={contractForm.mainContractContent}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    mainContractContent: e.target.value,
                  }));
                }}
                placeholder="Vložte text smlouvy..."
                className="min-h-[260px] resize-y"
                disabled={isContractReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label>Objednatel</Label>
              <Textarea
                value={contractForm.client}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    client: e.target.value,
                  }));
                }}
                placeholder="Objednatel (firma/jméno + adresa)"
                className="min-h-[120px] resize-y"
                disabled={isContractReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label>Dodavatel</Label>
              <Textarea
                value={contractForm.contractor}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    contractor: e.target.value,
                  }));
                }}
                placeholder="Zhotovitel (firma + adresa)"
                className="min-h-[120px] resize-y"
                disabled={isContractReadOnly}
              />
            </div>

            <div className="space-y-2">
              <Label>Výše zálohy v procentech (%)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={contractForm.depositPercentage}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    depositPercentage: e.target.value,
                  }));
                }}
                onBlur={(e) => {
                  const raw = e.target.value;
                  const p = parsePercentValue(raw);
                  setContractForm((prev) => ({
                    ...prev,
                    depositPercentage:
                      raw.trim() === ""
                        ? ""
                        : p != null
                          ? String(p)
                          : raw.trim(),
                    depositAmount:
                      p != null && jobBudgetKc != null
                        ? String(Math.round((jobBudgetKc * p) / 100))
                        : prev.depositAmount,
                  }));
                }}
                placeholder="Např. 30 nebo 30 %"
                disabled={isContractReadOnly}
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label>Částka zálohy (Kč)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={contractForm.depositAmount}
                onChange={(e) => {
                  const raw = e.target.value;
                  setIsContractDirty(true);
                  if (/%/.test(raw)) {
                    const p = parsePercentValue(raw);
                    setContractForm((prev) => ({
                      ...prev,
                      depositPercentage:
                        p != null ? String(p) : prev.depositPercentage,
                      depositAmount:
                        p != null && jobBudgetKc != null
                          ? String(Math.round((jobBudgetKc * p) / 100))
                          : "",
                    }));
                    return;
                  }
                  setContractForm((prev) => ({
                    ...prev,
                    depositAmount: raw,
                  }));
                }}
                onBlur={(e) => {
                  const raw = e.target.value;
                  const n = parseAmountKc(raw);
                  setContractForm((prev) => {
                    if (n == null || raw.trim() === "" || /%/.test(raw)) {
                      return prev;
                    }
                    const pct = parsePercentValue(prev.depositPercentage);
                    const fromPct =
                      pct != null && jobBudgetKc != null
                        ? Math.round((jobBudgetKc * pct) / 100)
                        : null;
                    if (fromPct != null && fromPct === n) {
                      return prev;
                    }
                    return { ...prev, depositPercentage: "" };
                  });
                }}
                placeholder={
                  jobBudgetKc != null
                    ? "Částka nebo % (např. 30 %)"
                    : "Zadejte částku ručně nebo % s rozpočtem"
                }
                disabled={isContractReadOnly}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Můžete zadat částku nebo procenta (např. 30 %).
              </p>
              {depositValidationError ? (
                <p className="text-xs text-destructive font-medium mt-1">
                  {depositValidationError}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground mt-1">
                Záloha (přepočet):{" "}
                <span className="font-medium text-foreground">
                  {formatWorkContractAmountKcFromNumber(
                    depositAndDoplatekPreview.depKc
                  )}
                </span>
                {" · "}Doplatek:{" "}
                <span className="font-medium text-foreground">
                  {depositAndDoplatekPreview.doplatekFormatted}
                </span>
              </p>
              {jobBudgetKc == null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Rozpočet zakázky není vyplněný, zálohu je potřeba doplnit ručně.
                  Pro přepočet z procent je potřeba rozpočet zakázky.
                </p>
              )}
            </div>

            <div className="space-y-2">
              {bankAccounts && bankAccounts.length > 1 ? (
                <div className="space-y-2">
                  <Label>Vybraný firemní účet</Label>
                  <Select
                    value={
                      contractForm.bankAccountId &&
                      (bankAccounts || []).some(
                        (a) => a.id === contractForm.bankAccountId
                      )
                        ? contractForm.bankAccountId
                        : "__manual__"
                    }
                    onValueChange={(v) => {
                      setIsContractDirty(true);
                      if (isContractReadOnly) return;
                      if (v === "__manual__") {
                        setContractForm((prev) => ({
                          ...prev,
                          bankAccountId: null,
                        }));
                        return;
                      }

                      const nextAcc = (bankAccounts || []).find(
                        (a) => a.id === v
                      );
                      if (!nextAcc) return;

                      const nextBankAccountNumber =
                        formatCompanyBankAccountNumber(nextAcc);
                      const nextContractor = deriveContractorText(
                        companyDoc,
                        companyNameFromDoc,
                        nextAcc
                      );

                      setContractForm((prev) => ({
                        ...prev,
                        bankAccountId: v,
                        bankAccountNumber: nextBankAccountNumber,
                        contractor: nextContractor,
                      }));
                    }}
                    disabled={isContractReadOnly}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Vyberte účet" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="__manual__">
                        Vlastní / ručně
                      </SelectItem>
                      {(bankAccounts || []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {formatCompanyBankAccountDisplay(a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Číslo účtu</Label>
                <Input
                  value={contractForm.bankAccountNumber}
                  onChange={(e) => {
                    setIsContractDirty(true);
                    setContractForm((prev) => ({
                      ...prev,
                      bankAccountNumber: e.target.value,
                      bankAccountId: null,
                    }));
                  }}
                  placeholder="Např. 123456789/0300 nebo IBAN"
                  disabled={isContractReadOnly || !!contractForm.bankAccountId}
                  className="bg-background"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Doplňující informace</Label>
              <Textarea
                value={contractForm.additionalInfo}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    additionalInfo: e.target.value,
                  }));
                }}
                placeholder="Volitelné doplňující informace (můžete použít i proměnné)"
                className="min-h-[120px] resize-y"
                disabled={isContractReadOnly}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Podpora proměnných v textu:{" "}
              <code>{"{{dodavatel.nazev}}"}</code>, <code>{"{{dodavatel.ico}}"}</code>,{" "}
              <code>{"{{objednatel.nazev}}"}</code>, <code>{"{{zakazka.nazev}}"}</code>,{" "}
              <code>{"{{datum}}"}</code> (lze i <code>{"{{dodavatel}}"}</code> a{" "}
              <code>{"{{objednatel}}"}</code>).
              <br />
              Záloha: <code>{"{{zaloha.procenta}}"}</code>, <code>{"{{zaloha.castka}}"}</code>,{" "}
              <code>{"{{zalohova_castka}}"}</code>, <code>{"{{zalohova_procenta}}"}</code>,{" "}
              <code>{"{{doplatek}}"}</code>, <code>{"{{zaloha.ucet}}"}</code>.
              <br />
              Číslo dokumentu: <code>{"{{smlouva.cislo}}"}</code>,{" "}
              <code>{"{{smlouva.vs}}"}</code> (stejné jako číslo),{" "}
              <code>{"{{smlouva.datum}}"}</code>.
              <br />
              Data šablony zakázky (přehled polí):{" "}
              <code>{"{{data_sablony}}"}</code>.
              <br />
              Firma / zakázka: <code>{"{{nazev_firmy}}"}</code>,{" "}
              <code>{"{{ico}}"}</code>, <code>{"{{dic}}"}</code>,{" "}
              <code>{"{{adresa}}"}</code>, <code>{"{{cislo_uctu_firmy}}"}</code>,{" "}
              <code>{"{{variabilni_symbol}}"}</code>, <code>{"{{jmeno_zakaznika}}"}</code>,{" "}
              <code>{"{{nazev_zakazky}}"}</code>, <code>{"{{cena}}"}</code>,{" "}
              <code>{"{{zalohova_castka}}"}</code>, <code>{"{{zalohova_procenta}}"}</code>,{" "}
              <code>{"{{doplatek}}"}</code>, <code>{"{{datum}}"}</code>.
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setContractDialogOpen(false)}
              disabled={isSavingTemplate || isSavingContract || isGeneratingPdf}
              className="min-h-[44px]"
            >
              Zrušit
            </Button>

            <div className="flex gap-2 flex-wrap justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={saveContract}
              disabled={
                isContractReadOnly ||
                isSavingTemplate ||
                isSavingContract ||
                isGeneratingPdf
              }
                className="min-h-[44px]"
              >
                {isSavingContract ? "Ukládání..." : "Uložit smlouvu"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={saveTemplate}
              disabled={
                isContractReadOnly ||
                isSavingTemplate ||
                isSavingContract ||
                isGeneratingPdf
              }
                className="min-h-[44px]"
              >
                {isSavingTemplate
                  ? "Ukládání..."
                  : selectedWorkContractTemplateId !== "__new__"
                  ? "Uložit změny šablony"
                  : "Uložit šablonu"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={previewWorkContractDocument}
                disabled={isSavingTemplate || isSavingContract || isGeneratingPdf}
                className="min-h-[44px]"
              >
                Náhled dokumentu
              </Button>
              <Button
                type="button"
                onClick={generatePDF}
                disabled={isSavingTemplate || isSavingContract || isGeneratingPdf}
                className="min-h-[44px]"
              >
                {isGeneratingPdf ? "Generování..." : "PDF / tisk"}
              </Button>

              {selectedWorkContractTemplateId !== "__new__" && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={deleteTemplate}
                disabled={
                  isContractReadOnly ||
                  isSavingTemplate ||
                  isSavingContract ||
                  isGeneratingPdf
                }
                  className="min-h-[44px]"
                >
                  Smazat šablonu
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <WorkContractTemplatesManagerDialog
        open={workContractTemplatesManagerOpen}
        onOpenChange={setWorkContractTemplatesManagerOpen}
        firestore={firestore}
        companyId={companyId}
        userId={user?.uid}
      />

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setPhotoToEdit(null);
            resetAnnotationState();
          }
        }}
      >
        <DialogContent className="!flex !max-h-[min(92dvh,92vh)] !h-[min(92dvh,92vh)] !w-[min(95vw,1920px)] !max-w-[min(95vw,1920px)] !flex-col !gap-0 !overflow-hidden overscroll-contain p-2 sm:p-3 md:p-4 sm:!max-w-[min(95vw,1920px)] sm:!w-[min(95vw,1920px)] md:!max-w-[min(95vw,1920px)] md:!w-[min(95vw,1920px)]">
          <DialogHeader className="shrink-0 space-y-1 pb-2 pr-8 text-left">
            <DialogTitle className="text-base sm:text-lg">
              Anotace fotografie
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
            <div className="shrink-0 space-y-1.5 sm:space-y-2">
              <p className="text-xs leading-snug text-muted-foreground sm:text-sm sm:leading-normal">
                Kóty: tažením čáry, poté zadejte hodnotu. Poznámka: táhněte
                průhledný obdélník a doplňte text (bez šipky). Výběr: klikněte na
                kótu nebo poznámku — přesun, úprava textu, konce čáry nebo cíle
                šipky, změna velikosti poznámky tahem za roh. Dotyk i myš.
              </p>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <Button
                  type="button"
                  variant={activeTool === "dimension" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("dimension")}
                >
                  Kóty
                </Button>
                <Button
                  type="button"
                  variant={activeTool === "note" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("note")}
                >
                  Poznámka
                </Button>
                <Button
                  type="button"
                  variant={activeTool === "select" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("select")}
                >
                  Výběr
                </Button>

                <Separator orientation="vertical" className="mx-0.5 hidden h-6 sm:mx-1 md:inline-block" />

                {(
                  [
                    { id: "red", label: "Červená" },
                    { id: "yellow", label: "Žlutá" },
                    { id: "white", label: "Bílá" },
                    { id: "black", label: "Černá" },
                    { id: "blue", label: "Modrá" },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => updateSelectedColor(c.id)}
                    className={`h-9 w-9 rounded-md border ${
                      activeColor === c.id
                        ? "ring-2 ring-primary ring-offset-2"
                        : ""
                    }`}
                    style={{
                      backgroundColor: colorToHex(c.id),
                      borderColor:
                        c.id === "white" ? "rgba(0,0,0,0.35)" : "transparent",
                    }}
                  />
                ))}

                <Separator orientation="vertical" className="mx-0.5 hidden h-6 sm:mx-1 md:inline-block" />

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={editSelectedText}
                  disabled={!selectedAnnotationId}
                >
                  Upravit text
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={deleteSelectedAnnotation}
                  disabled={!selectedAnnotationId}
                >
                  Smazat
                </Button>
              </div>
            </div>

            <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md border bg-black/80 p-0.5 sm:p-1">
              <canvas
                ref={setCanvasNode}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={() => {
                  setDragMode("none");
                  setDragLastPoint(null);
                  setNoteRectDraft(null);
                  setDraftAnnotationId(null);
                }}
                className={`h-auto w-auto max-h-full max-w-full object-contain touch-none ${
                  baseImageLoaded ? "opacity-100" : "opacity-0"
                }`}
                style={{ cursor: canvasCursor }}
              />

              {!baseImageLoaded && !imageError && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-black/40 pointer-events-none">
                  Načítání fotografie...
                </div>
              )}

              {imageError && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-red-500 text-center bg-black/70">
                  <div className="space-y-2">
                    <p>{imageError}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      URL: {annotationSource || "neznámé"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2 pb-0.5 sm:pt-2.5">
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={undoLast}
                  disabled={!annotations.length}
                >
                  Zpět
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={clearAllAnnotations}
                  disabled={!annotations.length}
                >
                  Vymazat vše
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="min-h-[36px]"
                  onClick={() => setEditorOpen(false)}
                >
                  Zrušit
                </Button>

                <Button
                  className="min-h-[36px]"
                  onClick={handleSaveAnnotated}
                  disabled={!baseImageLoaded}
                >
                  Uložit anotaci
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}