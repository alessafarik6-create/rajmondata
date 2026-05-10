"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  uploadMeasurementPhotoBlobViaFirebaseSdk,
  uploadMeasurementPhotoFileViaFirebaseSdk,
} from "@/lib/job-photo-upload";
import { renderPdfPagesToPngBlobs } from "@/lib/pdf-to-image-client";
import { withTimeout } from "@/lib/async-with-timeout";
import {
  isAllowedJobMediaFile,
  isAllowedJobImageFile,
  getJobMediaFileTypeFromFile,
  getJobMediaPreviewUrl,
  formatMediaDate,
  type JobPhotoAnnotationTarget,
} from "@/lib/job-media-types";
import { JobMediaSection } from "@/components/jobs/job-media-section";
import { JobCustomerProgressAdminSection } from "@/components/jobs/job-customer-progress-admin-section";
import { JobCustomerTasksAdminSection } from "@/components/jobs/job-customer-tasks-admin-section";
import { JobProductCatalogsSection } from "@/components/jobs/job-product-catalogs-section";
import {
  buildJobMediaMirrorAnnotatedUrlPatch,
  buildNewJobFolderImageMirrorDocument,
  buildNewJobLegacyPhotoMirrorDocument,
  companyDocumentRefForJobFolderImage,
  companyDocumentRefForJobLegacyPhoto,
} from "@/lib/job-linked-document-sync";
import { JobExpensesSection } from "@/components/jobs/job-expenses-section";
import { JobBillingInvoicesSection } from "@/components/jobs/job-billing-invoices-section";
import { JobCommentsThread } from "@/components/jobs/job-comments-thread";
import { JobDocumentEmailSection } from "@/components/jobs/job-document-email-section";
import { JobTasksSection } from "@/components/jobs/job-tasks-section";
import { JobMaterialOrdersSection } from "@/components/jobs/job-material-orders-section";
import { JobProductionTeamSection } from "@/components/jobs/job-production-team-section";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { canAccessCompanyModule } from "@/lib/platform-access";
import { isCompanyPrivileged } from "@/lib/company-privilege";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
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
  addDoc,
  Timestamp,
  limit,
} from "firebase/firestore";
import {
  User,
  Trash2,
  Calendar,
  Users,
  Clock,
  ChevronLeft,
  ChevronRight,
  Edit2,
  FileText,
  FileStack,
  MapPin,
  Loader2,
  Camera,
  ImagePlus,
  FolderInput,
  Factory,
  RotateCcw,
  Hand,
  ZoomIn,
  ZoomOut,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useIsBelowLg } from "@/hooks/use-mobile";
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
import { getJobCustomerPortalPreviewGate } from "@/lib/job-customer-portal-preview";
import { JD } from "@/lib/job-detail-page-styles";
import { logActivitySafe, type ActivityActorProfile } from "@/lib/activity-log";
import { JobMeetingRecordsSection } from "@/components/meeting-records/job-meeting-records-section";
import {
  staffCanEditMeetingRecords,
  staffCanViewMeetingRecords,
} from "@/lib/meeting-records-access";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  resolveJobPaidFromFirestore,
  roundMoney2,
  VAT_RATE_OPTIONS,
  type JobBudgetType,
} from "@/lib/vat-calculations";
import {
  allocateNextSeriesContractNumber,
  allocateNextSodContractNumber,
} from "@/lib/work-contract-counter";
import {
  applyWorkContractTemplateVariables,
  buildWorkContractPrintHtmlString,
  formatCsDateFromFirestore,
  parentContractKindLabelFromDoc,
  type WorkContractBankAccountLike,
  type WorkContractDoc,
  type WorkContractForm,
  type WorkContractPrintHtmlBuildContext,
  workContractDocToForm,
} from "@/lib/work-contract-print-html-build";
import { formatJobTemplateDataPlainText } from "@/lib/work-contract-job-template-data";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ref, getDownloadURL, deleteObject, getBlob } from "firebase/storage";
import { FirebaseError } from "firebase/app";
import Link from "next/link";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  buildArrowNoteLegendEntries,
  deserializeJobPhotoAnnotations,
  formatMeasuredMmCs,
  nextArrowNoteNumber,
  readAnnotationPayloadFromPhotoDoc,
  readAnnotationPayloadReferenceSize,
  readImageCalibrationFromPayload,
  serializeJobPhotoAnnotations,
  syncShapeLabelLegendNumbers,
  type DimensionColor,
  type JobPhotoAnnotation as Annotation,
  type JobPhotoArrowNoteAnnotation as ArrowNoteAnnotation,
  type JobPhotoDimensionAnnotation as DimensionAnnotation,
  type JobPhotoMeterAnnotation as MeterAnnotation,
  type JobPhotoNoteAnnotation as NoteAnnotation,
  type JobPhotoShapeLabelAnnotation as ShapeLabelAnnotation,
} from "@/lib/job-photo-annotations";
import { removeUndefinedDeep } from "@/lib/firestore-clean-payload";
import {
  computeNoteLayout,
  drawNoteAnnotationOnCanvas,
  noteResizeHandleSize,
} from "@/lib/job-photo-annotation-canvas";
import {
  MEASUREMENT_PHOTO_SOURCE_TYPE,
  isMeasurementPhotoUnassignedForJob,
} from "@/lib/measurement-photos";
import {
  MEASUREMENT_PHOTO_ANNOTATE_PAGE_PATH,
  MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID,
} from "@/lib/measurement-photo-pending-route";
import { sanitizeMeasurementEditorReturnTo } from "@/lib/measurement-photo-editor-return";
import {
  clearPendingJobMeasurementFile,
  peekPendingJobMeasurementFile,
} from "@/lib/pending-job-measurement-photo-idb";
import {
  screenToDocumentPoint,
  screenToDocumentPointClamped,
} from "@/lib/annotation-document-coords";
import {
  buildLegendFromShapeLabels,
  drawShapeLabelOnCanvas,
  drawLegendStrip,
  estimateLegendStripHeight,
  formatLegendEntryLine,
  hitTestShapeLabel,
} from "@/lib/job-photo-shape-label";
import { AnnotationModelsSettingsDialog } from "@/components/annotations/annotation-models-settings-dialog";
import { UnifiedAnnotationEditor } from "@/components/annotations/UnifiedAnnotationEditor";
import {
  dimensionColorFromModelColor,
  type AnnotationModelDoc,
} from "@/lib/annotation-models";
import {
  effectiveShapeLabelMm,
  shapeLabelAnnotationPixelRect,
} from "@/lib/shape-label-mm-scale";

type AnnotationTool =
  | "dimension"
  | "note"
  | "arrow"
  | "select"
  | "pan"
  | "shapeLabel"
  | "meter"
  | "calibrate";

type DragMode =
  | "none"
  | "dim-start"
  | "dim-end"
  | "dim-move"
  | "dim-draw"
  | "note-target"
  | "note-box"
  | "note-rect-draw"
  | "note-resize-br"
  | "shape-move"
  | "shape-resize-br"
  | "view-pan"
  | "meter-draw"
  | "meter-start"
  | "meter-end"
  | "meter-move"
  | "calibration-draw"
  | "arrow-draw"
  | "arrow-start"
  | "arrow-end"
  | "arrow-move";

type AnnotationPinchSession = {
  anchorDist: number;
  anchorZoom: number;
  anchorPanX: number;
  anchorPanY: number;
  anchorMidX: number;
  anchorMidY: number;
};

const PDF_EDITOR_SCALE_MIN = 0.5;
const PDF_EDITOR_SCALE_MAX = 4;
const PDF_EDITOR_SCALE_STEP = 0.25;
/** Min. zoom náhledu u obrázku (CSS); anotace v pixelech dokumentu. */
const ANNOTATION_VIEW_ZOOM_MIN = 0.25;
const ANNOTATION_VIEW_ZOOM_MAX = 10;

function clampPdfScale(s: number): number {
  const stepped = Math.round(s / PDF_EDITOR_SCALE_STEP) * PDF_EDITOR_SCALE_STEP;
  return Math.min(
    PDF_EDITOR_SCALE_MAX,
    Math.max(PDF_EDITOR_SCALE_MIN, stepped)
  );
}

function annotationTargetLooksPdf(
  pe: JobPhotoAnnotationTarget | null,
  resolvedUrl: string
): boolean {
  if (!pe) return false;
  if (pe.fileType === "pdf") return true;
  const n = `${pe.fileName || ""} ${pe.name || ""}`.toLowerCase();
  if (n.includes(".pdf")) return true;
  if (/\.pdf(\?|#|$)/i.test(resolvedUrl)) return true;
  return false;
}

async function loadPdfJsForAnnotationEditor() {
  const pdfjs = await import("pdfjs-dist");
  const { configurePdfJsWorker } = await import("@/lib/pdfjs-worker");
  configurePdfJsWorker(pdfjs);
  return pdfjs;
}

type ContractOpenPreset = "sod_work" | "new_contract" | "new_addendum" | "new_attachment";

function workContractDisplayTitle(c: WorkContractDoc): string {
  const t = String(c.documentTitle ?? c.title ?? "").trim();
  if (t) return t;
  const tn = String(c.templateName ?? "").trim();
  if (tn) return tn;
  const first = String(c.contractHeader ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (first) return first;
  return "Dokument";
}

function workContractDisplayTypeLabel(c: WorkContractDoc): string {
  const role = String(c.documentRole ?? "").trim();
  if (role === "addendum") return "Dodatek";
  if (role === "attachment") return "Příloha ke smlouvě";
  return "Smlouva";
}

const EMPTY_CONTRACT_FORM_FIELDS: Pick<
  WorkContractForm,
  | "documentTitle"
  | "documentRole"
  | "documentSubtype"
  | "parentContractId"
  | "parentContractNumber"
  | "parentContractTitle"
  | "attachmentOrdinal"
  | "numberSeriesPrefix"
> = {
  documentTitle: "",
  documentRole: "contract",
  documentSubtype: "work_contract",
  parentContractId: "",
  parentContractNumber: "",
  parentContractTitle: "",
  attachmentOrdinal: 0,
  numberSeriesPrefix: "SOD",
};

type JobCustomerInputMode = "list" | "manual";

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
  /** Vybrat ze seznamu vs. nový zákazník (ruční záznam do kolekce customers). */
  customerInputMode: JobCustomerInputMode;
  manualCustomerCompanyName: string;
  manualCustomerAddress: string;
  manualCustomerEmail: string;
  manualCustomerPhone: string;
  manualCustomerNotes: string;
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

/** Rozměr dokumentu v px (stejný prostor jako souřadnice anotací). */
function readAnnotationDocumentDimensions(
  canvas: HTMLCanvasElement | null,
  mediaKind: "image" | "pdf",
  pdfScale: number,
  imageFallback: HTMLImageElement | null
): { docW: number; docH: number } {
  if (canvas) {
    if (mediaKind === "pdf") {
      const s = Math.max(1e-6, pdfScale);
      return {
        docW: Math.max(1, canvas.width / s),
        docH: Math.max(1, canvas.height / s),
      };
    }
    return {
      docW: Math.max(1, canvas.width),
      docH: Math.max(1, canvas.height),
    };
  }
  if (imageFallback) {
    const w = imageFallback.naturalWidth || imageFallback.width;
    const h = imageFallback.naturalHeight || imageFallback.height;
    return { docW: Math.max(1, w), docH: Math.max(1, h) };
  }
  return { docW: 1, docH: 1 };
}

function getPhotoStorageFullPath(
  p: PhotoDoc | JobPhotoAnnotationTarget
): string {
  const raw = p as PhotoDoc & Record<string, unknown>;
  const candidates = [raw.storagePath, raw.path, raw.fullPath];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function firstTrimmedString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Do Firestore se někdy omylem uloží blob: — po navigaci nefunguje; pro trvalý editor ignorovat. */
function isEphemeralObjectMediaUrl(s: string | null | undefined): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  return t.startsWith("blob:") || t.startsWith("data:");
}

function stripEphemeralMediaUrl(
  s: string | undefined | null
): string | undefined {
  if (!s?.trim()) return undefined;
  const t = s.trim();
  if (isEphemeralObjectMediaUrl(t)) return undefined;
  return t;
}

/** První neprázdný řetězec, který po vyhození `blob:`/`data:` zůstane platný (např. `imageUrl` je blob, `fileUrl` je HTTPS). */
function firstPersistedHttpString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const s = stripEphemeralMediaUrl(
      typeof v === "string" && v.trim() ? v.trim() : undefined
    );
    if (s) return s;
  }
  return undefined;
}

function pickNonHttpStoragePath(pe: JobPhotoAnnotationTarget): string | undefined {
  for (const p of [
    pe.storagePath,
    pe.path,
    pe.fullPath,
    pe.annotatedStoragePath,
  ]) {
    if (typeof p !== "string" || !p.trim()) continue;
    const t = p.trim();
    if (isEphemeralObjectMediaUrl(t)) continue;
    if (t.startsWith("http://") || t.startsWith("https://")) continue;
    return t;
  }
  return undefined;
}

/**
 * Stejné pole jako při `onAnnotatePhoto` u fotodokumentace — žádné sloučení do jedné URL,
 * ať `annotationSource` a Storage blob větev fungují stejně jako u `photos` / `folderImages`.
 * Plné rozlišení: nejdřív originál / imageUrl / download, ne až thumbnail.
 */
function measurementDocToAnnotationTarget(
  row: Record<string, unknown> & { id: string }
): JobPhotoAnnotationTarget {
  const annotatedImageUrl =
    stripEphemeralMediaUrl(firstTrimmedString(row.annotatedImageUrl)) ||
    undefined;
  const downloadURL =
    stripEphemeralMediaUrl(firstTrimmedString(row.downloadURL)) || undefined;
  const urlRaw = firstTrimmedString(row.url) || undefined;
  const fileUrlRaw = firstTrimmedString(row.fileUrl) || undefined;
  const url =
    stripEphemeralMediaUrl(urlRaw) ||
    stripEphemeralMediaUrl(fileUrlRaw) ||
    undefined;
  const fileUrl = stripEphemeralMediaUrl(fileUrlRaw) || undefined;
  const storagePath = firstTrimmedString(row.storagePath) || undefined;
  const path = firstTrimmedString(row.path) || undefined;
  const fullPath = firstTrimmedString(row.fullPath) || undefined;

  let originalImageUrl =
    firstPersistedHttpString(row.originalImageUrl, row.imageUrl, row.fileUrl) ||
    undefined;
  let imageUrl =
    firstPersistedHttpString(row.imageUrl, row.fileUrl, row.originalImageUrl) ||
    undefined;

  if (!originalImageUrl && imageUrl) originalImageUrl = imageUrl;
  if (!imageUrl && originalImageUrl) imageUrl = originalImageUrl;

  if (!originalImageUrl && !imageUrl) {
    const fromUrls =
      firstPersistedHttpString(urlRaw, fileUrlRaw) || downloadURL || undefined;
    originalImageUrl = fromUrls;
    imageUrl = fromUrls;
  }

  const thumbFallback =
    stripEphemeralMediaUrl(
      firstTrimmedString(row.thumbUrl, row.thumbnailUrl, row.thumbURL)
    ) || undefined;
  const hasStorageHint = Boolean(storagePath || path || fullPath);
  if (
    !hasStorageHint &&
    !originalImageUrl &&
    !imageUrl &&
    thumbFallback
  ) {
    imageUrl = thumbFallback;
    originalImageUrl = thumbFallback;
  }

  const fileName = firstTrimmedString(row.fileName, row.name) || undefined;

  return {
    id: row.id,
    imageUrl,
    originalImageUrl,
    annotatedImageUrl,
    storagePath,
    path: path || undefined,
    fullPath: fullPath || undefined,
    annotatedStoragePath:
      stripEphemeralMediaUrl(firstTrimmedString(row.annotatedStoragePath)) ||
      undefined,
    downloadURL,
    url,
    fileUrl,
    fileName,
    name: typeof row.name === "string" ? row.name : undefined,
    annotationData: row.annotationData,
    annotationTarget: { kind: "measurementPhotos" },
    measurementPhotoId: row.id,
    fileType: "image",
  };
}

function pickMeasurementAnnotationSourceString(
  pe: JobPhotoAnnotationTarget
): string | null {
  const rawPayload = readAnnotationPayloadFromPhotoDoc(
    pe as Record<string, unknown>
  );
  const hasVectorLayer = rawPayload != null;
  const storageFallback = pickNonHttpStoragePath(pe);
  const httpAnnotatedFirst = () =>
    firstPersistedHttpString(
      pe.annotatedImageUrl,
      pe.imageUrl,
      pe.fileUrl,
      pe.originalImageUrl,
      pe.url,
      pe.downloadURL
    );
  const httpOriginalFirst = () =>
    firstPersistedHttpString(
      pe.originalImageUrl,
      pe.imageUrl,
      pe.fileUrl,
      pe.annotatedImageUrl,
      pe.url,
      pe.downloadURL
    );
  if (!hasVectorLayer) {
    return httpAnnotatedFirst() || storageFallback || null;
  }
  return httpOriginalFirst() || storageFallback || null;
}

function measurementPhotoRowHasEphemeralButNoStorage(
  row: Record<string, unknown>
): boolean {
  if (
    firstTrimmedString(
      row.storagePath,
      row.path,
      row.fullPath,
      row.annotatedStoragePath
    )
  ) {
    return false;
  }
  const fields = [
    row.imageUrl,
    row.fileUrl,
    row.url,
    row.downloadURL,
    row.annotatedImageUrl,
    row.originalImageUrl,
  ];
  return fields.some(
    (v) => typeof v === "string" && isEphemeralObjectMediaUrl(v)
  );
}

function annotationTargetHasResolvableUrl(t: JobPhotoAnnotationTarget | null): boolean {
  if (!t) return false;
  const pending =
    Boolean(t.id?.startsWith("pending-")) &&
    (Boolean(t.pendingObjectUrl) ||
      Boolean(t.pendingLocalFile) ||
      Boolean(t.imageUrl && isEphemeralObjectMediaUrl(t.imageUrl)));
  if (pending) {
    return Boolean(
      t.pendingObjectUrl ||
        t.pendingLocalFile ||
        t.imageUrl ||
        t.originalImageUrl
    );
  }
  const httpOk = (u: string | undefined) =>
    Boolean(u?.trim()) && !isEphemeralObjectMediaUrl(u);
  if (
    httpOk(t.annotatedImageUrl) ||
    httpOk(t.imageUrl) ||
    httpOk(t.originalImageUrl) ||
    httpOk(t.url) ||
    httpOk(t.fileUrl) ||
    httpOk(t.downloadURL)
  ) {
    return true;
  }
  for (const p of [
    t.storagePath,
    t.path,
    t.fullPath,
    t.annotatedStoragePath,
  ]) {
    if (typeof p === "string" && p.trim() && !isEphemeralObjectMediaUrl(p)) {
      return true;
    }
  }
  return false;
}

function resolveMeasurementPhotoRowForEditorLog(row: Record<string, unknown>): {
  annotatedUrl?: string;
  imageUrl?: string;
  fileUrl?: string;
  downloadUrl?: string;
  storageUrl?: string;
  thumbnailUrl?: string;
  resolvedImageUrl: string;
} {
  const annotatedUrl = firstTrimmedString(row.annotatedImageUrl) || undefined;
  const imageUrl =
    firstTrimmedString(row.imageUrl, row.originalImageUrl) || undefined;
  const fileUrl = firstTrimmedString(row.fileUrl) || undefined;
  const downloadUrl = firstTrimmedString(row.downloadURL) || undefined;
  const storageUrl =
    firstTrimmedString(row.storagePath, row.path, row.fullPath) || undefined;
  const thumbnailUrl =
    firstTrimmedString(row.thumbUrl, row.thumbnailUrl, row.thumbURL) ||
    undefined;
  const resolvedImageUrl =
    firstPersistedHttpString(
      row.annotatedImageUrl,
      row.imageUrl,
      row.fileUrl,
      row.originalImageUrl,
      row.url,
      row.downloadURL
    ) ||
    firstTrimmedString(row.storagePath, row.path, row.fullPath) ||
    "";
  return {
    annotatedUrl,
    imageUrl,
    fileUrl,
    downloadUrl,
    storageUrl,
    thumbnailUrl,
    resolvedImageUrl,
  };
}

/** Záloha při selhání blob: URL (Safari / CSP) — stejný obrázek pro canvas. */
function readFileAsDataUrlForAnnotation(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Soubor nelze načíst jako obrázek."));
    };
    reader.onerror = () => reject(new Error("Čtení souboru selhalo."));
    reader.readAsDataURL(file);
  });
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

export function JobDetailPageContent({
  measurementAnnotationShell = false,
  /**
   * Employee-only: render just the new annotation editor (no full job detail).
   * This reuses the SAME editor implementation as admin.
   */
  employeeAnnotationShell = false,
  employeeAnnotationShellJobId = null,
  employeeAnnotationInitialTarget = null,
  employeeAnnotationReturnTo = null,
  employeeAnnotationReadOnly = false,
}: {
  measurementAnnotationShell?: boolean;
  employeeAnnotationShell?: boolean;
  employeeAnnotationShellJobId?: string | null;
  employeeAnnotationInitialTarget?: JobPhotoAnnotationTarget | null;
  employeeAnnotationReturnTo?: string | null;
  employeeAnnotationReadOnly?: boolean;
} = {}) {
  const { jobId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedSodFromQueryRef = useRef(false);
  const openedMpFromQueryRef = useRef<string | null>(null);
  /**
   * Jedna zpracovaná navigace ?measurementPending=1 na jobId (Strict Mode jinak spouští efekt dvakrát).
   */
  const measurementPendingNavHandledKeyRef = useRef<string | null>(null);
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const isAnnotTouchUI = useIsBelowLg();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId;
  const annotationEditorPersistenceKey = useMemo(
    () => (companyId && user?.uid ? `${String(companyId)}:${user.uid}` : null),
    [companyId, user?.uid]
  );
  const jobIdParamFromRoute =
    typeof jobId === "string"
      ? jobId.trim()
      : Array.isArray(jobId)
        ? String(jobId[0] ?? "").trim()
        : String(jobId ?? "").trim();
  const jobIdParam = measurementAnnotationShell
    ? ""
    : employeeAnnotationShell && employeeAnnotationShellJobId
      ? String(employeeAnnotationShellJobId).trim()
      : jobIdParamFromRoute;
  const isStandaloneMeasurementEditorRoute =
    measurementAnnotationShell ||
    jobIdParamFromRoute === MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID;
  const measurementEditorStripPath = isStandaloneMeasurementEditorRoute
    ? MEASUREMENT_PHOTO_ANNOTATE_PAGE_PATH
    : `/portal/jobs/${jobIdParam}`;
  const jobFirestoreId =
    jobIdParam && !isStandaloneMeasurementEditorRoute ? jobIdParam : null;
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

  const annotationModelsColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(
            collection(firestore, "annotationModels"),
            where("organizationId", "==", companyId),
            limit(500)
          )
        : null,
    [firestore, companyId]
  );
  const { data: annotationModelsRaw } =
    useCollection<AnnotationModelDoc>(annotationModelsColRef);
  const annotationModelsSorted = useMemo(() => {
    const list = (annotationModelsRaw || []).filter((x) => x?.id);
    return [...list].sort((a, b) => {
      const an = String(a.name || a.id);
      const bn = String(b.name || b.id);
      return an.localeCompare(bn, "cs");
    });
  }, [annotationModelsRaw]);

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobFirestoreId
        ? doc(firestore, "companies", companyId, "jobs", jobFirestoreId)
        : null,
    [firestore, companyId, jobFirestoreId]
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

  const jobPaid = useMemo(
    () =>
      resolveJobPaidFromFirestore(
        job as Record<string, unknown> | null | undefined
      ),
    [job]
  );

  const remainingToPayNetKc = useMemo(() => {
    if (jobBudgetBreakdown == null) return null;
    return roundMoney2(jobBudgetBreakdown.budgetNet - jobPaid.paidNet);
  }, [jobBudgetBreakdown, jobPaid.paidNet]);

  const remainingToPayGrossKc = useMemo(() => {
    if (jobBudgetBreakdown == null) return null;
    return roundMoney2(jobBudgetBreakdown.budgetGross - jobPaid.paidGross);
  }, [jobBudgetBreakdown, jobPaid.paidGross]);

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

  const employeeSelfRef = useMemoFirebase(
    () =>
      firestore && companyId && profile?.employeeId
        ? doc(firestore, "companies", companyId, "employees", String(profile.employeeId))
        : null,
    [firestore, companyId, profile?.employeeId]
  );
  const { data: employeeSelf } = useDoc(employeeSelfRef);

  const jobsListForMeetingRef = useMemoFirebase(
    () =>
      firestore && companyId ? collection(firestore, "companies", companyId, "jobs") : null,
    [firestore, companyId]
  );
  const { data: allJobsRawForMeeting } = useCollection(jobsListForMeetingRef);
  const jobOptionsForMeeting = useMemo(() => {
    const list = Array.isArray(allJobsRawForMeeting) ? allJobsRawForMeeting : [];
    return list
      .map((j) => {
        const r = j as { id?: string; name?: string };
        if (!r?.id) return null;
        const name =
          typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.id;
        return { id: r.id, name };
      })
      .filter((x): x is { id: string; name: string } => x != null);
  }, [allJobsRawForMeeting]);

  const canSeeMeetingRecords = useMemo(
    () => staffCanViewMeetingRecords(profile, employeeSelf as { canAccessMeetingNotes?: boolean }),
    [profile, employeeSelf]
  );

  const canEditMeetingRecords = useMemo(
    () => staffCanEditMeetingRecords(profile, employeeSelf as { canAccessMeetingNotes?: boolean }),
    [profile, employeeSelf]
  );

  const platformCatalog = useMergedPlatformModuleCatalog();
  const vyrobaModuleOn =
    !!companyDoc &&
    canAccessCompanyModule(
      companyDoc as Parameters<typeof canAccessCompanyModule>[0],
      "vyroba",
      platformCatalog
    );

  const globalRolesForVyroba = useMemo(
    () => (Array.isArray(profile?.globalRoles) ? profile.globalRoles.map(String) : []),
    [profile?.globalRoles]
  );

  const showVyrobaWorkshopEntry = useMemo(() => {
    if (!vyrobaModuleOn || !jobFirestoreId || !profile) return false;
    const r = String(profile.role || "").trim();
    if (r === "customer") return false;
    return (
      isCompanyPrivileged(r, globalRolesForVyroba) ||
      userCanAccessProductionPortal({
        role: r,
        globalRoles: profile.globalRoles,
        employeeRow: employeeSelf as { canAccessProduction?: boolean } | null,
      })
    );
  }, [vyrobaModuleOn, jobFirestoreId, profile, employeeSelf, globalRolesForVyroba]);

  const photosColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobFirestoreId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobFirestoreId,
            "photos"
          )
        : null,
    [firestore, companyId, jobFirestoreId]
  );
  const { data: photos } = useCollection(photosColRef);

  const measurementPhotosQueryRef = useMemoFirebase(
    () =>
      firestore && companyId && jobFirestoreId
        ? query(
            collection(firestore, "companies", companyId, "measurement_photos"),
            where("jobId", "==", jobFirestoreId)
          )
        : null,
    [firestore, companyId, jobFirestoreId]
  );
  const {
    data: measurementPhotosRaw,
    isLoading: measurementPhotosLoading,
    error: measurementPhotosError,
    isIndexPending: measurementPhotosIndexPending,
  } = useCollection(measurementPhotosQueryRef);

  const [measurementLightboxDocId, setMeasurementLightboxDocId] = useState<
    string | null
  >(null);

  const expensesQueryRef = useMemoFirebase(
    () =>
      firestore && companyId && jobFirestoreId
        ? query(
            collection(
              firestore,
              "companies",
              companyId,
              "jobs",
              jobFirestoreId,
              "expenses"
            ),
            orderBy("createdAt", "desc")
          )
        : null,
    [firestore, companyId, jobFirestoreId]
  );
  const { data: jobExpenses } = useCollection<JobExpenseRow>(expensesQueryRef);

  const jobIncomesColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobFirestoreId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobFirestoreId,
            "incomes"
          )
        : null,
    [firestore, companyId, jobFirestoreId]
  );
  const { data: jobIncomesRaw } = useCollection(jobIncomesColRef);

  const jobIncomesSorted = useMemo(() => {
    const list = [...(jobIncomesRaw ?? [])] as {
      id: string;
      date?: string;
      amountNet?: number;
      amountGross?: number;
      fileName?: string;
      fileUrl?: string;
      source?: string;
      number?: string;
    }[];
    list.sort((a, b) => {
      const da = String(a.date ?? "");
      const db = String(b.date ?? "");
      if (db !== da) return db.localeCompare(da);
      return b.id.localeCompare(a.id);
    });
    return list;
  }, [jobIncomesRaw]);

  const folderSourceExpenses = useMemo(
    () =>
      (jobExpenses ?? []).filter(
        (e) => (e as { source?: string }).source === "folder_documents"
      ),
    [jobExpenses]
  );

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

  const portalCustomerUsersQuery = useMemoFirebase(
    () =>
      firestore && customerId
        ? query(
            collection(firestore, "users"),
            where("customerRecordId", "==", String(customerId)),
            where("role", "==", "customer"),
            limit(1)
          )
        : null,
    [firestore, customerId]
  );
  const { data: portalCustomerUsersRows } = useCollection<{ id?: string }>(
    portalCustomerUsersQuery,
    { suppressGlobalPermissionError: true }
  );
  const customerPortalUserDocId =
    portalCustomerUsersRows &&
    portalCustomerUsersRows[0] &&
    typeof portalCustomerUsersRows[0].id === "string"
      ? portalCustomerUsersRows[0].id.trim()
      : null;

  const customerEmailForJob = useMemo(() => {
    const fromCustomer = String(customer?.email ?? "").trim();
    if (fromCustomer) return fromCustomer;
    const j = job as { customerEmail?: string } | null | undefined;
    return String(j?.customerEmail ?? "").trim();
  }, [customer, job]);

  const customerPortalPreviewGate = useMemo(
    () =>
      getJobCustomerPortalPreviewGate(job as Record<string, unknown> | null | undefined, {
        customer: (customer as Record<string, unknown> | null | undefined) ?? null,
        customerPortalUserDocId,
      }),
    [job, customer, customerPortalUserDocId]
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!jobFirestoreId) return;
    const j = job as Record<string, unknown> | null | undefined;
    const c = customer as Record<string, unknown> | null | undefined;
    const resolvedUid =
      customerPortalPreviewGate.show && !customerPortalPreviewGate.disabled
        ? customerPortalPreviewGate.customerUid
        : null;
    console.debug("[job customer preview gate]", {
      jobId: jobFirestoreId,
      customerId: customerId ?? null,
      customerEmail: customerEmailForJob || null,
      jobCustomerUserId: j?.customerUserId ?? null,
      jobCustomerAccessEnabled: j?.customerAccessEnabled ?? null,
      customerCustomerUserId: c?.customerUserId ?? null,
      customerPortalAccessEnabled: c?.portalAccessEnabled ?? null,
      customerPortalUid: c?.customerPortalUid ?? null,
      customerPortalEnabled: c?.customerPortalEnabled ?? null,
      customerPortalUserDocId,
      resolvedHasCustomerAccess: !!resolvedUid,
    });
  }, [
    jobFirestoreId,
    customerId,
    customerEmailForJob,
    job,
    customer,
    customerPortalPreviewGate,
    customerPortalUserDocId,
  ]);
  const customerAccessEmailSent =
    (customer as { customerAccessEmailSent?: unknown } | null | undefined)
      ?.customerAccessEmailSent === true;
  const customerAccessEmailSentAt = (() => {
    const raw = (customer as { customerAccessEmailSentAt?: any } | null | undefined)
      ?.customerAccessEmailSentAt;
    if (raw && typeof raw.toDate === "function") return raw.toDate() as Date;
    if (raw && typeof (raw as Record<string, unknown>)["seconds"] === "number") {
      return new Date(Number((raw as Record<string, unknown>)["seconds"]) * 1000);
    }
    return null;
  })();

  const sendCustomerAccessEmailFromJob = async () => {
    if (!user || !isAdmin || !customerId) return;
    setCustomerAccessEmailSending(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/customers/${encodeURIComponent(String(customerId))}/send-access-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Odeslání přístupu selhalo."
        );
      }
      toast({
        title: "Přístup odeslán e-mailem",
        description: "Zákazník dostal e-mail s odkazem pro nastavení hesla.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Odeslání selhalo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setCustomerAccessEmailSending(false);
    }
  };

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
      firestore && companyId && jobFirestoreId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobFirestoreId,
            "workContracts"
          )
        : null,
    [firestore, companyId, jobFirestoreId]
  );
  const { data: workContracts, isLoading: isWorkContractsLoading } =
    useCollection<WorkContractDoc>(workContractsColRef);

  const workContractsForJob = useMemo(() => {
    const list = (workContracts || []) as WorkContractDoc[];
    const filtered = list.filter((c) => {
      if (c.isTemplate === true) return false;
      const ct = String(c.contractType ?? "").trim();
      if (!ct || ct === "smlouva_o_dilo" || ct === "contract_document") {
        return true;
      }
      return false;
    });

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
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const [pdfPageRasterBusy, setPdfPageRasterBusy] = useState(false);
  const [measurementCaptureBusy, setMeasurementCaptureBusy] = useState(false);
  const [customerAccessEmailSending, setCustomerAccessEmailSending] = useState(false);
  const measurementGalleryInputRef = useRef<HTMLInputElement>(null);
  const measurementCameraInputRef = useRef<HTMLInputElement>(null);
  /** Záloha souboru z foťáku (iOS někdy ztratí odkaz ve state před otevřením editoru). */
  const measurementCaptureFileRef = useRef<File | null>(null);
  const [photoToEdit, setPhotoToEdit] = useState<JobPhotoAnnotationTarget | null>(
    null
  );
  /** Jeden zdroj pravdy: editor je otevřený právě tehdy, je-li vybrané médium k anotaci. */
  const editorOpen = Boolean(photoToEdit);
  const annotationReadOnly = employeeAnnotationShell
    ? employeeAnnotationReadOnly === true
    : false;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationTransformRef = useRef<HTMLDivElement | null>(null);
  const annotationWheelCaptureRef = useRef<HTMLDivElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [imageForCanvas, setImageForCanvas] = useState<HTMLImageElement | null>(null);
  const [baseImageLoaded, setBaseImageLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeTool, setActiveTool] = useState<AnnotationTool>("dimension");
  const [activeColor, setActiveColor] = useState<DimensionColor>("red");
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<2 | 4 | 6>(4);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [draftAnnotationId, setDraftAnnotationId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>("none");
  const dragModeRef = useRef<DragMode>("none");
  dragModeRef.current = dragMode;
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

  /** Velikost písma popisku kóty (px, 1–100). */
  const [dimensionLabelFontSize, setDimensionLabelFontSize] = useState(16);
  /** Kalibrace měřítka: pixely na 1 mm v prostoru dokumentu. */
  const [imageCalibration, setImageCalibration] = useState<{
    pxPerMm: number;
  } | null>(null);
  const imageCalibrationRef = useRef<{ pxPerMm: number } | null>(null);
  imageCalibrationRef.current = imageCalibration;

  const [calibrationDraft, setCalibrationDraft] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const calibrationDraftRef = useRef(calibrationDraft);
  calibrationDraftRef.current = calibrationDraft;

  /** Klik na plán — po potvrzení dialogu se vloží značka do středu tohoto bodu. */
  const pendingShapePointRef = useRef<{
    x: number;
    y: number;
    pageIndex: number;
  } | null>(null);

  const [shapeLabelDialogOpen, setShapeLabelDialogOpen] = useState(false);
  const [arrowNoteDialogOpen, setArrowNoteDialogOpen] = useState(false);
  const [arrowNoteEditId, setArrowNoteEditId] = useState<string | null>(null);
  const [arrowNoteEditText, setArrowNoteEditText] = useState("");
  const [arrowNoteIsNew, setArrowNoteIsNew] = useState(false);
  const [shapeLabelEditingId, setShapeLabelEditingId] = useState<string | null>(null);
  const [shapeLabelForm, setShapeLabelForm] = useState<{
    shape: ShapeLabelAnnotation["shape"];
    label: string;
    widthMm: number;
    heightMm: number;
    note: string;
    legendDescription: string;
    showLabelInline: boolean;
    modelId?: string;
  }>({
    shape: "point",
    label: "",
    widthMm: 600,
    heightMm: 600,
    note: "",
    legendDescription: "",
    showLabelInline: false,
    modelId: undefined,
  });
  const [shapeLabelLibraryPickerOpen, setShapeLabelLibraryPickerOpen] =
    useState(false);
  const [annotationModelsSettingsOpen, setAnnotationModelsSettingsOpen] =
    useState(false);
  const [shapeLabelPlacementModel, setShapeLabelPlacementModel] =
    useState<AnnotationModelDoc | null>(null);
  const shapeLabelPlacementModelRef = useRef<AnnotationModelDoc | null>(null);
  shapeLabelPlacementModelRef.current = shapeLabelPlacementModel;
  /** Značka z knihovny modelů — tvar a mm jsou pevné, úprava jen textů v dialogu. */
  const shapeLabelPropsLockedByModel = useMemo(
    () => Boolean(String(shapeLabelForm.modelId || "").trim()),
    [shapeLabelForm.modelId]
  );
  const draftAnnotationIdRef = useRef<string | null>(null);
  draftAnnotationIdRef.current = draftAnnotationId;

  const [annotationView, setAnnotationView] = useState({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const annotationViewRef = useRef(annotationView);
  annotationViewRef.current = annotationView;

  const [editorMediaKind, setEditorMediaKind] = useState<"image" | "pdf" | null>(
    null
  );
  const editorMediaKindRef = useRef<"image" | "pdf" | null>(null);
  editorMediaKindRef.current = editorMediaKind;

  const [pdfScale, setPdfScale] = useState(1);
  const pdfScaleRef = useRef(1);
  pdfScaleRef.current = pdfScale;

  const [pdfPage, setPdfPage] = useState(1);
  const pdfPageRef = useRef(1);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfDocRevision, setPdfDocRevision] = useState(0);

  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfBackingRef = useRef<HTMLCanvasElement | null>(null);
  const pdfBaseSizeRef = useRef<{ w: number; h: number } | null>(null);
  const pdfAnnotationsByPageRef = useRef<Map<number, Annotation[]>>(new Map());
  const prevPdfPageRef = useRef(1);
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;

  useEffect(() => {
    pdfPageRef.current = pdfPage;
  }, [pdfPage]);

  const pointerMapRef = useRef(
    new Map<number, { clientX: number; clientY: number; pointerType: string }>()
  );
  const pinchSessionRef = useRef<AnnotationPinchSession | null>(null);
  const viewPanStartRef = useRef<{
    cx: number;
    cy: number;
    panX: number;
    panY: number;
  } | null>(null);
  const measurementEditorReturnToRef = useRef<string | null>(null);

  /** Jednotný vstup do editoru anotací (fotodokumentace i foto zaměření) — vždy vyčistí návrat z jiného kontextu. */
  const openPhotoAnnotationEditor = useCallback(
    (target: JobPhotoAnnotationTarget) => {
      measurementEditorReturnToRef.current = null;
      setPhotoToEdit(target);
    },
    []
  );

  // Employee annotation-only entry: open editor immediately.
  useEffect(() => {
    if (!employeeAnnotationShell) return;
    if (photoToEdit) return;
    if (!employeeAnnotationInitialTarget) return;
    openPhotoAnnotationEditor(employeeAnnotationInitialTarget);
  }, [employeeAnnotationShell, employeeAnnotationInitialTarget, openPhotoAnnotationEditor, photoToEdit]);

  const openMeasurementPhotoAnnotationFromRow = useCallback(
    (row: Record<string, unknown> & { id: string }) => {
      const target = measurementDocToAnnotationTarget(row);
      const picked = pickMeasurementAnnotationSourceString(target);
      const thumb =
        firstTrimmedString(row.thumbUrl, row.thumbnailUrl, row.thumbURL) ||
        undefined;
      if (!annotationTargetHasResolvableUrl(target)) {
        const ephemeralNoStorage = measurementPhotoRowHasEphemeralButNoStorage(row);
        console.error(
          "[JobDetailPage] openMeasurementPhotoAnnotationFromRow: nelze otevřít editor",
          row
        );
        toast({
          variant: "destructive",
          title: "Foto zaměření",
          description: ephemeralNoStorage
            ? "Obrázek není uložený ve storage. Nejdřív jej uložte."
            : "Nepodařilo se načíst obrázek pro anotaci.",
        });
        return;
      }
      if (
        typeof picked === "string" &&
        (picked.startsWith("blob:") || picked.startsWith("data:"))
      ) {
        console.error(
          "[JobDetailPage] openMeasurementPhotoAnnotationFromRow: ephemeral zdroj (blob/data)",
          row
        );
        toast({
          variant: "destructive",
          title: "Foto zaměření",
          description:
            "Obrázek není uložený ve storage. Nejdřív jej uložte.",
        });
        return;
      }
      console.log("OPEN MEASUREMENT PHOTO ANNOTATION", {
        photoId: row.id,
        imageUrl: target.imageUrl ?? target.originalImageUrl,
        annotationSource: picked,
        thumbnailUrl: thumb,
        annotatedUrl: target.annotatedImageUrl,
        editor: "UnifiedAnnotationEditor",
      });
      openPhotoAnnotationEditor(target);
    },
    [openPhotoAnnotationEditor, toast]
  );

  useEffect(() => {
    if (!editorOpen) return;
    setAnnotationView({ zoom: 1, panX: 0, panY: 0 });
    setPdfScale(1);
    setPdfPage(1);
    pointerMapRef.current.clear();
    pinchSessionRef.current = null;
    viewPanStartRef.current = null;
  }, [editorOpen]);

  useEffect(() => {
    if (!editorOpen || !isAnnotTouchUI) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editorOpen, isAnnotTouchUI]);

  useEffect(() => {
    if (!editorOpen) return;
    const el = annotationWheelCaptureRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!canvasRef.current || !baseImageLoaded) return;
      e.preventDefault();
      if (editorMediaKindRef.current === "pdf") {
        const z0 = pdfScaleRef.current;
        const factor = e.ctrlKey
          ? Math.exp(-e.deltaY * 0.01)
          : e.deltaY > 0
            ? 0.9
            : 1.1;
        const z1 = clampPdfScale(z0 * factor);
        if (Math.abs(z1 - z0) < 1e-6) return;
        const wrap = annotationTransformRef.current;
        if (!wrap) {
          setPdfScale(z1);
          return;
        }
        const r = wrap.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const ratio = z1 / z0;
        setAnnotationView((v) => ({
          zoom: 1,
          panX: v.panX + dx * (1 - ratio),
          panY: v.panY + dy * (1 - ratio),
        }));
        setPdfScale(z1);
        return;
      }
      const z0 = annotationViewRef.current.zoom;
      const factor = e.ctrlKey
        ? Math.exp(-e.deltaY * 0.01)
        : e.deltaY > 0
          ? 0.9
          : 1.1;
      const z1 = Math.min(
        ANNOTATION_VIEW_ZOOM_MAX,
        Math.max(ANNOTATION_VIEW_ZOOM_MIN, z0 * factor)
      );
      if (Math.abs(z1 - z0) < 1e-6) return;
      const wrap = annotationTransformRef.current;
      if (!wrap) {
        setAnnotationView((v) => ({ ...v, zoom: z1 }));
        return;
      }
      const r = wrap.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const ratio = z1 / z0;
      setAnnotationView((v) => ({
        zoom: z1,
        panX: v.panX + dx * (1 - ratio),
        panY: v.panY + dy * (1 - ratio),
      }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editorOpen, baseImageLoaded, canvasReady]);

  /** Po načtení obrázku přizpůsobí zoom, aby byl podklad ve výřezu editoru vidět a vycentrovaný. */
  useEffect(() => {
    if (!editorOpen || !baseImageLoaded || editorMediaKind !== "image") return;
    const run = () => {
      const wrap = annotationWheelCaptureRef.current;
      const c = canvasRef.current;
      if (!wrap || !c || !c.width || !c.height) return;
      const wr = wrap.getBoundingClientRect();
      const pad = 40;
      const aw = Math.max(80, wr.width - pad);
      const ah = Math.max(80, wr.height - pad);
      const cw = Math.max(1, c.offsetWidth);
      const ch = Math.max(1, c.offsetHeight);
      const fit = Math.min(aw / cw, ah / ch, ANNOTATION_VIEW_ZOOM_MAX);
      if (!Number.isFinite(fit) || fit < ANNOTATION_VIEW_ZOOM_MIN) return;
      setAnnotationView({ zoom: fit, panX: 0, panY: 0 });
    };
    const id = window.requestAnimationFrame(run);
    const t = window.setTimeout(run, 80);
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [editorOpen, baseImageLoaded, editorMediaKind, imageForCanvas]);

  const bumpAnnotZoom = useCallback((dir: 1 | -1) => {
    if (editorMediaKindRef.current === "pdf") {
      setPdfScale((s) => clampPdfScale(s + dir * PDF_EDITOR_SCALE_STEP));
      return;
    }
    const factor = dir > 0 ? 1.15 : 1 / 1.15;
    setAnnotationView((v) => {
      const z1 = Math.min(
        ANNOTATION_VIEW_ZOOM_MAX,
        Math.max(ANNOTATION_VIEW_ZOOM_MIN, v.zoom * factor)
      );
      return { ...v, zoom: z1 };
    });
  }, []);

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
    documentTitle: "",
    documentRole: "contract",
    documentSubtype: "work_contract",
    parentContractId: "",
    parentContractNumber: "",
    parentContractTitle: "",
    attachmentOrdinal: 0,
    numberSeriesPrefix: "SOD",
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

  const parentContractChoices = useMemo(
    () =>
      workContractsForJob.filter(
        (c) =>
          c.id !== activeWorkContractId &&
          String(c.documentRole ?? "").trim() !== "addendum" &&
          String(c.documentRole ?? "").trim() !== "attachment"
      ),
    [workContractsForJob, activeWorkContractId]
  );

  const workContractsBaseForJob = useMemo(() => {
    const list = (workContractsForJob || []) as WorkContractDoc[];
    return list.filter(
      (c) => String(c.documentRole ?? "").trim() !== "attachment"
    );
  }, [workContractsForJob]);

  const attachmentsByParentContractId = useMemo(() => {
    const map = new Map<string, WorkContractDoc[]>();
    for (const c of workContractsForJob) {
      if (String(c.documentRole ?? "").trim() !== "attachment") continue;
      const pid = String(c.parentContractId ?? "").trim();
      if (!pid) continue;
      const arr = map.get(pid) ?? [];
      arr.push(c);
      map.set(pid, arr);
    }
    const getTime = (t: any) => {
      if (!t) return 0;
      if (typeof t === "number") return t;
      if (typeof t.toMillis === "function") return t.toMillis();
      if (typeof t.toDate === "function") return t.toDate().getTime();
      return 0;
    };
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const oa =
          typeof a.attachmentOrdinal === "number" ? a.attachmentOrdinal : 0;
        const ob =
          typeof b.attachmentOrdinal === "number" ? b.attachmentOrdinal : 0;
        if (oa !== ob) return oa - ob;
        return getTime(a.createdAt) - getTime(b.createdAt);
      });
    }
    return map;
  }, [workContractsForJob]);

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
    customerInputMode: "list",
    manualCustomerCompanyName: "",
    manualCustomerAddress: "",
    manualCustomerEmail: "",
    manualCustomerPhone: "",
    manualCustomerNotes: "",
    assignedEmployeeIdsText: "",
    jobTag: "",
    jobTagCustom: "",
  });
  const [jobEditTemplateValues, setJobEditTemplateValues] =
    useState<JobTemplateValues>({});

  /** Při ručním zadání — název odpovídá existujícímu zákazníkovi v adresáři (nabídka propojení). */
  const customerEditDuplicateHint = useMemo(() => {
    if (!editJobDialogOpen || jobEditForm.customerInputMode !== "manual") {
      return null;
    }
    const q = jobEditForm.manualCustomerCompanyName.trim();
    if (!q || !customers?.length) return null;
    const normalize = (s: string) =>
      s.trim().toLowerCase().replace(/\s+/g, " ");
    const nq = normalize(q);
    return (
      customers.find((c: any) => {
        const label = (
          c.companyName ||
          `${c.firstName || ""} ${c.lastName || ""}`.trim() ||
          ""
        ).trim();
        return label && normalize(label) === nq;
      }) ?? null
    );
  }, [
    editJobDialogOpen,
    jobEditForm.customerInputMode,
    jobEditForm.manualCustomerCompanyName,
    customers,
  ]);

  const setCanvasNode = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasReady(!!node);
  }, []);

  const resetAnnotationState = useCallback(() => {
    try {
      pdfDocRef.current?.destroy?.();
    } catch {
      /* ignore */
    }
    pdfDocRef.current = null;
    pdfBackingRef.current = null;
    pdfBaseSizeRef.current = null;
    pdfAnnotationsByPageRef.current.clear();
    prevPdfPageRef.current = 1;
    setPdfPage(1);
    setPdfScale(1);
    setPdfNumPages(0);
    setPdfDocRevision(0);
    setEditorMediaKind(null);

    setImageError(null);
    setImageForCanvas(null);
    setBaseImageLoaded(false);
    setAnnotations([]);
    setSelectedAnnotationId(null);
    setDraftAnnotationId(null);
    setDragMode("none");
    setDragLastPoint(null);
    setNoteRectDraft(null);
    setCalibrationDraft(null);
    setImageCalibration(null);
    setDimensionLabelFontSize(16);
    pendingShapePointRef.current = null;
    setShapeLabelDialogOpen(false);
    setArrowNoteDialogOpen(false);
    setArrowNoteEditId(null);
    setArrowNoteEditText("");
    setArrowNoteIsNew(false);
    setShapeLabelEditingId(null);
    setImageObjectUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
      }
      return null;
    });
  }, []);

  const dismissAnnotationEditor = useCallback(() => {
    measurementEditorReturnToRef.current = null;
    measurementCaptureFileRef.current = null;
    setPhotoToEdit((prev) => {
      if (prev?.pendingObjectUrl) {
        try {
          URL.revokeObjectURL(prev.pendingObjectUrl);
        } catch {
          /* ignore */
        }
      }
      return null;
    });
    resetAnnotationState();
    if (employeeAnnotationShell) {
      const back = employeeAnnotationReturnTo?.trim();
      if (back) router.replace(back);
    }
  }, [resetAnnotationState]);

  const annotationSource = useMemo(() => {
    if (!photoToEdit) return null;

    const pe = photoToEdit;
    if (pe.annotationTarget?.kind === "measurementPhotos") {
      return pickMeasurementAnnotationSourceString(pe);
    }
    return (
      firstPersistedHttpString(
        pe.originalImageUrl,
        pe.imageUrl,
        pe.annotatedImageUrl,
        pe.url,
        pe.fileUrl,
        pe.downloadURL
      ) ||
      pickNonHttpStoragePath(pe) ||
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

    /** Lokální náhled z foťáku / souboru — nelze předávat do Storage ref. */
    if (value.startsWith("blob:") || value.startsWith("data:")) {
      return value;
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

  const workContractPrintHtmlContext = useMemo((): WorkContractPrintHtmlBuildContext => {
    const jid = String(jobFirestoreId ?? jobIdParam ?? "").trim();
    return {
      companyDoc: (companyDoc ?? null) as Record<string, unknown> | null,
      companyNameFromDoc: companyNameFromDoc || "",
      companyBankAccountNumber: String(companyBankAccountNumber || ""),
      bankAccounts: (bankAccounts || []) as WorkContractBankAccountLike[],
      customer: (customer as Record<string, unknown> | null) ?? null,
      job: (job as Record<string, unknown> | null) ?? null,
      jobId: jid,
      jobBudgetKc,
      template: template as JobTemplate | undefined,
      workContractsForJob: (workContractsForJob || []) as WorkContractDoc[],
    };
  }, [
    companyDoc,
    companyNameFromDoc,
    companyBankAccountNumber,
    bankAccounts,
    customer,
    job,
    jobFirestoreId,
    jobIdParam,
    jobBudgetKc,
    template,
    workContractsForJob,
  ]);

  const applyTemplateVariables = useCallback(
    (
      input: string,
      formOverride?: WorkContractForm,
      templateOpts?: { freezePlaceholders?: ReadonlySet<string> }
    ): string => {
      const form = formOverride ?? contractForm;
      return applyWorkContractTemplateVariables(
        input,
        form,
        workContractPrintHtmlContext,
        templateOpts
      );
    },
    [contractForm, workContractPrintHtmlContext]
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
    (form: WorkContractForm) =>
      buildWorkContractPrintHtmlString(form, workContractPrintHtmlContext),
    [workContractPrintHtmlContext]
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

  const buildPrefilledContractHeader = useCallback(
    (titleLine?: string): string => {
      const jobName = job?.name || "Zakázka";
      const clientName = customer ? deriveCustomerDisplayName(customer) : "";
      const supplierName =
        companyNameFromDoc ||
        companyDoc?.companyName ||
        (companyDoc as any)?.name ||
        "";
      const dateStr = new Intl.DateTimeFormat("cs-CZ").format(new Date());

      const line1 =
        titleLine === undefined
          ? "Smlouva o dílo"
          : titleLine.trim() || "Dokument ke zakázce";

      return [
        line1,
        `Zakázka: ${jobName}`,
        clientName ? `Objednatel: ${clientName}` : "",
        supplierName ? `Dodavatel: ${supplierName}` : "",
        `Datum: ${dateStr}`,
      ]
        .filter(Boolean)
        .join("\n");
    },
    [job?.name, customer, companyDoc, companyNameFromDoc]
  );

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

  const openContractDialog = useCallback(
    async (
      preset: ContractOpenPreset = "sod_work",
      opts?: { parentContractId?: string }
    ) => {
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
      const defaultBankAccount =
        bankAccounts && bankAccounts.length > 0 ? bankAccounts[0] : null;
      const autoContractorText = deriveContractorText(
        companyDoc,
        companyNameFromDoc,
        defaultBankAccount
      );

      if (preset === "new_attachment") {
        const pid = String(opts?.parentContractId ?? "").trim();
        if (!pid) {
          toast({
            variant: "destructive",
            title: "Chybí smlouva",
            description:
              "Vyberte smlouvu, ke které má příloha patřit (nadřazený dokument).",
          });
          setContractDialogOpen(false);
          return;
        }
        const parent = workContractsForJob.find((c) => c.id === pid);
        if (
          !parent ||
          String(parent.documentRole ?? "").trim() === "attachment" ||
          String(parent.documentRole ?? "").trim() === "addendum"
        ) {
          toast({
            variant: "destructive",
            title: "Neplatná smlouva",
            description:
              "Přílohu lze vytvořit jen k základní smlouvě (ne k dodatku).",
          });
          setContractDialogOpen(false);
          return;
        }
        const parentNo = String(parent.contractNumber ?? "").trim();
        const parentTitle = workContractDisplayTitle(parent);
        const siblingAttachments = workContractsForJob.filter(
          (c) =>
            String(c.documentRole ?? "").trim() === "attachment" &&
            String(c.parentContractId ?? "").trim() === pid
        );
        const maxOrd = siblingAttachments.reduce(
          (m, c) =>
            Math.max(
              m,
              typeof c.attachmentOrdinal === "number" ? c.attachmentOrdinal : 0
            ),
          0
        );
        const nextOrdinal = maxOrd + 1;
        const defaultTitle = `Příloha č. ${nextOrdinal} – Obsah plnění`;

        setContractForm({
          documentTitle: defaultTitle,
          documentRole: "attachment",
          documentSubtype: "contract_attachment",
          parentContractId: pid,
          parentContractNumber: parentNo,
          parentContractTitle: parentTitle,
          attachmentOrdinal: nextOrdinal,
          numberSeriesPrefix: "PRIL",
          templateName: "",
          contractHeader: `Příloha č. ${nextOrdinal} ke smlouvě č. ${parentNo || "—"} (${parentTitle})`,
          mainContractContent: "",
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
        return;
      }

      const presetTitle =
        preset === "sod_work"
          ? "Smlouva o dílo"
          : preset === "new_addendum"
            ? "Dodatek ke smlouvě"
            : "";
      const headerTitleArg =
        preset === "new_contract" ? "" : presetTitle || undefined;

      const addendumParentId =
        preset === "new_addendum" && opts?.parentContractId
          ? String(opts.parentContractId).trim()
          : "";

      setContractForm({
        documentTitle: presetTitle,
        documentRole: preset === "new_addendum" ? "addendum" : "contract",
        documentSubtype:
          preset === "new_addendum"
            ? "contract_addendum"
            : preset === "sod_work"
              ? "work_contract"
              : "custom",
        parentContractId: addendumParentId,
        parentContractNumber: "",
        parentContractTitle: "",
        attachmentOrdinal: 0,
        numberSeriesPrefix: preset === "new_addendum" ? "DOD" : "SOD",
        templateName: "",
        contractHeader: buildPrefilledContractHeader(headerTitleArg),
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
    },
    [
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
      workContractsForJob,
    ]
  );

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

  useEffect(() => {
    openedMpFromQueryRef.current = null;
    measurementPendingNavHandledKeyRef.current = null;
  }, [jobId]);

  useEffect(() => {
    const mp =
      searchParams.get("mp")?.trim() ||
      searchParams.get("photoId")?.trim() ||
      searchParams.get("fileId")?.trim() ||
      "";
    if (!mp) {
      openedMpFromQueryRef.current = null;
      return;
    }
    const rtMp = sanitizeMeasurementEditorReturnTo(searchParams.get("returnTo"));
    if (rtMp) measurementEditorReturnToRef.current = rtMp;
    if (!companyId || !firestore) return;
    if (!isStandaloneMeasurementEditorRoute && !jobIdParam) return;
    if (openedMpFromQueryRef.current === mp) return;

    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(
          doc(firestore, "companies", companyId, "measurement_photos", mp)
        );
        if (cancelled) return;
        if (!snap.exists()) {
          openedMpFromQueryRef.current = mp;
          toast({
            variant: "destructive",
            title: "Foto zaměření",
            description: "Záznam nebyl nalezen.",
          });
          router.replace(measurementEditorStripPath, { scroll: false });
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const docCompanyId =
          typeof data.companyId === "string" ? data.companyId.trim() : "";
        if (docCompanyId && docCompanyId !== companyId) {
          openedMpFromQueryRef.current = mp;
          toast({
            variant: "destructive",
            title: "Foto zaměření",
            description: "Snímek nepatří k této organizaci.",
          });
          router.replace(measurementEditorStripPath, { scroll: false });
          return;
        }
        const rowJobId = typeof data.jobId === "string" ? data.jobId.trim() : "";
        if (!isStandaloneMeasurementEditorRoute && jobFirestoreId) {
          if (rowJobId && rowJobId !== jobFirestoreId) {
            openedMpFromQueryRef.current = mp;
            toast({
              variant: "destructive",
              title: "Foto zaměření",
              description:
                "Tento snímek patří k jiné zakázce. Otevřete ji z přehledu nebo z hlavní stránky.",
            });
            router.replace(measurementEditorStripPath, { scroll: false });
            return;
          }
        }
        const rowFull = { id: snap.id, ...data } as Record<string, unknown> & {
          id: string;
        };
        const dbg = resolveMeasurementPhotoRowForEditorLog(rowFull);
        console.log("OPEN PENDING MEASUREMENT PHOTO EDITOR", {
          photoId: snap.id,
          annotatedUrl: dbg.annotatedUrl,
          imageUrl: dbg.imageUrl,
          fileUrl: dbg.fileUrl,
          downloadUrl: dbg.downloadUrl,
          storageUrl: dbg.storageUrl,
          thumbnailUrl: dbg.thumbnailUrl,
          resolvedImageUrl: dbg.resolvedImageUrl,
          editor: "UnifiedAnnotationEditor",
        });
        const target = measurementDocToAnnotationTarget(rowFull);
        if (!annotationTargetHasResolvableUrl(target)) {
          const ephemeralNoStorage =
            measurementPhotoRowHasEphemeralButNoStorage(rowFull);
          console.error(
            ephemeralNoStorage
              ? "[JobDetailPage] measurement photo: jen blob/data URL, chybí Storage"
              : "[JobDetailPage] measurement photo has no resolvable image URL",
            rowFull
          );
          openedMpFromQueryRef.current = mp;
          toast({
            variant: "destructive",
            title: "Foto zaměření",
            description: ephemeralNoStorage
              ? "Obrázek není uložený ve storage. Nejdřív jej uložte."
              : "Nepodařilo se načíst obrázek pro anotaci.",
          });
          router.replace(measurementEditorStripPath, { scroll: false });
          return;
        }
        const pickedSrc = pickMeasurementAnnotationSourceString(target);
        if (
          typeof pickedSrc === "string" &&
          (pickedSrc.startsWith("blob:") || pickedSrc.startsWith("data:"))
        ) {
          console.error(
            "[JobDetailPage] measurement editor: zdroj je stále ephemeral",
            rowFull
          );
          openedMpFromQueryRef.current = mp;
          toast({
            variant: "destructive",
            title: "Foto zaměření",
            description:
              "Obrázek není uložený ve storage. Nejdřív jej uložte.",
          });
          router.replace(measurementEditorStripPath, { scroll: false });
          return;
        }
        openedMpFromQueryRef.current = mp;
        setPhotoToEdit(target);
        router.replace(measurementEditorStripPath, { scroll: false });
      } catch (e) {
        if (cancelled) return;
        console.error("[JobDetailPage] open measurement from ?mp=", e);
        toast({
          variant: "destructive",
          title: "Foto zaměření",
          description: e instanceof Error ? e.message : "Nepodařilo se načíst záznam.",
        });
        router.replace(measurementEditorStripPath, { scroll: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    searchParams,
    companyId,
    jobIdParam,
    jobFirestoreId,
    isStandaloneMeasurementEditorRoute,
    measurementEditorStripPath,
    firestore,
    router,
    toast,
  ]);

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

        setContractForm(workContractDocToForm(data, companyBankAccountNumber));
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

        const series =
          String(data.numberSeriesPrefix ?? "").trim().toUpperCase() || "SOD";

        let contractNumber = String(data.contractNumber || "").trim();
        let allocatedNow = false;
        if (!contractNumber) {
          contractNumber =
            series === "SOD"
              ? await allocateNextSodContractNumber(firestore, companyId)
              : await allocateNextSeriesContractNumber(
                  firestore,
                  companyId,
                  series
                );
          allocatedNow = true;
          await setDoc(
            contractRef,
            {
              contractNumber,
              numberSeriesPrefix: series,
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
          ...workContractDocToForm(data, companyBankAccountNumber),
          contractNumber,
          contractDateLabel,
        };

        const isListedAttachment = form.documentRole === "attachment";
        const depErrListed = validateWorkContractDeposit({
          depositAmountStr: form.depositAmount,
          depositPercentStr: form.depositPercentage,
          budgetKc: jobBudgetKc,
        });
        if (depErrListed && !isListedAttachment) {
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
        "Opravdu chcete smazat tento dokument (smlouvu / dodatek) u této zakázky?"
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
          title: "Dokument smazán",
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
          ...EMPTY_CONTRACT_FORM_FIELDS,
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
          parentContractNumber: "",
          parentContractTitle: "",
          attachmentOrdinal: 0,
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
          ...EMPTY_CONTRACT_FORM_FIELDS,
          documentTitle: tmpl.name || "",
          templateName: tmpl.name || "",
          contractHeader: buildPrefilledContractHeader(
            tmpl.name ? String(tmpl.name) : undefined
          ),
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
        ...EMPTY_CONTRACT_FORM_FIELDS,
        documentTitle: tmpl.templateName || "",
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
        ...EMPTY_CONTRACT_FORM_FIELDS,
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
        parentContractNumber: "",
        parentContractTitle: "",
        attachmentOrdinal: 0,
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

    const isAttachment = contractForm.documentRole === "attachment";

    if (isAttachment) {
      const pid = String(contractForm.parentContractId ?? "").trim();
      if (!pid) {
        throw new Error("Chybí výběr nadřazené smlouvy pro přílohu.");
      }
      const parentRef = doc(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId as string,
        "workContracts",
        pid
      );
      const parentSnap = await getDoc(parentRef);
      if (!parentSnap.exists()) {
        throw new Error("Nadřazená smlouva neexistuje nebo byla smazána.");
      }
      const parentData = parentSnap.data() as WorkContractDoc;
      if (String(parentData.documentRole ?? "").trim() === "attachment") {
        throw new Error("Příloha nemůže být nadřazena k jiné příloze.");
      }
      if (String(parentData.documentRole ?? "").trim() === "addendum") {
        throw new Error(
          "Příloha musí být navázána na základní smlouvu (ne na dodatek)."
        );
      }
      const parentCombined: WorkContractDoc = {
        ...parentData,
        id: pid,
      };
      const parentContractNumberResolved = String(
        parentCombined.contractNumber ?? ""
      ).trim();
      const parentContractTitleResolved =
        workContractDisplayTitle(parentCombined);

      let seriesRaw =
        String(
          contractForm.numberSeriesPrefix ||
            existing?.numberSeriesPrefix ||
            "PRIL"
        )
          .trim()
          .toUpperCase() || "PRIL";
      if (seriesRaw === "SOD") seriesRaw = "PRIL";

      const fromFormAtt = String(contractForm.contractNumber || "").trim();
      let contractNumberAtt =
        fromFormAtt || String(existing?.contractNumber || "").trim();

      const allocatedNewAtt = !contractNumberAtt;
      if (allocatedNewAtt) {
        contractNumberAtt = await allocateNextSeriesContractNumber(
          firestore,
          companyId,
          seriesRaw
        );
      }

      let contractDateLabelAtt: string;
      if (allocatedNewAtt) {
        contractDateLabelAtt = new Intl.DateTimeFormat("cs-CZ").format(
          new Date()
        );
      } else {
        contractDateLabelAtt =
          formatCsDateFromFirestore(existing?.contractIssuedAt) ||
          formatCsDateFromFirestore(existing?.createdAt) ||
          new Intl.DateTimeFormat("cs-CZ").format(new Date());
      }

      let attachmentOrdinalResolved: number;
      if (
        existing &&
        String(existing.documentRole ?? "").trim() === "attachment" &&
        typeof existing.attachmentOrdinal === "number"
      ) {
        attachmentOrdinalResolved = existing.attachmentOrdinal;
      } else {
        const siblingAttachments = workContractsForJob.filter(
          (c) =>
            c.id !== activeWorkContractId &&
            String(c.documentRole ?? "").trim() === "attachment" &&
            String(c.parentContractId ?? "").trim() === pid
        );
        const maxOrd = siblingAttachments.reduce(
          (m, c) =>
            Math.max(
              m,
              typeof c.attachmentOrdinal === "number" ? c.attachmentOrdinal : 0
            ),
          0
        );
        const fromFormOrd = contractForm.attachmentOrdinal;
        attachmentOrdinalResolved =
          fromFormOrd > 0 ? fromFormOrd : maxOrd + 1;
      }

      const payloadAtt: Record<string, unknown> = {
        id: activeWorkContractId,
        jobId: jobId as string,
        isTemplate: false,
        contractType: "contract_document",
        documentTitle: contractForm.documentTitle?.trim() || null,
        title: contractForm.documentTitle?.trim() || null,
        documentRole: "attachment",
        documentSubtype:
          contractForm.documentSubtype?.trim() || "contract_attachment",
        parentContractId: pid,
        parentContractNumber: parentContractNumberResolved || null,
        parentContractTitle: parentContractTitleResolved || null,
        attachmentOrdinal: attachmentOrdinalResolved,
        numberSeriesPrefix: seriesRaw,
        templateDocId:
          selectedWorkContractTemplateId !== "__new__"
            ? selectedWorkContractTemplateId
            : null,
        templateName: contractForm.templateName || null,
        contractHeader: contractForm.contractHeader,
        mainContractContent: contractForm.mainContractContent,
        client: contractForm.client,
        contractor: contractForm.contractor,
        additionalInfo: contractForm.additionalInfo || null,
        depositPercentage: null,
        depositAmount: null,
        zalohovaCastka: null,
        zalohovaProcenta: null,
        bankAccountNumber: contractForm.bankAccountNumber || null,
        bankAccountId: contractForm.bankAccountId ?? null,
        contractNumber: contractNumberAtt,
        updatedAt: serverTimestamp(),
      };

      if (allocatedNewAtt) {
        payloadAtt.contractIssuedAt = serverTimestamp();
      }

      if (existingSnap.exists()) {
        await updateDoc(contractRef, payloadAtt as Record<string, any>);
      } else {
        await setDoc(contractRef, {
          ...payloadAtt,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        } as Record<string, any>);
      }

      return {
        contractRef,
        contractNumber: contractNumberAtt,
        contractDateLabel: contractDateLabelAtt,
        parentContractNumber: parentContractNumberResolved,
        parentContractTitle: parentContractTitleResolved,
        attachmentOrdinal: attachmentOrdinalResolved,
      };
    }

    const fromForm = String(contractForm.contractNumber || "").trim();
    let contractNumber =
      fromForm || String(existing?.contractNumber || "").trim();

    const seriesRaw =
      String(
        contractForm.numberSeriesPrefix ||
          existing?.numberSeriesPrefix ||
          "SOD"
      )
        .trim()
        .toUpperCase() || "SOD";

    const allocatedNew = !contractNumber;
    if (allocatedNew) {
      contractNumber =
        seriesRaw === "SOD"
          ? await allocateNextSodContractNumber(firestore, companyId)
          : await allocateNextSeriesContractNumber(
              firestore,
              companyId,
              seriesRaw
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
      contractType: "contract_document",
      documentTitle: contractForm.documentTitle?.trim() || null,
      title: contractForm.documentTitle?.trim() || null,
      documentRole: contractForm.documentRole,
      documentSubtype: contractForm.documentSubtype?.trim() || "custom",
      parentContractId:
        contractForm.documentRole === "addendum" &&
        contractForm.parentContractId?.trim()
          ? contractForm.parentContractId.trim()
          : null,
      parentContractNumber: null,
      parentContractTitle: null,
      attachmentOrdinal: null,
      numberSeriesPrefix: seriesRaw,
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

    return {
      contractRef,
      contractNumber,
      contractDateLabel,
      parentContractNumber: undefined as string | undefined,
      parentContractTitle: undefined as string | undefined,
      attachmentOrdinal: undefined as number | undefined,
    };
  }, [
    firestore,
    companyId,
    jobId,
    user,
    activeWorkContractId,
    selectedWorkContractTemplateId,
    contractForm,
    jobBudgetKc,
    workContractsForJob,
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
    const isAtt = contractForm.documentRole === "attachment";
    if (!isAtt && !contractForm.contractHeader.trim()) {
      missing.push("Hlavička smlouvy");
    }
    if (!contractForm.mainContractContent.trim()) {
      missing.push(isAtt ? "Obsah plnění zakázky" : "Text smlouvy");
    }
    if (!contractForm.client.trim()) missing.push("Objednatel");
    if (!contractForm.contractor.trim()) missing.push("Dodavatel");
    if (isAtt) {
      if (!String(contractForm.parentContractId ?? "").trim()) {
        missing.push("Nadřazená smlouva");
      }
      if (!String(contractForm.documentTitle ?? "").trim()) {
        missing.push("Název přílohy");
      }
    }

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
    if (depErrSave && !isAtt) {
      toast({
        variant: "destructive",
        title: "Nelze uložit smlouvu",
        description: depErrSave,
      });
      return;
    }

    setIsSavingContract(true);
    try {
      const {
        contractNumber,
        contractDateLabel,
        parentContractNumber,
        parentContractTitle,
        attachmentOrdinal,
      } = await upsertWorkContractBase();
      setContractForm((prev) => ({
        ...prev,
        contractNumber,
        contractDateLabel,
        ...(parentContractNumber != null
          ? { parentContractNumber: String(parentContractNumber) }
          : {}),
        ...(parentContractTitle != null
          ? { parentContractTitle: String(parentContractTitle) }
          : {}),
        ...(attachmentOrdinal != null && attachmentOrdinal > 0
          ? { attachmentOrdinal }
          : {}),
      }));
      toast({
        title: "Dokument uložen",
        description: contractNumber
          ? `Číslo dokumentu: ${contractNumber}`
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
    const isAttPdf = contractForm.documentRole === "attachment";
    if (!isAttPdf && !contractForm.contractHeader.trim()) {
      missing.push("Hlavička smlouvy");
    }
    if (!contractForm.mainContractContent.trim()) {
      missing.push(isAttPdf ? "Obsah plnění zakázky" : "Text smlouvy");
    }
    if (!contractForm.client.trim()) missing.push("Objednatel");
    if (!contractForm.contractor.trim()) missing.push("Dodavatel");
    if (isAttPdf) {
      if (!String(contractForm.parentContractId ?? "").trim()) {
        missing.push("Nadřazená smlouva");
      }
      if (!String(contractForm.documentTitle ?? "").trim()) {
        missing.push("Název přílohy");
      }
    }

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
    if (depErrPdf && !isAttPdf) {
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
      const upsertPdf = await upsertWorkContractBase();

      const mergedForm: WorkContractForm = {
        ...contractForm,
        contractNumber: upsertPdf.contractNumber,
        contractDateLabel: upsertPdf.contractDateLabel,
        ...(upsertPdf.parentContractNumber != null
          ? { parentContractNumber: String(upsertPdf.parentContractNumber) }
          : {}),
        ...(upsertPdf.parentContractTitle != null
          ? { parentContractTitle: String(upsertPdf.parentContractTitle) }
          : {}),
        ...(upsertPdf.attachmentOrdinal != null &&
        upsertPdf.attachmentOrdinal > 0
          ? { attachmentOrdinal: upsertPdf.attachmentOrdinal }
          : {}),
      };
      setContractForm(mergedForm);

      // 2) Same HTML as print — čistý dokument bez UI
      const html = buildContractHtmlForForm(mergedForm);

      // Persist generated HTML for the job record as well.
      await setDoc(
        upsertPdf.contractRef,
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
    const isAttPrev = contractForm.documentRole === "attachment";
    if (!isAttPrev && !contractForm.contractHeader.trim()) {
      missing.push("Hlavička smlouvy");
    }
    if (!contractForm.mainContractContent.trim()) {
      missing.push(isAttPrev ? "Obsah plnění zakázky" : "Text smlouvy");
    }
    if (!contractForm.client.trim()) missing.push("Objednatel");
    if (!contractForm.contractor.trim()) missing.push("Dodavatel");
    if (isAttPrev) {
      if (!String(contractForm.parentContractId ?? "").trim()) {
        missing.push("Nadřazená smlouva");
      }
      if (!String(contractForm.documentTitle ?? "").trim()) {
        missing.push("Název přílohy");
      }
    }

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
    if (depErrPrev && !isAttPrev) {
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
      console.log("[AnnotationEditor:debug]", {
        fileId: photoToEdit?.id,
        imageUrl: null,
        imageLoaded: false,
        naturalWidth: null,
        naturalHeight: null,
        reason: "missing_annotation_source",
      });
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

        const pe0 = photoToEdit;
        const isPendingLocalDraft0 =
          Boolean(pe0?.id?.startsWith("pending-")) &&
          (Boolean(pe0?.pendingObjectUrl) ||
            Boolean(pe0?.pendingLocalFile) ||
            Boolean(measurementCaptureFileRef.current));

        if (
          photoToEdit?.annotationTarget?.kind === "measurementPhotos" &&
          !isPendingLocalDraft0
        ) {
          const s = (annotationSource || "").trim();
          if (s.startsWith("blob:") || s.startsWith("data:")) {
            console.error(
              "[JobDetailPage] editor: trvalé foto nemá mít blob annotationSource",
              photoToEdit
            );
            setImageError(
              "Obrázek není uložený ve storage. Nejdřív jej uložte."
            );
            setBaseImageLoaded(false);
            return;
          }
        }

        let resolvedUrl = await resolveAnnotationImageUrl(annotationSource);

        if (photoToEdit) {
          const pe = photoToEdit;
          const isPendingLocalDraft =
            Boolean(pe.id?.startsWith("pending-")) &&
            (Boolean(pe.pendingObjectUrl) ||
              Boolean(pe.pendingLocalFile) ||
              Boolean(measurementCaptureFileRef.current));

          /** SDK blob jen když ještě nemáme HTTPS download URL (zdroj je čistá storage cesta). */
          if (!isPendingLocalDraft) {
            const rawPath =
              pe.storagePath ||
              pe.path ||
              getPhotoStorageFullPath(pe);
            const storagePath = typeof rawPath === "string" ? rawPath.trim() : "";
            const canStorageSdkBlob =
              storagePath &&
              !storagePath.startsWith("blob:") &&
              !storagePath.startsWith("data:") &&
              !storagePath.startsWith("http://") &&
              !storagePath.startsWith("https://") &&
              !resolvedUrl.startsWith("http://") &&
              !resolvedUrl.startsWith("https://");

            if (canStorageSdkBlob) {
              const blob = await getBlob(ref(getFirebaseStorage(), storagePath));
              const objectUrl = URL.createObjectURL(blob);
              setImageObjectUrl(objectUrl);
              resolvedUrl = objectUrl;
            }
          }
        }
        if (cancelled) return;

        const isPdfTarget = annotationTargetLooksPdf(photoToEdit, resolvedUrl);

        if (isPdfTarget) {
          const pdfjs = await loadPdfJsForAnnotationEditor();
          const pdfBuf = await fetch(resolvedUrl).then((r) => r.arrayBuffer());
          if (cancelled) return;
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf) })
            .promise;
          if (cancelled) {
            try {
              await pdf.destroy?.();
            } catch {
              /* ignore */
            }
            return;
          }
          pdfDocRef.current = pdf;
          setPdfNumPages(pdf.numPages);

          const rawPayload = photoToEdit
            ? readAnnotationPayloadFromPhotoDoc(
                photoToEdit as Record<string, unknown>
              )
            : null;
          const refSz = readAnnotationPayloadReferenceSize(rawPayload);
          let initialPage = 1;
          const pIdx = (rawPayload as { pageIndex?: unknown } | null)?.pageIndex;
          if (typeof pIdx === "number" && Number.isFinite(pIdx)) {
            initialPage = Math.min(
              pdf.numPages,
              Math.max(1, Math.floor(pIdx) + 1)
            );
          }
          prevPdfPageRef.current = initialPage;
          setPdfPage(initialPage);

          const pageForBase = await pdf.getPage(initialPage);
          const baseVp = pageForBase.getViewport({ scale: 1 });
          pdfBaseSizeRef.current = { w: baseVp.width, h: baseVp.height };

          const iw = refSz?.width ?? baseVp.width;
          const ih = refSz?.height ?? baseVp.height;
          const loaded = deserializeJobPhotoAnnotations(rawPayload, iw, ih);
          const synced = syncShapeLabelLegendNumbers(loaded as Annotation[]);
          pdfAnnotationsByPageRef.current.clear();
          pdfAnnotationsByPageRef.current.set(initialPage, synced as Annotation[]);
          setAnnotations(synced as Annotation[]);
          setImageCalibration(readImageCalibrationFromPayload(rawPayload));

          setImageForCanvas(null);
          setImageError(null);
          setEditorMediaKind("pdf");
          setPdfDocRevision((v) => v + 1);
          if (photoToEdit?.annotationTarget?.kind === "measurementPhotos") {
            console.log("[MeasurementPhoto] editor: PDF document ready");
          }
          return;
        }

        let image: HTMLImageElement;

        const isHttpResolved =
          resolvedUrl.startsWith("https://") || resolvedUrl.startsWith("http://");

        try {
          if (isHttpResolved) {
            try {
              image = await loadHtmlImage(resolvedUrl, true);
            } catch {
              image = await loadHtmlImage(resolvedUrl, false);
            }
          } else {
            image = await loadHtmlImage(resolvedUrl, false);
          }
        } catch (firstErr) {
          const pendingFile =
            photoToEdit?.pendingLocalFile ?? measurementCaptureFileRef.current ?? null;
          const tryPendingDataUrl =
            Boolean(photoToEdit?.id?.startsWith("pending-")) && Boolean(pendingFile);
          if (tryPendingDataUrl && pendingFile) {
            try {
              const dataUrl = await readFileAsDataUrlForAnnotation(pendingFile);
              image = await loadHtmlImage(dataUrl, false);
            } catch {
              if (
                resolvedUrl.startsWith("blob:") ||
                resolvedUrl.startsWith("data:")
              ) {
                throw firstErr;
              }
              image = await loadHtmlImage(resolvedUrl, true);
            }
          } else if (
            resolvedUrl.startsWith("blob:") ||
            resolvedUrl.startsWith("data:")
          ) {
            throw firstErr;
          } else {
            image = await loadHtmlImage(resolvedUrl, true);
          }
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

        const srcForLog = String(annotationSource ?? "");
        const durableForAnnotationLog =
          srcForLog.startsWith("https://") || srcForLog.startsWith("http://")
            ? srcForLog
            : resolvedUrl.startsWith("https://") ||
                resolvedUrl.startsWith("http://")
              ? resolvedUrl
              : srcForLog;

        console.log("ANNOTATION IMAGE SOURCE", {
          fileId: photoToEdit?.id,
          imageUrl: durableForAnnotationLog,
          startsWithBlob: durableForAnnotationLog.startsWith("blob:"),
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });
        console.log("[AnnotationEditor:debug]", {
          fileId: photoToEdit?.id,
          imageUrl: durableForAnnotationLog,
          imageLoaded: true,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        });

        setImageForCanvas(image);
        setBaseImageLoaded(true);
        setImageError(null);
        if (photoToEdit?.annotationTarget?.kind === "measurementPhotos") {
          console.log("[MeasurementPhoto] editor: canvas base image ready");
        }

        const raw = photoToEdit
          ? readAnnotationPayloadFromPhotoDoc(photoToEdit as Record<string, unknown>)
          : null;
        const loaded = deserializeJobPhotoAnnotations(
          raw,
          canvas.width,
          canvas.height
        );
        setAnnotations(
          syncShapeLabelLegendNumbers(loaded as Annotation[]) as Annotation[]
        );
        setImageCalibration(readImageCalibrationFromPayload(raw));
        setEditorMediaKind("image");
      } catch (error) {
        if (cancelled) return;

        console.log("[AnnotationEditor:debug]", {
          fileId: photoToEdit?.id,
          imageUrl: annotationSource,
          imageLoaded: false,
          naturalWidth: null,
          naturalHeight: null,
          error: error instanceof Error ? error.message : String(error),
        });
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
    photoToEdit?.pendingObjectUrl,
    photoToEdit?.pendingLocalFile,
    photoToEdit?.fileType,
  ]);

  useEffect(() => {
    if (!editorOpen || editorMediaKind !== "pdf") return;
    const pdf = pdfDocRef.current;
    if (!pdf || pdfNumPages < 1) return;

    let cancelled = false;
    (async () => {
      try {
        setBaseImageLoaded(false);
        const page = await pdf.getPage(pdfPage);
        if (cancelled) return;
        const baseVp = page.getViewport({ scale: 1 });
        pdfBaseSizeRef.current = { w: baseVp.width, h: baseVp.height };
        const vp = page.getViewport({ scale: pdfScale });
        const w = Math.max(1, Math.round(vp.width));
        const h = Math.max(1, Math.round(vp.height));

        let backing = pdfBackingRef.current;
        if (!backing) {
          backing = document.createElement("canvas");
          pdfBackingRef.current = backing;
        }
        backing.width = w;
        backing.height = h;
        const bctx = backing.getContext("2d");
        if (!bctx) throw new Error("2D context");
        bctx.fillStyle = "#ffffff";
        bctx.fillRect(0, 0, w, h);
        await page.render({ canvasContext: bctx, viewport: vp }).promise;
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (canvas && !cancelled) {
          canvas.width = w;
          canvas.height = h;
        }
        console.log("[AnnotationEditor:debug]", {
          imageUrl: "pdf-page",
          imageLoaded: true,
          naturalWidth: w,
          naturalHeight: h,
          canvasWidth: canvas?.width ?? w,
          canvasHeight: canvas?.height ?? h,
        });
        setBaseImageLoaded(true);
        setImageError(null);
      } catch (e) {
        if (cancelled) return;
        console.error("[JobDetailPage] PDF render failed", e);
        setBaseImageLoaded(false);
        setImageError(
          e instanceof Error ? e.message : "PDF se nepodařilo vykreslit."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    editorOpen,
    editorMediaKind,
    pdfDocRevision,
    pdfPage,
    pdfScale,
    pdfNumPages,
  ]);

  const goPdfPage = useCallback(
    (delta: number) => {
      if (editorMediaKindRef.current !== "pdf" || pdfNumPages < 1) return;
      const clamped = Math.max(1, Math.min(pdfNumPages, pdfPage + delta));
      if (clamped === pdfPage) return;
      pdfAnnotationsByPageRef.current.set(pdfPage, annotationsRef.current);
      prevPdfPageRef.current = clamped;
      setPdfPage(clamped);
      setAnnotations(pdfAnnotationsByPageRef.current.get(clamped) ?? []);
    },
    [pdfNumPages, pdfPage]
  );

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImageLoaded) return;
    const isPdf = editorMediaKind === "pdf";
    if (!isPdf && !imageForCanvas) return;
    if (isPdf && !pdfBackingRef.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isPdf) {
      ctx.drawImage(pdfBackingRef.current!, 0, 0);
    } else {
      ctx.drawImage(imageForCanvas!, 0, 0, canvas.width, canvas.height);
    }

    const coordScale = isPdf ? pdfScale : 1;

    const { fontSize, lineWidth, endpointRadius, arrowLen } =
      getScaleAwareSizes(canvas);

    const drawArrowHead = (x: number, y: number, ang: number, fill: string) => {
      ctx.fillStyle = fill;
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
      const sx = a.startX * coordScale;
      const sy = a.startY * coordScale;
      const ex = a.endX * coordScale;
      const ey = a.endY * coordScale;
      const stroke = colorToHex(a.color);
      const lw = typeof (a as any).strokeWidth === "number" ? Number((a as any).strokeWidth) : lineWidth;
      ctx.lineWidth = (isSelected ? lw + 2 : lw) * coordScale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const angle = Math.atan2(ey - sy, ex - sx);
      drawArrowHead(sx, sy, angle + Math.PI, stroke);
      drawArrowHead(ex, ey, angle, stroke);

      const label = (a.label || "").trim();
      if (label) {
        const lfRaw = (a as DimensionAnnotation).labelFontSize;
        const labelFs =
          typeof lfRaw === "number" && Number.isFinite(lfRaw)
            ? Math.max(1, Math.min(100, lfRaw))
            : dimensionLabelFontSize;
        const labelPx = Math.max(1, labelFs) * coordScale;
        const midX = (sx + ex) / 2;
        const midY = (sy + ey) / 2;
        const offset = Math.max(10, labelPx * 0.85);
        const tx = midX - (offset * Math.sin(angle));
        const ty = midY + (offset * Math.cos(angle));
        ctx.font = `700 ${labelPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, labelPx * 0.12);
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(label, tx, ty);
        ctx.fillStyle = stroke;
        ctx.fillText(label, tx, ty);
      }
    };

    const drawMeter = (a: MeterAnnotation, isSelected: boolean) => {
      const sx = a.startX * coordScale;
      const sy = a.startY * coordScale;
      const ex = a.endX * coordScale;
      const ey = a.endY * coordScale;
      const stroke = colorToHex(a.color);
      const lw =
        typeof (a as MeterAnnotation).strokeWidth === "number"
          ? Number((a as MeterAnnotation).strokeWidth)
          : lineWidth;
      ctx.save();
      ctx.setLineDash([5 * coordScale, 4 * coordScale]);
      ctx.lineWidth = (isSelected ? lw + 2 : lw) * coordScale;
      ctx.lineCap = "round";
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = (a.label || "").trim();
      if (label) {
        const midX = (sx + ex) / 2;
        const midY = (sy + ey) / 2;
        const ang = Math.atan2(ey - sy, ex - sx);
        const perp = ang - Math.PI / 2;
        const off = Math.max(12, fontSize * 0.55) * coordScale;
        const tx = midX + Math.cos(perp) * off;
        const ty = midY + Math.sin(perp) * off;
        const fontPx = Math.max(10, Math.round(fontSize * 0.72 * coordScale));
        ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, fontPx * 0.12);
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(label, tx, ty);
        ctx.fillStyle = "#f1f5f9";
        ctx.fillText(label, tx, ty);
      }
      ctx.restore();
    };

    const drawArrowNote = (a: ArrowNoteAnnotation, isSelected: boolean) => {
      const sx = a.startX * coordScale;
      const sy = a.startY * coordScale;
      const ex = a.endX * coordScale;
      const ey = a.endY * coordScale;
      const stroke = colorToHex(a.color);
      const lw =
        typeof a.strokeWidth === "number" && Number.isFinite(a.strokeWidth)
          ? Number(a.strokeWidth)
          : lineWidth;
      const angle = Math.atan2(ey - sy, ex - sx);
      ctx.save();
      ctx.lineWidth = (isSelected ? lw + 2 : lw) * coordScale;
      ctx.lineCap = "round";
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      drawArrowHead(ex, ey, angle, stroke);
      const nfsRaw = a.numFontSize;
      const nfs =
        typeof nfsRaw === "number" && Number.isFinite(nfsRaw)
          ? Math.max(8, Math.min(28, nfsRaw))
          : Math.min(18, Math.max(10, Math.round(fontSize * 0.52)));
      const fontPx = nfs * coordScale;
      const r = Math.max(fontPx * 0.72, 9 * coordScale);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1.25, 1.5 * coordScale);
      ctx.stroke();
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = stroke;
      ctx.fillText(String(a.arrowNumber ?? ""), sx, sy);
      ctx.restore();
    };

    annotations.forEach((a) => {
      const isSelected = a.id === selectedAnnotationId;
      if (a.type === "dimension") drawDimension(a, isSelected);
      if (a.type === "meter") drawMeter(a as MeterAnnotation, isSelected);
      if (a.type === "arrowNote") drawArrowNote(a as ArrowNoteAnnotation, isSelected);
      if (a.type === "note") {
        const na = a as NoteAnnotation;
        const scaled: NoteAnnotation =
          coordScale === 1
            ? na
            : {
                ...na,
                boxX: na.boxX * coordScale,
                boxY: na.boxY * coordScale,
                targetX: na.targetX * coordScale,
                targetY: na.targetY * coordScale,
                boxWidth:
                  na.boxWidth != null ? na.boxWidth * coordScale : undefined,
                boxHeight:
                  na.boxHeight != null ? na.boxHeight * coordScale : undefined,
              };
        drawNoteAnnotationOnCanvas(ctx, canvas, scaled, isSelected, {
          fontSize,
          lineWidth:
            ((typeof (na as any).strokeWidth === "number"
              ? Number((na as any).strokeWidth)
              : lineWidth) * coordScale) || lineWidth,
          endpointRadius,
          arrowLen,
          colorToHex,
        });
      }
      if (a.type === "shapeLabel") {
        const slw =
          (typeof (a as any).strokeWidth === "number"
            ? Number((a as any).strokeWidth)
            : lineWidth) * coordScale;
        drawShapeLabelOnCanvas(
          ctx,
          a as ShapeLabelAnnotation,
          isSelected,
          coordScale,
          colorToHex,
          fontSize,
          slw || lineWidth
        );
      }
    });

    if (noteRectDraft) {
      const bx =
        Math.min(noteRectDraft.x0, noteRectDraft.x1) * coordScale;
      const by =
        Math.min(noteRectDraft.y0, noteRectDraft.y1) * coordScale;
      const bw = Math.abs(noteRectDraft.x1 - noteRectDraft.x0) * coordScale;
      const bh = Math.abs(noteRectDraft.y1 - noteRectDraft.y0) * coordScale;
      ctx.fillStyle = "rgba(250,204,21,0.18)";
      ctx.strokeStyle = "rgba(250,204,21,0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
    }

    if (calibrationDraft) {
      const cd = calibrationDraft;
      const bx = Math.min(cd.x0, cd.x1) * coordScale;
      const by = Math.min(cd.y0, cd.y1) * coordScale;
      const bw = Math.abs(cd.x1 - cd.x0) * coordScale;
      const bh = Math.abs(cd.y1 - cd.y0) * coordScale;
      ctx.strokeStyle = "rgba(34,197,94,0.95)";
      ctx.fillStyle = "rgba(34,197,94,0.12)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
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
    calibrationDraft,
    dimensionLabelFontSize,
    colorToHex,
    editorMediaKind,
    pdfScale,
  ]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  useEffect(() => {
    if (!selectedAnnotationId) return;
    const a = annotations.find((x) => x.id === selectedAnnotationId) as any;
    if (!a) return;
    if (typeof a.strokeWidth === "number" && (a.strokeWidth === 2 || a.strokeWidth === 4 || a.strokeWidth === 6)) {
      setActiveStrokeWidth(a.strokeWidth);
    }
  }, [annotations, selectedAnnotationId]);

  useEffect(() => {
    if (!selectedAnnotationId) return;
    const a = annotations.find((x) => x.id === selectedAnnotationId);
    if (a?.type === "dimension") {
      const lf = (a as DimensionAnnotation).labelFontSize;
      if (typeof lf === "number" && Number.isFinite(lf)) {
        setDimensionLabelFontSize(Math.max(1, Math.min(100, Math.round(lf))));
      }
    }
  }, [annotations, selectedAnnotationId]);

  const getCanvasCoordsFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return screenToDocumentPointClamped(canvas, clientX, clientY, {
      mediaKind: editorMediaKind === "pdf" ? "pdf" : "image",
      pdfScale,
    });
  };

  const hitTestCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return screenToDocumentPoint(canvas, clientX, clientY, {
      mediaKind: editorMediaKindRef.current === "pdf" ? "pdf" : "image",
      pdfScale: pdfScaleRef.current,
    });
  }, []);

  const hitTestAnnotation = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const { hitRadius, fontSize, endpointRadius } = getScaleAwareSizes(canvas);
      const isPdf = editorMediaKind === "pdf";
      const s = Math.max(1e-6, pdfScale);
      const hrDim = isPdf ? hitRadius / s : hitRadius;
      const xN = isPdf ? x * s : x;
      const yN = isPdf ? y * s : y;

      for (let i = annotations.length - 1; i >= 0; i--) {
        const a = annotations[i];
        if (a.type === "shapeLabel") {
          const sl = a as ShapeLabelAnnotation;
          const part = hitTestShapeLabel(sl, x, y, hrDim, {
            lockResize: Boolean(sl.modelId?.trim()),
          });
          if (part === "resize-br")
            return { id: a.id, part: "shape-resize-br" as const };
          if (part === "move") return { id: a.id, part: "shape-move" as const };
        }
      }

      for (let i = annotations.length - 1; i >= 0; i--) {
        const a = annotations[i];

        if (a.type === "dimension") {
          const nearStart = distance(x, y, a.startX, a.startY) <= hrDim;
          if (nearStart) return { id: a.id, part: "dim-start" as const };
          const nearEnd = distance(x, y, a.endX, a.endY) <= hrDim;
          if (nearEnd) return { id: a.id, part: "dim-end" as const };

          const dLine = distancePointToSegment(
            x,
            y,
            a.startX,
            a.startY,
            a.endX,
            a.endY
          );
          if (dLine <= hrDim) return { id: a.id, part: "dim-move" as const };
        }

        if (a.type === "meter") {
          const m = a as MeterAnnotation;
          const nearStart = distance(x, y, m.startX, m.startY) <= hrDim;
          if (nearStart) return { id: a.id, part: "meter-start" as const };
          const nearEnd = distance(x, y, m.endX, m.endY) <= hrDim;
          if (nearEnd) return { id: a.id, part: "meter-end" as const };
          const dLine = distancePointToSegment(
            x,
            y,
            m.startX,
            m.startY,
            m.endX,
            m.endY
          );
          if (dLine <= hrDim) return { id: a.id, part: "meter-move" as const };
        }

        if (a.type === "arrowNote") {
          const ar = a as ArrowNoteAnnotation;
          const nfsRaw = ar.numFontSize;
          const nfs =
            typeof nfsRaw === "number" && Number.isFinite(nfsRaw)
              ? Math.max(8, Math.min(28, nfsRaw))
              : Math.min(18, Math.max(10, Math.round(fontSize * 0.52)));
          const rDoc = Math.max(nfs * 0.85, 11, hrDim * 0.9);
          const nearStart = distance(x, y, ar.startX, ar.startY) <= rDoc;
          if (nearStart) return { id: a.id, part: "arrow-start" as const };
          const nearEnd = distance(x, y, ar.endX, ar.endY) <= hrDim;
          if (nearEnd) return { id: a.id, part: "arrow-end" as const };
          const dLine = distancePointToSegment(
            x,
            y,
            ar.startX,
            ar.startY,
            ar.endX,
            ar.endY
          );
          if (dLine <= hrDim) return { id: a.id, part: "arrow-move" as const };
        }

        if (a.type === "note") {
          const na = a as NoteAnnotation;
          const noteForLayout: NoteAnnotation = isPdf
            ? {
                ...na,
                boxX: na.boxX * s,
                boxY: na.boxY * s,
                targetX: na.targetX * s,
                targetY: na.targetY * s,
                boxWidth:
                  na.boxWidth != null ? na.boxWidth * s : undefined,
                boxHeight:
                  na.boxHeight != null ? na.boxHeight * s : undefined,
              }
            : na;
          const layout = computeNoteLayout(noteForLayout, canvas, ctx, fontSize);

          if (
            selectedAnnotationId === a.id &&
            layout.explicitBox &&
            typeof a.boxWidth === "number" &&
            typeof a.boxHeight === "number"
          ) {
            const h = noteResizeHandleSize(endpointRadius);
            const hx = layout.boxX + layout.boxW - h;
            const hy = layout.boxY + layout.boxH - h;
            if (xN >= hx && xN <= hx + h && yN >= hy && yN <= hy + h) {
              return { id: a.id, part: "note-resize-br" as const };
            }
          }

          const inBox =
            xN >= layout.boxX &&
            xN <= layout.boxX + layout.boxW &&
            yN >= layout.boxY &&
            yN <= layout.boxY + layout.boxH;
          if (inBox) return { id: a.id, part: "note-box" as const };

          if (a.showArrow !== false) {
            const nearTarget =
              distance(xN, yN, noteForLayout.targetX, noteForLayout.targetY) <=
              hitRadius;
            if (nearTarget) return { id: a.id, part: "note-target" as const };
          }
        }
      }

      return null;
    },
    [annotations, selectedAnnotationId, editorMediaKind, pdfScale]
  );

  const updateSelectedColor = useCallback(
    (newColor: DimensionColor) => {
      setActiveColor(newColor);
      if (!selectedAnnotationId) return;
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedAnnotationId &&
          (a.type === "dimension" ||
            a.type === "note" ||
            a.type === "shapeLabel" ||
            a.type === "meter" ||
            a.type === "arrowNote")
            ? { ...a, color: newColor }
            : a
        )
      );
    },
    [selectedAnnotationId]
  );

  const updateSelectedStrokeWidth = useCallback(
    (w: 2 | 4 | 6) => {
      setActiveStrokeWidth(w);
      if (!selectedAnnotationId) return;
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedAnnotationId &&
          (a.type === "dimension" ||
            a.type === "note" ||
            a.type === "shapeLabel" ||
            a.type === "meter" ||
            a.type === "arrowNote")
            ? ({ ...(a as any), strokeWidth: w } as any)
            : a
        )
      );
    },
    [selectedAnnotationId]
  );

  const updateDimensionLabelFontSize = useCallback(
    (px: number) => {
      const v = Math.max(1, Math.min(100, Math.round(Number(px) || 16)));
      setDimensionLabelFontSize(v);
      if (!selectedAnnotationId) return;
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === selectedAnnotationId && a.type === "dimension"
            ? { ...(a as DimensionAnnotation), labelFontSize: v }
            : a
        )
      );
    },
    [selectedAnnotationId]
  );

  const editSelectedText = useCallback(() => {
    if (!selectedAnnotationId) return;
    const a = annotations.find((x) => x.id === selectedAnnotationId);
    if (!a) return;
    if (a.type === "shapeLabel") {
      const s = a as ShapeLabelAnnotation;
      setShapeLabelForm({
        shape: s.shape,
        label: s.label,
        widthMm: s.widthMm,
        heightMm: s.heightMm,
        note: s.note ?? "",
        legendDescription: s.legendDescription ?? "",
        showLabelInline: s.showLabelInline,
        modelId: s.modelId,
      });
      setShapeLabelEditingId(s.id);
      pendingShapePointRef.current = null;
      setShapeLabelDialogOpen(true);
      return;
    }
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
    if (a.type === "meter") {
      const next = window.prompt("Upravit popisek měření:", a.label || "") ?? null;
      if (next === null) return;
      setAnnotations((prev) =>
        prev.map((x) =>
          x.id === a.id && x.type === "meter"
            ? { ...x, label: next.trim() }
            : x
        )
      );
      return;
    }
    if (a.type === "arrowNote") {
      const ar = a as ArrowNoteAnnotation;
      setArrowNoteEditId(ar.id);
      setArrowNoteEditText(ar.description || "");
      setArrowNoteIsNew(false);
      setArrowNoteDialogOpen(true);
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
    if (annotationReadOnly) return;
    setAnnotations((prev) =>
      syncShapeLabelLegendNumbers(prev.filter((a) => a.id !== selectedAnnotationId))
    );
    setSelectedAnnotationId(null);
    setDraftAnnotationId(null);
    setDragMode("none");
    setDragLastPoint(null);
  }, [selectedAnnotationId, annotationReadOnly]);

  const arrowNoteSavedRef = useRef(false);

  const closeArrowNoteDialogUi = useCallback(() => {
    setArrowNoteDialogOpen(false);
    setArrowNoteEditId(null);
    setArrowNoteEditText("");
    setArrowNoteIsNew(false);
  }, []);

  const cancelArrowNoteDialog = useCallback(() => {
    const id = arrowNoteEditId;
    const wasNew = arrowNoteIsNew;
    if (wasNew && id) {
      setAnnotations((prev) => prev.filter((x) => x.id !== id));
      setSelectedAnnotationId(null);
    }
    closeArrowNoteDialogUi();
  }, [arrowNoteEditId, arrowNoteIsNew, closeArrowNoteDialogUi]);

  const saveArrowNoteDialog = useCallback(() => {
    const id = arrowNoteEditId;
    if (!id) return;
    const t = arrowNoteEditText.trim();
    if (!t) {
      toast({
        variant: "destructive",
        title: "Popis šipky",
        description: "Zadejte neprázdný popis.",
      });
      return;
    }
    const now = Date.now();
    arrowNoteSavedRef.current = true;
    setAnnotations((prev) =>
      prev.map((x) =>
        x.id === id && x.type === "arrowNote"
          ? { ...(x as ArrowNoteAnnotation), description: t, updatedAt: now }
          : x
      )
    );
    closeArrowNoteDialogUi();
    setDraftAnnotationId(null);
  }, [arrowNoteEditId, arrowNoteEditText, closeArrowNoteDialogUi, toast]);

  const commitShapeLabelFromDialog = useCallback(() => {
    const point = pendingShapePointRef.current;
    const editing = shapeLabelEditingId;
    if (!editing && !point) {
      setShapeLabelDialogOpen(false);
      return;
    }
    if (editing) {
      setAnnotations((prev) =>
        syncShapeLabelLegendNumbers(
          prev.map((a) => {
            if (a.id !== editing || a.type !== "shapeLabel") return a;
            const cur = a as ShapeLabelAnnotation;
            const mid = shapeLabelForm.modelId?.trim() || cur.modelId?.trim();
            const fromLibrary = Boolean(mid);
            const wm = fromLibrary ? cur.widthMm : Number(shapeLabelForm.widthMm) || 0;
            const hm = fromLibrary ? cur.heightMm : Number(shapeLabelForm.heightMm) || 0;
            const eff = effectiveShapeLabelMm(wm, hm);
            const { docW, docH } = readAnnotationDocumentDimensions(
              canvasRef.current,
              editorMediaKindRef.current === "pdf" ? "pdf" : "image",
              pdfScaleRef.current,
              imageForCanvas
            );
            const shape = (fromLibrary ? cur.shape : shapeLabelForm.shape) as ShapeLabelAnnotation["shape"];
            const rect = shapeLabelAnnotationPixelRect(
              shape,
              eff.widthMm,
              eff.heightMm,
              docW,
              docH
            );
            const cx = cur.x + cur.width / 2;
            const cy = cur.y + cur.height / 2;
            return {
              ...cur,
              shape,
              label: shapeLabelForm.label.trim(),
              widthMm: eff.widthMm,
              heightMm: eff.heightMm,
              width: rect.width,
              height: rect.height,
              x: cx - rect.width / 2,
              y: cy - rect.height / 2,
              note: shapeLabelForm.note.trim() || undefined,
              legendDescription: shapeLabelForm.legendDescription.trim() || undefined,
              showLabelInline: shapeLabelForm.showLabelInline,
              color: activeColor,
              modelId: mid || cur.modelId,
            };
          })
        )
      );
    } else if (point) {
      const { docW, docH } = readAnnotationDocumentDimensions(
        canvasRef.current,
        editorMediaKindRef.current === "pdf" ? "pdf" : "image",
        pdfScaleRef.current,
        imageForCanvas
      );
      const eff = effectiveShapeLabelMm(
        Number(shapeLabelForm.widthMm),
        Number(shapeLabelForm.heightMm)
      );
      const rect = shapeLabelAnnotationPixelRect(
        shapeLabelForm.shape,
        eff.widthMm,
        eff.heightMm,
        docW,
        docH
      );
      const bx = point.x - rect.width / 2;
      const by = point.y - rect.height / 2;
      const id = createId();
      const mid = shapeLabelForm.modelId?.trim();
      const row: ShapeLabelAnnotation = {
        id,
        type: "shapeLabel",
        shape: shapeLabelForm.shape,
        pageIndex: point.pageIndex,
        x: bx,
        y: by,
        width: rect.width,
        height: rect.height,
        widthMm: eff.widthMm,
        heightMm: eff.heightMm,
        label: shapeLabelForm.label.trim(),
        note: shapeLabelForm.note.trim() || undefined,
        legendDescription: shapeLabelForm.legendDescription.trim() || undefined,
        legendNumber: 1,
        showLabelInline: shapeLabelForm.showLabelInline,
        color: activeColor,
        createdAt: Date.now(),
      };
      if (mid) row.modelId = mid;
      setAnnotations((prev) => syncShapeLabelLegendNumbers([...prev, row]));
    }
    pendingShapePointRef.current = null;
    setShapeLabelDialogOpen(false);
    setShapeLabelEditingId(null);
  }, [activeColor, shapeLabelForm, shapeLabelEditingId, imageForCanvas]);

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
    pendingShapePointRef.current = null;
  }, [annotations.length]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!baseImageLoaded) return;
    if (!canvasRef.current) return;
    if (editorMediaKindRef.current !== "pdf" && !imageForCanvas) return;
    e.preventDefault();
    if (annotationReadOnly) return;

    pointerMapRef.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
    });

    if (isAnnotTouchUI) {
      const touchEntries = [...pointerMapRef.current.entries()].filter(
        ([, v]) => v.pointerType === "touch"
      );
      if (touchEntries.length >= 2) {
        const te = touchEntries.slice(0, 2);
        const p1 = { x: te[0][1].clientX, y: te[0][1].clientY };
        const p2 = { x: te[1][1].clientX, y: te[1][1].clientY };
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (dist >= 8) {
          const av = annotationViewRef.current;
          pinchSessionRef.current = {
            anchorDist: dist,
            anchorZoom:
              editorMediaKindRef.current === "pdf"
                ? pdfScaleRef.current
                : av.zoom,
            anchorPanX: av.panX,
            anchorPanY: av.panY,
            anchorMidX: (p1.x + p2.x) / 2,
            anchorMidY: (p1.y + p2.y) / 2,
          };
        }
        const dId = draftAnnotationIdRef.current;
        setNoteRectDraft(null);
        setCalibrationDraft(null);
        setDragMode("none");
        setDragLastPoint(null);
        if (dId) {
          setAnnotations((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            if (
              (last?.type === "dimension" ||
                last?.type === "meter" ||
                last?.type === "arrowNote") &&
              last.id === dId
            ) {
              const len = Math.hypot(
                last.endX - last.startX,
                last.endY - last.startY
              );
              if (len < 10) return prev.slice(0, -1);
            }
            return prev;
          });
        }
        setDraftAnnotationId(null);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
    }

    if (e.button === 1) {
      viewPanStartRef.current = {
        cx: e.clientX,
        cy: e.clientY,
        panX: annotationViewRef.current.panX,
        panY: annotationViewRef.current.panY,
      };
      setDragMode("view-pan");
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    if (activeTool === "pan") {
      viewPanStartRef.current = {
        cx: e.clientX,
        cy: e.clientY,
        panX: annotationViewRef.current.panX,
        panY: annotationViewRef.current.panY,
      };
      setDragMode("view-pan");
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    const ptStrict = hitTestCanvasPoint(e.clientX, e.clientY);
    const pt = getCanvasCoordsFromClient(e.clientX, e.clientY);
    const hit = ptStrict ? hitTestAnnotation(ptStrict.x, ptStrict.y) : null;

    if (activeTool === "calibrate") {
      setSelectedAnnotationId(null);
      setDraftAnnotationId(null);
      setCalibrationDraft({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      setDragMode("calibration-draw");
      setDragLastPoint(pt);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    // Allow selecting/moving existing shape labels even when another tool is active.
    if (
      hit &&
      ((hit as any).part === "shape-move" || (hit as any).part === "shape-resize-br")
    ) {
      setSelectedAnnotationId(hit.id);
      setDraftAnnotationId(hit.id);
      setDragMode((hit as any).part as DragMode);
      setDragLastPoint(pt);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }

    if (activeTool === "dimension") {
      if (
        hit &&
        (hit.part === "dim-start" ||
          hit.part === "dim-end" ||
          hit.part === "dim-move")
      ) {
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
        strokeWidth: activeStrokeWidth,
        pageIndex:
          editorMediaKindRef.current === "pdf" ? Math.max(0, pdfPageRef.current - 1) : 0,
      };
      setAnnotations((prev) => [...prev, a]);
      setSelectedAnnotationId(id);
      setDraftAnnotationId(id);
      setDragMode("dim-draw");
      setDragLastPoint(pt);
      return;
    }

    if (activeTool === "meter") {
      if (
        hit &&
        (hit.part === "meter-start" ||
          hit.part === "meter-end" ||
          hit.part === "meter-move")
      ) {
        setSelectedAnnotationId(hit.id);
        setDraftAnnotationId(hit.id);
        setDragMode(hit.part as DragMode);
        setDragLastPoint(pt);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      const id = createId();
      const pageIxM =
        editorMediaKindRef.current === "pdf" ? Math.max(0, pdfPageRef.current - 1) : 0;
      const a: MeterAnnotation = {
        id,
        type: "meter",
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y,
        measuredMm: 0,
        label: "",
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        pageIndex: pageIxM,
      };
      setAnnotations((prev) => [...prev, a]);
      setSelectedAnnotationId(id);
      setDraftAnnotationId(id);
      setDragMode("meter-draw");
      setDragLastPoint(pt);
      return;
    }

    if (activeTool === "arrow") {
      if (
        hit &&
        (hit.part === "arrow-start" ||
          hit.part === "arrow-end" ||
          hit.part === "arrow-move")
      ) {
        setSelectedAnnotationId(hit.id);
        setDraftAnnotationId(hit.id);
        setDragMode(hit.part as DragMode);
        setDragLastPoint(pt);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      const id = createId();
      const pageIxAr =
        editorMediaKindRef.current === "pdf" ? Math.max(0, pdfPageRef.current - 1) : 0;
      setAnnotations((prev) => {
        const num = nextArrowNoteNumber(prev);
        const row: ArrowNoteAnnotation = {
          id,
          type: "arrowNote",
          startX: pt.x,
          startY: pt.y,
          endX: pt.x,
          endY: pt.y,
          arrowNumber: num,
          description: "",
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          pageIndex: pageIxAr,
          createdAt: Date.now(),
        };
        return [...prev, row];
      });
      setSelectedAnnotationId(id);
      setDraftAnnotationId(id);
      setDragMode("arrow-draw");
      setDragLastPoint(pt);
      return;
    }

    if (activeTool === "note") {
      if (
        hit &&
        (hit.part === "note-target" ||
          hit.part === "note-box" ||
          hit.part === "note-resize-br")
      ) {
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

    if (activeTool === "shapeLabel") {
      if (
        hit &&
        ((hit as any).part === "shape-move" || (hit as any).part === "shape-resize-br")
      ) {
        setSelectedAnnotationId(hit.id);
        setDraftAnnotationId(hit.id);
        setDragMode((hit as any).part as DragMode);
        setDragLastPoint(pt);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
      const plm = shapeLabelPlacementModelRef.current;
      if (plm && e.button === 0) {
        const pageIxPl =
          editorMediaKindRef.current === "pdf"
            ? Math.max(0, pdfPageRef.current - 1)
            : 0;
        const { docW, docH } = readAnnotationDocumentDimensions(
          canvasRef.current,
          editorMediaKindRef.current === "pdf" ? "pdf" : "image",
          pdfScaleRef.current,
          imageForCanvas
        );
        const sh = plm.shape as ShapeLabelAnnotation["shape"];
        const rect = shapeLabelAnnotationPixelRect(
          sh,
          plm.widthMm,
          plm.heightMm,
          docW,
          docH
        );
        const bx = pt.x - rect.width / 2;
        const by = pt.y - rect.height / 2;
        const id = createId();
        const col = dimensionColorFromModelColor(plm.color);
        const effPlm = effectiveShapeLabelMm(plm.widthMm, plm.heightMm);
        setAnnotations((prev) => {
          const nextShape: ShapeLabelAnnotation = {
            id,
            type: "shapeLabel",
            shape: sh,
            pageIndex: pageIxPl,
            x: bx,
            y: by,
            width: rect.width,
            height: rect.height,
            widthMm: effPlm.widthMm,
            heightMm: effPlm.heightMm,
            label: plm.name.trim() || "Model",
            legendDescription: plm.legendDescription?.trim() || undefined,
            note: undefined,
            legendNumber: 1,
            showLabelInline: false,
            color: col,
            strokeWidth: activeStrokeWidth,
            createdAt: Date.now(),
            modelId: plm.id,
          };
          return syncShapeLabelLegendNumbers([...prev, nextShape]);
        });
        setShapeLabelPlacementModel(null);
        shapeLabelPlacementModelRef.current = null;
        return;
      }
      if (e.button === 0) {
        setSelectedAnnotationId(null);
        setDraftAnnotationId(null);
        pendingShapePointRef.current = {
          x: pt.x,
          y: pt.y,
          pageIndex:
            editorMediaKindRef.current === "pdf"
              ? Math.max(0, pdfPageRef.current - 1)
              : 0,
        };
        setShapeLabelForm((prev) => ({
          ...prev,
          shape: "point",
          label: "",
          widthMm: 600,
          heightMm: 600,
          note: "",
          legendDescription: "",
          showLabelInline: false,
          modelId: undefined,
        }));
        setShapeLabelEditingId(null);
        setShapeLabelDialogOpen(true);
      }
      return;
    }

    // select tool
    if (hit) {
      setSelectedAnnotationId(hit.id);
      setDraftAnnotationId(hit.id);
      setDragMode(hit.part as DragMode);
      setDragLastPoint(pt);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    } else {
      setSelectedAnnotationId(null);
      setDraftAnnotationId(null);
      const zoomed =
        editorMediaKindRef.current === "pdf"
          ? pdfScaleRef.current > PDF_EDITOR_SCALE_MIN + 0.01 ||
            Math.abs(annotationViewRef.current.panX) > 1 ||
            Math.abs(annotationViewRef.current.panY) > 1
          : annotationViewRef.current.zoom > ANNOTATION_VIEW_ZOOM_MIN + 0.01 ||
            Math.abs(annotationViewRef.current.panX) > 1 ||
            Math.abs(annotationViewRef.current.panY) > 1;
      const canPanView =
        zoomed &&
        (isAnnotTouchUI
          ? e.pointerType === "touch"
          : activeTool === "select");
      if (canPanView) {
        setDragMode("view-pan");
        viewPanStartRef.current = {
          cx: e.clientX,
          cy: e.clientY,
          panX: annotationViewRef.current.panX,
          panY: annotationViewRef.current.panY,
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
      setDragMode("none");
      setDragLastPoint(null);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!baseImageLoaded) return;
    if (editorMediaKindRef.current !== "pdf" && !imageForCanvas) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (pointerMapRef.current.has(e.pointerId)) {
      const prev = pointerMapRef.current.get(e.pointerId)!;
      pointerMapRef.current.set(e.pointerId, {
        ...prev,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    }

    if (isAnnotTouchUI && pinchSessionRef.current) {
      const touchPts = [...pointerMapRef.current.entries()]
        .filter(([, v]) => v.pointerType === "touch")
        .map(([, v]) => ({ x: v.clientX, y: v.clientY }));
      if (touchPts.length >= 2) {
        e.preventDefault();
        const p1 = touchPts[0];
        const p2 = touchPts[1];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const s = pinchSessionRef.current;
        const scaleRatio = dist / s.anchorDist;
        const dmx = mid.x - s.anchorMidX;
        const dmy = mid.y - s.anchorMidY;
        if (editorMediaKindRef.current === "pdf") {
          const newScale = clampPdfScale(s.anchorZoom * scaleRatio);
          setPdfScale(newScale);
          setAnnotationView({
            zoom: 1,
            panX: s.anchorPanX + dmx,
            panY: s.anchorPanY + dmy,
          });
        } else {
          const newZoom = Math.min(
            ANNOTATION_VIEW_ZOOM_MAX,
            Math.max(ANNOTATION_VIEW_ZOOM_MIN, s.anchorZoom * scaleRatio)
          );
          setAnnotationView({
            zoom: newZoom,
            panX: s.anchorPanX + dmx,
            panY: s.anchorPanY + dmy,
          });
        }
        return;
      }
    }

    if (dragMode === "view-pan") {
      e.preventDefault();
      const st = viewPanStartRef.current;
      if (st) {
        setAnnotationView({
          zoom: editorMediaKindRef.current === "pdf" ? 1 : annotationViewRef.current.zoom,
          panX: st.panX + (e.clientX - st.cx),
          panY: st.panY + (e.clientY - st.cy),
        });
      }
      return;
    }

    const pt = getCanvasCoordsFromClient(e.clientX, e.clientY);

    if (dragMode === "note-rect-draw") {
      e.preventDefault();
      setNoteRectDraft((d) =>
        d ? { ...d, x1: pt.x, y1: pt.y } : null
      );
      return;
    }

    if (dragMode === "calibration-draw") {
      e.preventDefault();
      setCalibrationDraft((d) =>
        d ? { ...d, x1: pt.x, y1: pt.y } : { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
      );
      setDragLastPoint(pt);
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

        if (a.type === "meter") {
          if (dragMode === "meter-draw" || dragMode === "meter-end") {
            return { ...a, endX: pt.x, endY: pt.y };
          }
          if (dragMode === "meter-start") {
            return { ...a, startX: pt.x, startY: pt.y };
          }
          if (dragMode === "meter-move") {
            return {
              ...a,
              startX: a.startX + dx,
              startY: a.startY + dy,
              endX: a.endX + dx,
              endY: a.endY + dy,
            };
          }
        }

        if (a.type === "arrowNote") {
          if (dragMode === "arrow-draw" || dragMode === "arrow-end") {
            return { ...a, endX: pt.x, endY: pt.y };
          }
          if (dragMode === "arrow-start") {
            return { ...a, startX: pt.x, startY: pt.y };
          }
          if (dragMode === "arrow-move") {
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
            const pdfS = Math.max(1e-6, pdfScaleRef.current);
            const isPdf = editorMediaKindRef.current === "pdf";
            const cwBase = isPdf ? canvas.width / pdfS : canvas.width;
            const chBase = isPdf ? canvas.height / pdfS : canvas.height;
            const maxW = cwBase - a.boxX;
            const maxH = chBase - a.boxY;
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

        if (a.type === "shapeLabel") {
          const sh = a as ShapeLabelAnnotation;
          if (dragMode === "shape-move") {
            return { ...sh, x: sh.x + dx, y: sh.y + dy };
          }
          if (dragMode === "shape-resize-br") {
            if (sh.modelId?.trim()) return sh;
            const pdfS = Math.max(1e-6, pdfScaleRef.current);
            const isPdf = editorMediaKindRef.current === "pdf";
            const cwBase = isPdf ? canvas.width / pdfS : canvas.width;
            const chBase = isPdf ? canvas.height / pdfS : canvas.height;
            const maxW = cwBase - sh.x;
            const maxH = chBase - sh.y;
            let newW = Math.max(0.25, Math.min(pt.x - sh.x, maxW));
            let newH = Math.max(0.25, Math.min(pt.y - sh.y, maxH));
            if (sh.shape === "square" || sh.shape === "circle") {
              const side = Math.min(newW, newH);
              newW = side;
              newH = side;
            }
            return { ...sh, width: newW, height: newH };
          }
        }

        return a;
      })
    );

    setDragLastPoint(pt);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!baseImageLoaded) return;
    if (editorMediaKindRef.current !== "pdf" && !imageForCanvas) return;

    pointerMapRef.current.delete(e.pointerId);
    const touchesRemain = [...pointerMapRef.current.values()].filter(
      (v) => v.pointerType === "touch"
    ).length;
    if (touchesRemain < 2) pinchSessionRef.current = null;

    if (dragMode === "view-pan") {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setDragMode("none");
      viewPanStartRef.current = null;
      setDragLastPoint(null);
      return;
    }

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
        strokeWidth: activeStrokeWidth,
        showArrow: false,
        pageIndex:
          editorMediaKindRef.current === "pdf" ? Math.max(0, pdfPageRef.current - 1) : 0,
      };
      setAnnotations((prev) => [...prev, note]);
      setSelectedAnnotationId(id);
      setDraftAnnotationId(null);
      return;
    }

    if (dragMode === "calibration-draw") {
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const d = calibrationDraftRef.current;
      setCalibrationDraft(null);
      setDragMode("none");
      setDragLastPoint(null);
      if (!d) return;
      const len = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
      if (len < 8) {
        toast({
          variant: "destructive",
          title: "Měřítko",
          description: "Usečka je příliš krátká. Zkuste to znovu.",
        });
        return;
      }
      const raw = window.prompt("Skutečná délka úsečky v mm:", "") ?? null;
      if (raw === null) return;
      const mm = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(mm) || mm <= 0) {
        toast({
          variant: "destructive",
          title: "Měřítko",
          description: "Zadejte kladné číslo v milimetrech.",
        });
        return;
      }
      setImageCalibration({ pxPerMm: len / mm });
      toast({
        title: "Měřítko uloženo",
        description: `Kalibrace: ${len.toFixed(1)} px odpovídá ${mm} mm.`,
      });
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

    if (a?.type === "meter" && dragMode === "meter-draw") {
      const len = distance(a.startX, a.startY, a.endX, a.endY);
      if (len < 8) {
        setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
        setSelectedAnnotationId(null);
        setDraftAnnotationId(null);
        setDragMode("none");
        setDragLastPoint(null);
        return;
      }
      const cal = imageCalibrationRef.current;
      if (!cal || !Number.isFinite(cal.pxPerMm) || cal.pxPerMm <= 0) {
        toast({
          variant: "destructive",
          title: "Metr",
          description:
            "Nejprve nastavte měřítko: označte známou vzdálenost a zadejte hodnotu v mm.",
        });
        setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
        setSelectedAnnotationId(null);
        setDraftAnnotationId(null);
        setDragMode("none");
        setDragLastPoint(null);
        return;
      }
      const measuredMm = len / cal.pxPerMm;
      const label = formatMeasuredMmCs(measuredMm);
      setAnnotations((prev) =>
        prev.map((x) =>
          x.id === a.id && x.type === "meter" ? { ...x, measuredMm, label } : x
        )
      );
    }

    if (a?.type === "arrowNote" && dragMode === "arrow-draw") {
      const len = distance(a.startX, a.startY, a.endX, a.endY);
      if (len < 8) {
        setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
        setSelectedAnnotationId(null);
        setDraftAnnotationId(null);
        setDragMode("none");
        setDragLastPoint(null);
        return;
      }
      setArrowNoteEditId(a.id);
      setArrowNoteEditText("");
      setArrowNoteIsNew(true);
      setArrowNoteDialogOpen(true);
    }

    if (
      a?.type === "meter" &&
      dragMode !== "meter-draw" &&
      (dragMode === "meter-start" ||
        dragMode === "meter-end" ||
        dragMode === "meter-move")
    ) {
      const cal = imageCalibrationRef.current;
      if (cal && Number.isFinite(cal.pxPerMm) && cal.pxPerMm > 0) {
        setAnnotations((prev) =>
          prev.map((x) => {
            if (x.id !== a.id || x.type !== "meter") return x;
            const len = Math.hypot(x.endX - x.startX, x.endY - x.startY);
            const mm = len / cal.pxPerMm;
            return { ...x, measuredMm: mm, label: formatMeasuredMmCs(mm) };
          })
        );
      }
    }

    setDragMode("none");
    setDragLastPoint(null);
  };

  const handlePhotoUpload = async (
    file: File,
    uploadOpts?: { skipUploadingFlag?: boolean }
  ): Promise<boolean> => {
    const manageUploadingFlag = !uploadOpts?.skipUploadingFlag;

    if (!file || file.size === 0) {
      toast({
        variant: "destructive",
        title: "Soubor nebyl vybrán",
        description: "Nebyl vybrán žádný soubor nebo je soubor prázdný.",
      });
      return false;
    }

    if (!isAllowedJobMediaFile(file)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný soubor",
        description: "Použijte JPG, PNG, WEBP nebo PDF.",
      });
      return false;
    }

    if (file.size > MAX_JOB_PHOTO_BYTES) {
      toast({
        variant: "destructive",
        title: "Soubor je příliš velký",
        description: `Maximální velikost je ${Math.round(MAX_JOB_PHOTO_BYTES / (1024 * 1024))} MB.`,
      });
      return false;
    }

    if (!companyId || !jobId || !photosColRef || !user || !firestore) {
      toast({
        variant: "destructive",
        title: "Nelze nahrát fotografii",
        description: "Chybí identifikace zakázky nebo uživatele.",
      });
      return false;
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
        return false;
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
      return true;
    } catch (err: unknown) {
      console.error("[JobPhotoUpload] upload error", err);
      toast({
        variant: "destructive",
        title: jobPhotoUploadErrorTitle(err),
        description: describeStorageUploadFailure(err),
      });
      return false;
    } finally {
      if (manageUploadingFlag) {
        setIsUploading(false);
      }
    }
  };

  /**
   * Foto zaměření: bez okamžitého uploadu — až po „Uložit anotaci“ v editoru.
   * Object URL + soubor v paměti; `resolveAnnotationImageUrl` musí podporovat `blob:`.
   */
  const handleMeasurementPhotoQuickImport = useCallback(
    (
      file: File | null | undefined,
      meta?: {
        title?: string;
        note?: string;
        measurementId?: string | null;
      }
    ) => {
      if (!file || !companyId || !user?.uid) return;
      if (!isAllowedJobImageFile(file)) {
        toast({
          variant: "destructive",
          title: "Nepodporovaný soubor",
          description: "Vyberte obrázek (JPG, PNG, WebP …).",
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

      const objectUrl = URL.createObjectURL(file);
      const tempId = `pending-${
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      }`;
      measurementCaptureFileRef.current = file;

      const target: JobPhotoAnnotationTarget = {
        id: tempId,
        imageUrl: objectUrl,
        originalImageUrl: objectUrl,
        annotationTarget: { kind: "measurementPhotos" },
        measurementPhotoId: tempId,
        pendingLocalFile: file,
        pendingObjectUrl: objectUrl,
        pendingMeasurementTitle: meta?.title?.trim() || null,
        pendingMeasurementNote: meta?.note?.trim() || null,
        pendingMeasurementRecordId: meta?.measurementId?.trim() || null,
      };

      console.log("[MeasurementPhoto] quickImport: file selected, opening annotation editor", {
        tempId,
        name: file.name,
      });
      setMeasurementCaptureBusy(true);
      measurementEditorReturnToRef.current = null;
      setPhotoToEdit(target);
      setMeasurementCaptureBusy(false);
      requestAnimationFrame(() => {
        if (measurementGalleryInputRef.current) measurementGalleryInputRef.current.value = "";
        if (measurementCameraInputRef.current) measurementCameraInputRef.current.value = "";
      });
    },
    [companyId, user?.uid, toast]
  );

  useEffect(() => {
    if (searchParams.get("measurementPending") !== "1") {
      measurementPendingNavHandledKeyRef.current = null;
      return;
    }
    const rtPending = sanitizeMeasurementEditorReturnTo(
      searchParams.get("returnTo")
    );
    if (rtPending) measurementEditorReturnToRef.current = rtPending;
    if (!companyId) return;
    const idbJobKey =
      isStandaloneMeasurementEditorRoute && !jobIdParam
        ? MEASUREMENT_PHOTO_PENDING_EDITOR_ROUTE_JOB_ID
        : jobIdParam;
    if (!idbJobKey) return;
    if (!user?.uid) {
      toast({
        variant: "destructive",
        title: "Foto zaměření",
        description: "Nejste přihlášeni — nelze otevřít editor.",
      });
      router.replace(measurementEditorStripPath, { scroll: false });
      return;
    }
    const navKey = `pending:${idbJobKey}`;
    if (measurementPendingNavHandledKeyRef.current === navKey) {
      return;
    }
    measurementPendingNavHandledKeyRef.current = navKey;

    void (async () => {
      try {
        const peeked = await peekPendingJobMeasurementFile(idbJobKey);
        if (!peeked?.file) {
          measurementPendingNavHandledKeyRef.current = null;
          console.warn("[MeasurementPhoto] measurementPending: no file in IndexedDB");
          toast({
            variant: "destructive",
            title: "Foto zaměření",
            description:
              "Soubor se nepodařilo načíst. Zkuste fotku znovu v sekci Zakázky → Foto zaměření.",
          });
          router.replace(measurementEditorStripPath, { scroll: false });
          return;
        }
        console.log("[MeasurementPhoto] measurementPending: opening editor", {
          jobId: idbJobKey,
          name: peeked.file.name,
          size: peeked.file.size,
        });
        handleMeasurementPhotoQuickImport(peeked.file, {
          title: peeked.title,
          note: peeked.note,
          measurementId: peeked.measurementId,
        });
        await clearPendingJobMeasurementFile();
        console.log("[MeasurementPhoto] measurementPending: cleared IndexedDB pending slot");
        router.replace(measurementEditorStripPath, { scroll: false });
      } catch (e) {
        measurementPendingNavHandledKeyRef.current = null;
        console.error("[JobDetailPage] measurementPending", e);
        toast({
          variant: "destructive",
          title: "Foto zaměření",
          description: e instanceof Error ? e.message : "Nepodařilo se otevřít editor.",
        });
        router.replace(measurementEditorStripPath, { scroll: false });
        try {
          await clearPendingJobMeasurementFile();
        } catch {
          /* ignore */
        }
      }
    })();
  }, [
    searchParams,
    jobIdParam,
    companyId,
    user?.uid,
    router,
    toast,
    handleMeasurementPhotoQuickImport,
    isStandaloneMeasurementEditorRoute,
    measurementEditorStripPath,
  ]);

  /** Zařazení pouze s platnou vazbou na aktuální zakázku (jobId + assignedType). */
  const handleAssignMeasurementPhotoToCurrentJob = async (
    row: Record<string, unknown> & { id: string }
  ) => {
    if (!companyId || !firestore || !user?.uid || !jobFirestoreId) return;
    const rowJob = typeof row.jobId === "string" ? row.jobId.trim() : "";
    if (rowJob && rowJob !== jobFirestoreId) {
      toast({
        variant: "destructive",
        title: "Nelze přiřadit",
        description: "Tato fotka patří k jiné zakázce.",
      });
      return;
    }
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "measurement_photos", row.id),
        {
          jobId: jobFirestoreId,
          unassigned: false,
          classificationStatus: "assigned",
          assignedType: "job",
          assignedAt: serverTimestamp(),
          assignedBy: user.uid,
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Přiřazeno k zakázce",
        description: "Foto je zařazené u této zakázky.",
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const handleTransferMeasurementToJobPhotos = async (
    row: Record<string, unknown> & { id: string }
  ) => {
    if (!companyId || !jobId || !user?.uid || !firestore) return;
    const pathRaw =
      (typeof row.annotatedStoragePath === "string" && row.annotatedStoragePath.trim()
        ? row.annotatedStoragePath
        : null) ||
      (typeof row.storagePath === "string" ? row.storagePath : "");
    if (!pathRaw) {
      toast({
        variant: "destructive",
        title: "Chybí soubor",
        description: "U této fotky není známá cesta ve Storage.",
      });
      return;
    }
    try {
      const blob = await getBlob(ref(getFirebaseStorage(), pathRaw));
      const file = new File([blob], `zamereni-${row.id}.png`, {
        type: blob.type && blob.type.startsWith("image/") ? blob.type : "image/png",
      });
      if (!isAllowedJobImageFile(file)) {
        toast({
          variant: "destructive",
          title: "Nepodporovaný formát",
          description: "Použijte obrázek.",
        });
        return;
      }
      const ok = await handlePhotoUpload(file, { skipUploadingFlag: true });
      if (!ok) return;
      await updateDoc(
        doc(firestore, "companies", companyId, "measurement_photos", row.id),
        {
          jobId: String(jobId),
          unassigned: false,
          classificationStatus: "assigned",
          assignedType: "job",
          status: "transferred",
          assignedAt: serverTimestamp(),
          assignedBy: user.uid,
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Přesunuto do fotodokumentace",
        description: "Kopie fotky je v běžné fotodokumentaci zakázky.",
      });
    } catch (e) {
      console.error("[JobDetailPage] transfer measurement to job photos", e);
      toast({
        variant: "destructive",
        title: "Přesun se nezdařil",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const handleSaveAnnotated = async () => {
    if (annotationReadOnly) {
      toast({
        variant: "destructive",
        title: "Režim jen pro čtení",
        description: "Nemáte oprávnění upravovat anotace u tohoto souboru.",
      });
      return;
    }
    const isPdfSave = editorMediaKind === "pdf";
    if (!baseImageLoaded) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Podklad není načten, export nelze provést.",
      });
      return;
    }
    if (!isPdfSave && !imageForCanvas) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Základní fotografie není načtena, export nelze provést.",
      });
      return;
    }
    if (isPdfSave && (!pdfDocRef.current || pdfNumPages < 1)) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "PDF není připraveno k uložení.",
      });
      return;
    }

    const isMeasurementSave =
      photoToEdit?.annotationTarget?.kind === "measurementPhotos";
    if (
      !companyId ||
      !photoToEdit ||
      !firestore ||
      (!isMeasurementSave && !jobFirestoreId)
    ) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Chybí data pro uložení anotace.",
      });
      return;
    }

    const pendingFileForSave =
      photoToEdit.pendingLocalFile ?? measurementCaptureFileRef.current ?? null;
    if (
      photoToEdit.id.startsWith("pending-") &&
      isMeasurementSave &&
      !pendingFileForSave
    ) {
      toast({
        variant: "destructive",
        title: "Chybí soubor fotky",
        description: "Vyberte nebo znovu vyfoťte snímek a otevřete editor.",
      });
      return;
    }

    const exportCanvas = document.createElement("canvas");

    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: "Nepodařilo se inicializovat plátno pro export.",
      });
      return;
    }

    setIsSavingAnnotation(true);

    try {
      if (isPdfSave) {
        pdfAnnotationsByPageRef.current.set(pdfPage, annotations);
        const pdf = pdfDocRef.current!;
        const page = await pdf.getPage(pdfPage);
        const vp = page.getViewport({ scale: 1 });
        exportCanvas.width = Math.max(1, Math.round(vp.width));
        exportCanvas.height = Math.max(1, Math.round(vp.height));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      } else {
        exportCanvas.width = imageForCanvas!.naturalWidth || imageForCanvas!.width;
        exportCanvas.height = imageForCanvas!.naturalHeight || imageForCanvas!.height;
        ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(imageForCanvas!, 0, 0);
      }
    } catch (e) {
      setIsSavingAnnotation(false);
      toast({
        variant: "destructive",
        title: "Chyba při exportu",
        description: e instanceof Error ? e.message : "Export podkladu selhal.",
      });
      return;
    }

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
        const lw =
          typeof (a as any).strokeWidth === "number"
            ? Number((a as any).strokeWidth)
            : lineWidth;
        targetCtx.lineWidth = lw;
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";
        targetCtx.strokeStyle = stroke;
        targetCtx.fillStyle = stroke;

        if (a.type === "dimension") {
          targetCtx.beginPath();
          targetCtx.moveTo(a.startX, a.startY);
          targetCtx.lineTo(a.endX, a.endY);
          targetCtx.stroke();

          const angle = Math.atan2(a.endY - a.startY, a.endX - a.startX);
          drawArrowHead(a.startX, a.startY, angle + Math.PI, stroke);
          drawArrowHead(a.endX, a.endY, angle, stroke);

          const label = (a.label || "").trim();
          if (label) {
            const dim = a as DimensionAnnotation;
            const lfRaw = dim.labelFontSize;
            const labelFs =
              typeof lfRaw === "number" && Number.isFinite(lfRaw)
                ? Math.max(1, Math.min(100, lfRaw))
                : 16;
            const labelPx = Math.max(1, labelFs);
            const midX = (a.startX + a.endX) / 2;
            const midY = (a.startY + a.endY) / 2;
            const offset = Math.max(10, labelPx * 0.85);
            const tx = midX - offset * Math.sin(angle);
            const ty = midY + offset * Math.cos(angle);
            targetCtx.font = `700 ${labelPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
            targetCtx.textAlign = "center";
            targetCtx.textBaseline = "middle";
            targetCtx.lineWidth = Math.max(2, labelPx * 0.12);
            targetCtx.strokeStyle = "rgba(0,0,0,0.55)";
            targetCtx.strokeText(label, tx, ty);
            targetCtx.fillStyle = stroke;
            targetCtx.fillText(label, tx, ty);
          }
        }

        if (a.type === "meter") {
          const m = a as MeterAnnotation;
          targetCtx.save();
          targetCtx.setLineDash([5, 4]);
          targetCtx.lineWidth = lw;
          targetCtx.strokeStyle = stroke;
          targetCtx.beginPath();
          targetCtx.moveTo(m.startX, m.startY);
          targetCtx.lineTo(m.endX, m.endY);
          targetCtx.stroke();
          targetCtx.setLineDash([]);
          const lab = (m.label || "").trim();
          if (lab) {
            const midX = (m.startX + m.endX) / 2;
            const midY = (m.startY + m.endY) / 2;
            const ang = Math.atan2(m.endY - m.startY, m.endX - m.startX);
            const perp = ang - Math.PI / 2;
            const off = Math.max(12, fontSize * 0.55);
            const tx = midX + Math.cos(perp) * off;
            const ty = midY + Math.sin(perp) * off;
            const fontPx = Math.max(10, Math.round(fontSize * 0.72));
            targetCtx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
            targetCtx.textAlign = "center";
            targetCtx.textBaseline = "middle";
            targetCtx.lineWidth = Math.max(2, fontPx * 0.12);
            targetCtx.strokeStyle = "rgba(0,0,0,0.55)";
            targetCtx.strokeText(lab, tx, ty);
            targetCtx.fillStyle = "#f1f5f9";
            targetCtx.fillText(lab, tx, ty);
          }
          targetCtx.restore();
        }

        if (a.type === "arrowNote") {
          const ar = a as ArrowNoteAnnotation;
          const sx = ar.startX;
          const sy = ar.startY;
          const ex = ar.endX;
          const ey = ar.endY;
          const angle = Math.atan2(ey - sy, ex - sx);
          targetCtx.lineWidth = lw;
          targetCtx.strokeStyle = stroke;
          targetCtx.beginPath();
          targetCtx.moveTo(sx, sy);
          targetCtx.lineTo(ex, ey);
          targetCtx.stroke();
          drawArrowHead(ex, ey, angle, stroke);
          const nfsRaw = ar.numFontSize;
          const nfs =
            typeof nfsRaw === "number" && Number.isFinite(nfsRaw)
              ? Math.max(8, Math.min(28, nfsRaw))
              : Math.min(18, Math.max(10, Math.round(fontSize * 0.52)));
          const r = Math.max(nfs * 0.72, 9);
          targetCtx.beginPath();
          targetCtx.arc(sx, sy, r, 0, Math.PI * 2);
          targetCtx.fillStyle = "rgba(255,255,255,0.94)";
          targetCtx.fill();
          targetCtx.strokeStyle = stroke;
          targetCtx.lineWidth = Math.max(1.25, 1.5);
          targetCtx.stroke();
          targetCtx.font = `700 ${nfs}px ui-sans-serif, system-ui, sans-serif`;
          targetCtx.textAlign = "center";
          targetCtx.textBaseline = "middle";
          targetCtx.fillStyle = stroke;
          targetCtx.fillText(String(ar.arrowNumber ?? ""), sx, sy);
        }

        if (a.type === "note") {
          drawNoteAnnotationOnCanvas(targetCtx, canvas, a, false, {
            fontSize,
            lineWidth: lw,
            endpointRadius,
            arrowLen,
            colorToHex,
          });
        }

        if (a.type === "shapeLabel") {
          drawShapeLabelOnCanvas(
            targetCtx,
            a as ShapeLabelAnnotation,
            false,
            1,
            colorToHex,
            fontSize,
            lw
          );
        }
      });
    };

    drawAll(ctx, exportCanvas);

    const legendShapes = annotations.filter(
      (a): a is ShapeLabelAnnotation => a.type === "shapeLabel"
    );
    const leg = [
      ...buildLegendFromShapeLabels(legendShapes),
      ...buildArrowNoteLegendEntries(annotations),
    ];
    let uploadCanvas: HTMLCanvasElement = exportCanvas;
    if (leg.length > 0 && ctx) {
      const legH = estimateLegendStripHeight(ctx, leg, exportCanvas.width);
      if (legH > 0) {
        const merged = document.createElement("canvas");
        merged.width = exportCanvas.width;
        merged.height = exportCanvas.height + legH;
        const mctx = merged.getContext("2d");
        if (mctx) {
          mctx.fillStyle = "#ffffff";
          mctx.fillRect(0, 0, merged.width, merged.height);
          mctx.drawImage(exportCanvas, 0, 0);
          drawLegendStrip(mctx, leg, merged.width, exportCanvas.height, legH);
          uploadCanvas = merged;
        }
      }
    }

    const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas export failed."))),
          "image/png"
        );
      });

    try {
      const blob = await canvasToBlob(uploadCanvas);

      const annotationData = serializeJobPhotoAnnotations(
        annotations,
        exportCanvas.width,
        exportCanvas.height,
        {
          pageIndex: isPdfSave ? pdfPage - 1 : 0,
          imageCalibration: imageCalibrationRef.current,
        }
      );
      if (
        !annotationData ||
        typeof annotationData !== "object" ||
        !Array.isArray((annotationData as { items?: unknown }).items)
      ) {
        throw new Error("Interní chyba: anotace se nepodařilo serializovat.");
      }

      const target = photoToEdit.annotationTarget;
      let annotatedPath: string;
      let annotatedUrl: string;

      if (target.kind === "photos") {
        const jobKey = jobFirestoreId as string;
        const up = await uploadJobPhotoBlobViaFirebaseSdk(
          blob,
          companyId,
          jobKey,
          `${photoToEdit.id}-annotated.png`
        );
        annotatedPath = up.storagePath;
        annotatedUrl = up.downloadURL;
        const photoRef = doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobKey,
          "photos",
          photoToEdit.id
        );
        const rawPatch = {
          originalImageUrl:
            photoToEdit.originalImageUrl || photoToEdit.imageUrl || null,
          imageUrl: annotatedUrl,
          annotatedImageUrl: annotatedUrl,
          annotatedStoragePath: annotatedPath,
          annotationData,
          updatedAt: serverTimestamp(),
        };
        const cleanPayload = removeUndefinedDeep(rawPatch);
        if (
          typeof (cleanPayload as { annotatedImageUrl?: unknown }).annotatedImageUrl !==
            "string" ||
          !(cleanPayload as { annotatedImageUrl: string }).annotatedImageUrl.trim()
        ) {
          throw new Error("Chybí platná URL uloženého obrázku (annotatedImageUrl).");
        }
        console.log("ANNOTATION SAVE PAYLOAD", cleanPayload);
        await withTimeout(
          setDoc(photoRef, cleanPayload, { merge: true }),
          120_000,
          "Uložení fotky do Firestore"
        );
      } else if (target.kind === "folderImages") {
        const jobKey = jobFirestoreId as string;
        const up = await uploadJobFolderImageBlobViaFirebaseSdk(
          blob,
          companyId,
          jobKey,
          target.folderId,
          `${photoToEdit.id}-annotated.png`
        );
        annotatedPath = up.storagePath;
        annotatedUrl = up.downloadURL;
        const imageRef = doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobKey,
          "folders",
          target.folderId,
          "images",
          photoToEdit.id
        );
        const rawPatch = {
          originalImageUrl:
            photoToEdit.originalImageUrl || photoToEdit.imageUrl || null,
          imageUrl: annotatedUrl,
          url: annotatedUrl,
          annotatedImageUrl: annotatedUrl,
          annotatedStoragePath: annotatedPath,
          annotationData,
          updatedAt: serverTimestamp(),
        };
        const cleanPayload = removeUndefinedDeep(rawPatch);
        if (
          typeof (cleanPayload as { annotatedImageUrl?: unknown }).annotatedImageUrl !==
            "string" ||
          !(cleanPayload as { annotatedImageUrl: string }).annotatedImageUrl.trim()
        ) {
          throw new Error("Chybí platná URL uloženého obrázku (annotatedImageUrl).");
        }
        console.log("ANNOTATION SAVE PAYLOAD", cleanPayload);
        await withTimeout(
          setDoc(imageRef, cleanPayload, { merge: true }),
          120_000,
          "Uložení souboru ve složce do Firestore"
        );
      } else if (target.kind === "measurementPhotos") {
        const isPendingDraft =
          Boolean(pendingFileForSave) && photoToEdit.id.startsWith("pending-");

        if (isPendingDraft && pendingFileForSave && user?.uid) {
          const photoRef = doc(
            collection(firestore, "companies", companyId, "measurement_photos")
          );
          const photoDocId = photoRef.id;

          const upOrig = await uploadMeasurementPhotoFileViaFirebaseSdk(
            pendingFileForSave,
            companyId,
            photoDocId
          );
          const upAnn = await uploadMeasurementPhotoBlobViaFirebaseSdk(
            blob,
            companyId,
            photoDocId,
            `${photoDocId}-annotated.png`
          );
          annotatedPath = upAnn.storagePath;
          annotatedUrl = upAnn.downloadURL;

          const nowTs = Timestamp.now();
          const linkedToJob = Boolean(jobFirestoreId);
          const firestorePayload: Record<string, unknown> = {
            companyId,
            sourceType: MEASUREMENT_PHOTO_SOURCE_TYPE,
            originalImageUrl: upOrig.downloadURL,
            storagePath: upOrig.storagePath,
            annotatedImageUrl: upAnn.downloadURL,
            annotatedStoragePath: upAnn.storagePath,
            annotationData,
            status: linkedToJob ? "linked" : "draft",
            kind: "measurement",
            unassigned: true,
            classificationStatus: "unassigned",
            createdAt: nowTs,
            updatedAt: nowTs,
            createdBy: user.uid,
          };
          if (linkedToJob && jobFirestoreId) {
            firestorePayload.jobId = jobFirestoreId;
            firestorePayload.source = "job_measurement_photo";
          } else {
            firestorePayload.source = "measurement_pending_assignment";
          }
          const pTitle = photoToEdit.pendingMeasurementTitle?.trim();
          if (pTitle) firestorePayload.title = pTitle;
          const pNote = photoToEdit.pendingMeasurementNote?.trim();
          if (pNote) firestorePayload.note = pNote;
          const pMid = photoToEdit.pendingMeasurementRecordId?.trim();
          if (pMid) firestorePayload.measurementId = pMid;

          await withTimeout(
            setDoc(
              photoRef,
              removeUndefinedDeep(firestorePayload) as Record<string, unknown>
            ),
            120_000,
            "Uložení nového měření do Firestore"
          );

          console.log("[MeasurementPhoto] save: Firestore doc written", {
            photoDocId,
            jobId: jobFirestoreId ?? null,
            standalone: !linkedToJob,
          });

          measurementCaptureFileRef.current = null;

          if (photoToEdit.pendingObjectUrl) {
            try {
              URL.revokeObjectURL(photoToEdit.pendingObjectUrl);
            } catch {
              /* ignore */
            }
          }
        } else {
          if (photoToEdit.id.startsWith("pending-")) {
            throw new Error(
              "Uložení nového snímku se nezdařilo — zkuste fotku vybrat znovu."
            );
          }
          const up = await uploadMeasurementPhotoBlobViaFirebaseSdk(
            blob,
            companyId,
            photoToEdit.id,
            `${photoToEdit.id}-annotated.png`
          );
          annotatedPath = up.storagePath;
          annotatedUrl = up.downloadURL;
          const measRef = doc(
            firestore,
            "companies",
            companyId,
            "measurement_photos",
            photoToEdit.id
          );
          const rawMeasPatch = {
            originalImageUrl:
              photoToEdit.originalImageUrl || photoToEdit.imageUrl || null,
            imageUrl: annotatedUrl,
            annotatedImageUrl: annotatedUrl,
            annotatedStoragePath: annotatedPath,
            annotationData,
            updatedAt: serverTimestamp(),
          };
          const cleanMeas = removeUndefinedDeep(rawMeasPatch);
          if (
            typeof (cleanMeas as { annotatedImageUrl?: unknown }).annotatedImageUrl !==
              "string" ||
            !(cleanMeas as { annotatedImageUrl: string }).annotatedImageUrl.trim()
          ) {
            throw new Error("Chybí platná URL uloženého obrázku (annotatedImageUrl).");
          }
          console.log("ANNOTATION SAVE PAYLOAD", cleanMeas);
          await withTimeout(
            setDoc(measRef, cleanMeas, { merge: true }),
            120_000,
            "Uložení měření do Firestore"
          );
        }
      } else {
        throw new Error("Neznámý cíl anotace.");
      }

      if (target.kind === "photos" || target.kind === "folderImages") {
        try {
          const mirrorPatch = removeUndefinedDeep(
            buildJobMediaMirrorAnnotatedUrlPatch({
              fileUrl: annotatedUrl,
              jobDisplayName: job?.name?.trim() ?? null,
            })
          ) as Record<string, unknown>;
          if (target.kind === "photos") {
            await withTimeout(
              setDoc(
                companyDocumentRefForJobLegacyPhoto(
                  firestore,
                  companyId,
                  photoToEdit.id
                ),
                mirrorPatch,
                { merge: true }
              ),
              120_000,
              "Aktualizace globálního dokladu (fotka)"
            );
          } else {
            await withTimeout(
              setDoc(
                companyDocumentRefForJobFolderImage(
                  firestore,
                  companyId,
                  target.folderId,
                  photoToEdit.id
                ),
                mirrorPatch,
                { merge: true }
              ),
              120_000,
              "Aktualizace globálního dokladu (složka)"
            );
          }
        } catch (mirrorErr) {
          console.error("[JobDetailPage] dokument mirror po anotaci", mirrorErr);
        }
      }

      toast(
        target.kind === "measurementPhotos"
          ? photoToEdit?.id?.startsWith("pending-")
            ? isStandaloneMeasurementEditorRoute
              ? {
                  title: "Foto zaměření uloženo",
                  description:
                    "Snímek včetně kót a poznámek je mezi nezařazenými fotkami na hlavní stránce.",
                }
              : {
                  title: "Foto zaměření uloženo",
                  description: "Snímek včetně kót a poznámek je uložen k zakázce.",
                }
            : {
                title: "Anotace byly aktualizovány",
                description: "Kóty a poznámky u foto zaměření byly uloženy.",
              }
          : {
              title: "Fotografie upravena",
              description: "Kóty a poznámky byly uloženy.",
            }
      );

      if (target.kind === "measurementPhotos") {
        const raw = measurementEditorReturnToRef.current;
        measurementEditorReturnToRef.current = null;
        const fromParam = sanitizeMeasurementEditorReturnTo(raw);
        const dest =
          fromParam ??
          (isStandaloneMeasurementEditorRoute ? "/portal/dashboard" : null);
        if (dest) {
          router.replace(dest);
        }
      }

      setPhotoToEdit(null);
      measurementCaptureFileRef.current = null;
      resetAnnotationState();
    } catch (err: unknown) {
      console.error("ANNOTATION SAVE ERROR", err);
      console.error("[JobDetailPage] saving annotated photo failed", err);
      toast({
        variant: "destructive",
        title: jobPhotoUploadErrorTitle(err),
        description:
          err instanceof Error && err.message
            ? err.message
            : describeStorageUploadFailure(err),
      });
    } finally {
      setIsSavingAnnotation(false);
    }
  };

  const handleConvertPdfPageToImage = useCallback(async () => {
    if (editorMediaKind !== "pdf" || !baseImageLoaded) {
      toast({
        variant: "destructive",
        title: "PDF není připraveno",
        description: "Počkejte na načtení stránky a zkuste to znovu.",
      });
      return;
    }
    const pe = photoToEdit;
    const t = pe?.annotationTarget;
    if (
      !companyId ||
      !user?.uid ||
      !firestore ||
      !pe ||
      !jobFirestoreId ||
      (t?.kind !== "folderImages" && t?.kind !== "photos")
    ) {
      toast({
        variant: "destructive",
        title: "Převod není dostupný",
        description:
          "Převod aktuální stránky PDF na PNG je možný jen u podkladů zakázky (složka nebo fotodokumentace).",
      });
      return;
    }
    const srcRaw = (annotationSource || "").trim();
    if (!srcRaw) {
      toast({ variant: "destructive", title: "Chybí zdroj PDF." });
      return;
    }
    setPdfPageRasterBusy(true);
    try {
      const url = await resolveAnnotationImageUrl(srcRaw);
      const blobs = await renderPdfPagesToPngBlobs(url, [pdfPage], 2);
      const blob = blobs[0];
      if (!blob) throw new Error("Nepodařilo se vygenerovat obrázek.");

      const jobKey = jobFirestoreId as string;
      const baseStem = String(pe.fileName || pe.name || "pdf")
        .replace(/\.pdf$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      const stamp = Date.now();
      const displayName = `${baseStem || "pdf"} — str. ${pdfPage}.png`;

      if (t.kind === "folderImages") {
        const folderId = t.folderId;
        const refDoc = doc(
          collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobKey,
            "folders",
            folderId,
            "images"
          )
        );
        const up = await uploadJobFolderImageBlobViaFirebaseSdk(
          blob,
          companyId,
          jobKey,
          folderId,
          `${refDoc.id}-${stamp}.png`
        );
        await withTimeout(
          setDoc(refDoc, {
            id: refDoc.id,
            companyId,
            jobId: jobKey,
            folderId,
            imageUrl: up.downloadURL,
            url: up.downloadURL,
            originalImageUrl: up.downloadURL,
            downloadURL: up.downloadURL,
            fileType: "image" as const,
            storagePath: up.storagePath,
            path: up.storagePath,
            fileName: displayName,
            name: displayName,
            sourcePdfId: pe.id,
            sourcePdfPage: pdfPage,
            createdAt: serverTimestamp(),
            createdBy: user.uid,
            updatedAt: serverTimestamp(),
          }),
          120_000,
          "Zápis nového obrázku ze stránky PDF"
        );
        await withTimeout(
          setDoc(
            companyDocumentRefForJobFolderImage(
              firestore,
              companyId,
              folderId,
              refDoc.id
            ),
            removeUndefinedDeep(
              buildNewJobFolderImageMirrorDocument({
                companyId,
                jobId: jobKey,
                jobDisplayName: job?.name?.trim() ?? null,
                folderId,
                imageId: refDoc.id,
                userId: user.uid,
                fileName: displayName,
                fileType: "image",
                mimeType: "image/png",
                fileUrl: up.downloadURL,
                storagePath: up.storagePath,
                note: null,
              })
            ) as Record<string, unknown>
          ),
          120_000,
          "Globální doklad k obrázku ze stránky PDF"
        );
        openPhotoAnnotationEditor({
          id: refDoc.id,
          imageUrl: up.downloadURL,
          url: up.downloadURL,
          downloadURL: up.downloadURL,
          originalImageUrl: up.downloadURL,
          storagePath: up.storagePath,
          path: up.storagePath,
          fileName: displayName,
          name: displayName,
          fileType: "image",
          annotationTarget: { kind: "folderImages", folderId },
        });
      } else {
        const refDoc = doc(
          collection(firestore, "companies", companyId, "jobs", jobKey, "photos")
        );
        const up = await uploadJobPhotoBlobViaFirebaseSdk(
          blob,
          companyId,
          jobKey,
          `${refDoc.id}-${stamp}.png`
        );
        await withTimeout(
          setDoc(refDoc, {
            id: refDoc.id,
            imageUrl: up.downloadURL,
            url: up.downloadURL,
            originalImageUrl: up.downloadURL,
            downloadURL: up.downloadURL,
            fileType: "image" as const,
            storagePath: up.storagePath,
            path: up.storagePath,
            fileName: displayName,
            name: displayName,
            sourcePdfId: pe.id,
            sourcePdfPage: pdfPage,
            createdAt: serverTimestamp(),
            uploadedBy: user.uid,
            updatedAt: serverTimestamp(),
          }),
          120_000,
          "Zápis nového obrázku ze stránky PDF (fotodokumentace)"
        );
        await withTimeout(
          setDoc(
            companyDocumentRefForJobLegacyPhoto(firestore, companyId, refDoc.id),
            removeUndefinedDeep(
              buildNewJobLegacyPhotoMirrorDocument({
                companyId,
                jobId: jobKey,
                jobDisplayName: job?.name?.trim() ?? null,
                photoId: refDoc.id,
                userId: user.uid,
                fileName: displayName,
                fileType: "image",
                mimeType: "image/png",
                fileUrl: up.downloadURL,
                storagePath: up.storagePath,
                note: null,
              })
            ) as Record<string, unknown>
          ),
          120_000,
          "Globální doklad k obrázku ze stránky PDF (fotky)"
        );
        openPhotoAnnotationEditor({
          id: refDoc.id,
          imageUrl: up.downloadURL,
          url: up.downloadURL,
          downloadURL: up.downloadURL,
          originalImageUrl: up.downloadURL,
          storagePath: up.storagePath,
          path: up.storagePath,
          fileName: displayName,
          name: displayName,
          fileType: "image",
          annotationTarget: { kind: "photos" },
        });
      }

      toast({
        title: "PDF převedeno na obrázek",
        description:
          "Právě zobrazená stránka je uložena jako PNG ve stejné zakázce. Otevřel se editor nového obrázku.",
      });
    } catch (e) {
      console.error("[JobDetailPage] PDF → PNG", e);
      toast({
        variant: "destructive",
        title: "Převod se nezdařil",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPdfPageRasterBusy(false);
    }
  }, [
    editorMediaKind,
    baseImageLoaded,
    photoToEdit,
    companyId,
    user?.uid,
    firestore,
    jobFirestoreId,
    annotationSource,
    pdfPage,
    resolveAnnotationImageUrl,
    toast,
    job?.name,
    openPhotoAnnotationEditor,
  ]);

  const handleDeleteMeasurementPhoto = async (
    row: Record<string, unknown> & { id: string; createdBy?: string }
  ) => {
    if (!companyId || !firestore || !user) return;
    const canDel = canManageFolders || row.createdBy === user.uid;
    if (!canDel) {
      toast({
        variant: "destructive",
        title: "Nelze smazat",
        description: "Chybí oprávnění ke smazání tohoto záznamu.",
      });
      return;
    }
    if (!window.confirm("Smazat foto zaměření včetně souborů ve Storage?")) return;
    try {
      const sp = typeof row.storagePath === "string" ? row.storagePath : "";
      const asp =
        typeof row.annotatedStoragePath === "string"
          ? row.annotatedStoragePath
          : "";
      if (sp) {
        try {
          await deleteObject(ref(getFirebaseStorage(), sp));
        } catch {
          /* ignore */
        }
      }
      if (asp) {
        try {
          await deleteObject(ref(getFirebaseStorage(), asp));
        } catch {
          /* ignore */
        }
      }
      await deleteDoc(
        doc(firestore, "companies", companyId, "measurement_photos", row.id)
      );
      setMeasurementLightboxDocId((prev) => (prev === row.id ? null : prev));
      toast({ title: "Foto zaměření bylo odstraněno" });
    } catch (e) {
      console.error("[JobDetailPage] delete measurement photo", e);
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: "Zkuste to znovu.",
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
    if (dragMode === "shape-resize-br") return "nwse-resize";
    if (dragMode === "note-rect-draw") return "crosshair";
    if (dragMode === "calibration-draw") return "crosshair";
    if (dragMode === "note-resize-br") return "nwse-resize";
    if (dragMode === "view-pan") return "grabbing";
    if (dragMode !== "none") return "grabbing";
    if (activeTool === "pan") return "grab";
    if (activeTool === "dimension") return "crosshair";
    if (activeTool === "meter") return "crosshair";
    if (activeTool === "calibrate") return "crosshair";
    if (activeTool === "note") return "crosshair";
    if (activeTool === "arrow") return "crosshair";
    if (activeTool === "shapeLabel") return "crosshair";
    return "default";
  }, [activeTool, dragMode]);

  const annotationShapeLegendEntries = useMemo(() => {
    const shapes = annotations.filter(
      (a): a is ShapeLabelAnnotation => a.type === "shapeLabel"
    );
    return buildLegendFromShapeLabels(shapes);
  }, [annotations]);

  const annotationArrowLegendEntries = useMemo(
    () => buildArrowNoteLegendEntries(annotations),
    [annotations]
  );

  const annotationLegendHasContent =
    annotationShapeLegendEntries.length > 0 ||
    annotationArrowLegendEntries.length > 0;

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
    const legacyCustomerName =
      typeof j.customerName === "string" ? j.customerName.trim() : "";

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
      customerInputMode: resolvedCustomerId
        ? "list"
        : legacyCustomerName
          ? "manual"
          : "list",
      manualCustomerCompanyName: resolvedCustomerId ? "" : legacyCustomerName,
      manualCustomerAddress: "",
      manualCustomerEmail: "",
      manualCustomerPhone: "",
      manualCustomerNotes: "",
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

      if (jobEditForm.customerInputMode === "manual") {
        const qName = jobEditForm.manualCustomerCompanyName.trim();
        const qAddr = jobEditForm.manualCustomerAddress.trim();
        if (!qName) {
          toast({
            variant: "destructive",
            title: "Zákazník",
            description:
              "Vyplňte název firmy nebo jméno zákazníka, nebo přepněte na výběr ze seznamu.",
          });
          return;
        }
        if (!qAddr) {
          toast({
            variant: "destructive",
            title: "Adresa",
            description:
              "Při zadání nového zákazníka ručně je adresa povinná.",
          });
          return;
        }
      }

      if (!user?.uid) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Nejste přihlášeni.",
        });
        return;
      }

      if (!customersColRef) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Nelze načíst adresář zákazníků.",
        });
        return;
      }

      setIsSavingJobEdit(true);
      try {
        let resolvedCustomerId: string | null = null;
        let customerName = "";
        let customerPhone = "";
        let customerEmail = "";

        if (jobEditForm.customerInputMode === "list") {
          resolvedCustomerId = jobEditForm.customerId.trim() || null;
          const selectedCustomer =
            resolvedCustomerId && customers
              ? (customers.find((c: any) => c.id === resolvedCustomerId) as any)
              : null;
          customerName = selectedCustomer
            ? selectedCustomer.companyName ||
              `${selectedCustomer.firstName || ""} ${selectedCustomer.lastName || ""}`.trim()
            : "";
          customerPhone = selectedCustomer?.phone || "";
          customerEmail = selectedCustomer?.email || "";
        } else {
          const qName = jobEditForm.manualCustomerCompanyName.trim();
          const qAddr = jobEditForm.manualCustomerAddress.trim();
          const emailTrim = jobEditForm.manualCustomerEmail.trim();
          const phoneTrim = jobEditForm.manualCustomerPhone.trim();

          const candidates: any[] = [];

          if (emailTrim) {
            const q = query(customersColRef, where("email", "==", emailTrim));
            const snap = await getDocs(q);
            snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
          }
          if (!candidates.length && phoneTrim) {
            const q = query(customersColRef, where("phone", "==", phoneTrim));
            const snap = await getDocs(q);
            snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
          }
          if (!candidates.length && qName) {
            const q = query(
              customersColRef,
              where("companyName", "==", qName)
            );
            const snap = await getDocs(q);
            snap.forEach((d) => candidates.push({ id: d.id, ...d.data() }));
          }

          let customerSnapshot: any;

          if (candidates.length) {
            customerSnapshot = candidates[0];
            resolvedCustomerId = customerSnapshot.id;
            toast({
              title: "Propojeno s existujícím zákazníkem",
              description: `Použit záznam z adresáře: „${
                customerSnapshot.companyName ||
                `${customerSnapshot.firstName || ""} ${customerSnapshot.lastName || ""}`.trim() ||
                qName
              }“.`,
            });
          } else {
            const customerPayload = {
              companyName: qName,
              email: emailTrim,
              phone: phoneTrim,
              address: qAddr,
              notes: jobEditForm.manualCustomerNotes.trim(),
              companyId,
              organizationId: companyId,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            const newRef = await addDoc(customersColRef, customerPayload);
            resolvedCustomerId = newRef.id;
            customerSnapshot = { id: resolvedCustomerId, ...customerPayload };
            toast({
              title: "Zákazník vytvořen",
              description: `„${qName}“ je uložen v adresáři zákazníků.`,
            });
          }

          customerName =
            customerSnapshot.companyName ||
            `${customerSnapshot.firstName || ""} ${customerSnapshot.lastName || ""}`.trim() ||
            qName;
          customerPhone = String(customerSnapshot.phone || phoneTrim || "");
          customerEmail = String(customerSnapshot.email || emailTrim || "");
        }

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

          customerId: resolvedCustomerId,
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
            customerId: resolvedCustomerId,
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
      customersColRef,
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

  const measurementLightboxRow = useMemo(() => {
    if (!measurementLightboxDocId || !measurementPhotosRaw) return null;
    return measurementPhotosRaw.find(
      (x: { id?: string }) => x.id === measurementLightboxDocId
    ) as (Record<string, unknown> & { id: string }) | undefined;
  }, [measurementLightboxDocId, measurementPhotosRaw]);

  const measurementAnnotationEditorDialog = (
    <>
      <UnifiedAnnotationEditor
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) dismissAnnotationEditor();
        }}
        isTouchUI={isAnnotTouchUI}
        persistenceKey={annotationEditorPersistenceKey}
      >
            <div className="flex min-h-0 shrink-0 items-center justify-between gap-2 border-b border-white/15 bg-slate-900 px-2 py-1.5 pt-[max(0.25rem,env(safe-area-inset-top))] text-white lg:hidden">
                <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-white hover:bg-white/10" onClick={() => dismissAnnotationEditor()}>Zavřít</Button>
                <span className="min-w-0 truncate text-center text-xs font-semibold">Anotace</span>
                <Button type="button" size="sm" className="h-8 shrink-0 bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50" onClick={handleSaveAnnotated} disabled={annotationReadOnly || !baseImageLoaded || isSavingAnnotation || pdfPageRasterBusy}>{isSavingAnnotation ? "…" : "Uložit"}</Button>
            </div>
              <DialogHeader className="hidden shrink-0 space-y-1 pb-2 pr-8 text-left lg:block">
                <DialogTitle className="text-base sm:text-lg">
                  Anotace fotografie
                </DialogTitle>
              </DialogHeader>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3 max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-hidden max-lg:bg-slate-950 max-lg:px-1 max-lg:pb-[max(0.5rem,calc(env(safe-area-inset-bottom)+5.25rem))] lg:min-h-0 lg:overflow-hidden lg:p-3">
            <div className="shrink-0 space-y-1.5 sm:space-y-2">
              <p className="text-xs leading-snug text-muted-foreground max-lg:text-slate-300 sm:text-sm sm:leading-normal lg:text-muted-foreground">
                Kóty: tažením čáry, poté zadejte hodnotu. Poznámka: obdélník a text.
                Značka / model: klepněte na plán, zadejte název a rozměry v mm; číslo
                značky na obrázku a legenda dole vlevo. Stejný model z knihovny se v
                legendě neopakuje. Výběr: přesun a úpravy. Kolečko myši nebo +/− přibližuje podklad
                v souřadnicích dokumentu. Dotyk i myš.
              </p>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setAnnotationModelsSettingsOpen(true);
                  }}
                  title="Nastavení modelů pro legendu"
                  disabled={annotationReadOnly}
                >
                  Modely
                </Button>
                <Button
                  type="button"
                  variant={activeTool === "dimension" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("dimension")}
                  disabled={annotationReadOnly}
                >
                  Kóty
                </Button>
                {!annotationReadOnly &&
                (activeTool === "dimension" ||
                  annotations.some(
                    (x) =>
                      x.id === selectedAnnotationId && x.type === "dimension"
                  )) ? (
                  <label className="flex min-h-[36px] items-center gap-1.5 rounded-md border border-white/20 bg-slate-900/80 px-2 py-1 text-xs text-slate-200 max-lg:border-slate-700 lg:border-border lg:bg-background lg:text-foreground">
                    <span className="shrink-0 whitespace-nowrap">Font kóty</span>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      className="h-8 w-[4.25rem] px-1.5 text-center text-xs"
                      value={dimensionLabelFontSize}
                      onChange={(ev) =>
                        updateDimensionLabelFontSize(
                          parseInt(ev.target.value, 10)
                        )
                      }
                      aria-label="Velikost písma kóty v pixelech"
                    />
                    <span className="shrink-0 text-muted-foreground max-lg:text-slate-400">
                      px
                    </span>
                  </label>
                ) : null}
                <Button
                  type="button"
                  variant={activeTool === "meter" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("meter")}
                  disabled={annotationReadOnly}
                  title="Měření vzdálenosti v mm (vyžaduje měřítko)"
                >
                  Metr
                </Button>
                <Button
                  type="button"
                  variant={activeTool === "calibrate" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("calibrate")}
                  disabled={annotationReadOnly}
                  title="Nastavit měřítko: tažením usečky a zadáním skutečné délky v mm"
                >
                  Měřítko
                </Button>
                {imageCalibration ? (
                  <span
                    className="text-xs text-emerald-600 max-lg:text-emerald-400"
                    title={`${imageCalibration.pxPerMm.toFixed(4)} px/mm`}
                  >
                    měřítko OK
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant={activeTool === "note" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("note")}
                  disabled={annotationReadOnly}
                >
                  Poznámka
                </Button>
                <Button
                  type="button"
                  variant={activeTool === "arrow" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => setActiveTool("arrow")}
                  disabled={annotationReadOnly}
                  title="Šipka s číslem a popisem v legendě"
                >
                  Šipka
                </Button>
                <Button
                  type="button"
                  variant={activeTool === "shapeLabel" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px] gap-1 pr-2"
                  title="Značka / modely z knihovny"
                  onClick={() => {
                    // Always activate the tool immediately (fix: button must react).
                    setShapeLabelPlacementModel(null);
                    shapeLabelPlacementModelRef.current = null;
                    setActiveTool("shapeLabel");
                    // If models exist, open picker right away. Otherwise open settings to create one.
                    if (annotationModelsSorted.length > 0) {
                      setShapeLabelLibraryPickerOpen(true);
                    } else {
                      setAnnotationModelsSettingsOpen(true);
                    }
                  }}
                  disabled={annotationReadOnly}
                >
                  Značka
                  <ChevronDown className="h-4 w-4 opacity-80" aria-hidden />
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
                <Button
                  type="button"
                  variant={activeTool === "pan" ? "default" : "outline"}
                  size="sm"
                  className="min-h-[36px] gap-1"
                  onClick={() => setActiveTool("pan")}
                  title="Posun přiblíženého náhledu (nebo kolečko myši, prostřední tlačítko)"
                >
                  <Hand className="h-4 w-4 shrink-0" />
                  Posun
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2"
                  onClick={() => bumpAnnotZoom(1)}
                  disabled={
                    editorMediaKind === "pdf"
                      ? pdfScale >= PDF_EDITOR_SCALE_MAX
                      : annotationView.zoom >= ANNOTATION_VIEW_ZOOM_MAX
                  }
                  title="Přiblížit"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2"
                  onClick={() => bumpAnnotZoom(-1)}
                  disabled={
                    editorMediaKind === "pdf"
                      ? pdfScale <= PDF_EDITOR_SCALE_MIN
                      : annotationView.zoom <= ANNOTATION_VIEW_ZOOM_MIN
                  }
                  title="Oddálit"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                {editorMediaKind === "pdf" &&
                jobFirestoreId &&
                photoToEdit &&
                (photoToEdit.annotationTarget?.kind === "folderImages" ||
                  photoToEdit.annotationTarget?.kind === "photos") ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-[36px] shrink-0 text-xs sm:text-sm"
                    disabled={!baseImageLoaded || pdfPageRasterBusy || isSavingAnnotation}
                    onClick={() => void handleConvertPdfPageToImage()}
                    title="Uloží aktuální stránku PDF jako PNG do zakázky a otevře ji v editoru"
                  >
                    {pdfPageRasterBusy ? (
                      <>
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                        Převod…
                      </>
                    ) : (
                      "PDF → obrázek"
                    )}
                  </Button>
                ) : null}

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

                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 2 as const, label: "Slabá", title: "Tloušťka: slabá (2px)" },
                      { id: 4 as const, label: "Střední", title: "Tloušťka: střední (4px)" },
                      { id: 6 as const, label: "Silná", title: "Tloušťka: silná (6px)" },
                    ] as const
                  ).map((w) => (
                    <Button
                      key={w.id}
                      type="button"
                      variant={activeStrokeWidth === w.id ? "default" : "outline"}
                      size="sm"
                      className="min-h-[36px] px-2.5 text-xs sm:text-sm"
                      title={w.title}
                      onClick={() => updateSelectedStrokeWidth(w.id)}
                      disabled={annotationReadOnly}
                    >
                      {w.label}
                    </Button>
                  ))}
                </div>

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
              {shapeLabelPlacementModel ? (
                <p className="text-xs font-medium text-amber-600 max-lg:text-amber-300">
                  Klikněte do výkresu pro vložení modelu: {shapeLabelPlacementModel.name}
                </p>
              ) : null}
            </div>

            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
            <div
              ref={annotationWheelCaptureRef}
              className={cn(
                "relative z-0 flex min-h-0 min-w-0 flex-1 touch-none items-center justify-center overflow-auto bg-black",
                "max-lg:min-h-0 max-lg:flex-1",
                "lg:min-h-0 lg:flex-1",
                "max-lg:rounded-none max-lg:border-0 max-lg:p-0",
                "lg:rounded-md lg:border lg:bg-black/80 lg:p-0.5 lg:sm:p-1"
              )}
            >
              <div
                className="flex h-full min-h-0 max-h-full w-full max-w-full items-center justify-center overflow-auto"
                style={{ touchAction: "none" as const }}
              >
                <div
                  ref={annotationTransformRef}
                  style={{
                    transform:
                      editorMediaKind === "pdf"
                        ? `translate(${annotationView.panX}px, ${annotationView.panY}px)`
                        : `translate(${annotationView.panX}px, ${annotationView.panY}px) scale(${annotationView.zoom})`,
                    transformOrigin: "center center",
                  }}
                  className={cn(
                    "flex min-h-0 items-center justify-center",
                    "max-lg:max-h-[min(100dvh-14rem,86dvh)] max-lg:max-w-[min(100vw-0.75rem,96vw)]",
                    "lg:h-full lg:max-h-full lg:w-full lg:max-w-full"
                  )}
                >
                  <div className="relative z-[1] w-fit max-h-full max-w-full min-w-0">
                    <canvas
                      ref={setCanvasNode}
                      className={cn(
                        "pointer-events-none block h-auto w-auto object-contain",
                        "max-lg:max-h-[min(100dvh-14rem,86dvh)] max-lg:max-w-[min(100vw-0.75rem,96vw)]",
                        "lg:max-h-full lg:max-w-full",
                        baseImageLoaded ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div
                      className="absolute inset-0 z-[12] touch-none"
                      style={{ cursor: canvasCursor }}
                      onPointerDown={handleCanvasPointerDown}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerCancel={() => {
                        pointerMapRef.current.clear();
                        pinchSessionRef.current = null;
                        viewPanStartRef.current = null;
                        const dId = draftAnnotationIdRef.current;
                        const dm = dragModeRef.current;
                        if (dId && (dm === "arrow-draw" || dm === "dim-draw" || dm === "meter-draw")) {
                          setAnnotations((prev) => {
                            if (!prev.length) return prev;
                            const last = prev[prev.length - 1];
                            if (
                              (last?.type === "arrowNote" ||
                                last?.type === "dimension" ||
                                last?.type === "meter") &&
                              last.id === dId
                            ) {
                              return prev.slice(0, -1);
                            }
                            return prev;
                          });
                        }
                        setDragMode("none");
                        setDragLastPoint(null);
                        setNoteRectDraft(null);
                        setDraftAnnotationId(null);
                      }}
                    />
                  </div>
                </div>
              </div>

              {!baseImageLoaded && !imageError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-slate-300">
                  Načítání fotografie...
                </div>
              )}

              {imageError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center text-sm text-red-400">
                  <div className="space-y-2">
                    <p>{imageError}</p>
                    <p className="break-all text-xs text-slate-400">
                      URL: {annotationSource || "neznámé"}
                    </p>
                  </div>
                </div>
              )}
              {annotationLegendHasContent ? (
                <div className="pointer-events-auto absolute bottom-2 left-1/2 z-10 w-[min(calc(100vw-0.75rem),36rem)] max-w-[calc(100%-0.5rem)] -translate-x-1/2">
                  <div className="max-h-[min(36dvh,320px)] overflow-y-auto rounded-md border border-slate-600/80 bg-[#070d18] px-2.5 py-2.5 text-left shadow-2xl ring-1 ring-black/40 sm:px-3 sm:py-3">
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-200 sm:text-sm">
                      Legenda
                    </p>
                    {annotationShapeLegendEntries.length ? (
                      <ul className="space-y-1.5 sm:space-y-2">
                        {annotationShapeLegendEntries.map((e) => (
                          <li
                            key={`leg-s-${e.legendNumber}-${e.label}-${e.widthMm}`}
                            className="border-l-2 border-amber-400 pl-2 text-sm font-semibold leading-snug text-slate-50 sm:text-base"
                          >
                            {formatLegendEntryLine(e)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {annotationArrowLegendEntries.length ? (
                      <div
                        className={
                          annotationShapeLegendEntries.length ? "mt-3 border-t border-slate-600/80 pt-2" : ""
                        }
                      >
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:text-sm">
                          Poznámky / Šipky
                        </p>
                        <ul className="space-y-1.5 sm:space-y-2">
                          {annotationArrowLegendEntries.map((e) => (
                            <li
                              key={`leg-a-${e.legendNumber}-${e.label}`}
                              className="border-l-2 border-sky-400 pl-2 text-sm font-semibold leading-snug text-slate-50 sm:text-base"
                            >
                              {formatLegendEntryLine(e)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2 pb-0.5 sm:pt-2.5 max-lg:border-white/10 max-lg:bg-slate-900 max-lg:text-white max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:pt-2">
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] gap-1"
                  onClick={() => {
                    setPdfScale(1);
                    setAnnotationView({ zoom: 1, panX: 0, panY: 0 });
                  }}
                  disabled={
                    (editorMediaKind === "pdf"
                      ? pdfScale === 1
                      : annotationView.zoom === 1) &&
                    annotationView.panX === 0 &&
                    annotationView.panY === 0
                  }
                >
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  1:1
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2"
                  onClick={() => bumpAnnotZoom(1)}
                  disabled={
                    editorMediaKind === "pdf"
                      ? pdfScale >= PDF_EDITOR_SCALE_MAX
                      : annotationView.zoom >= ANNOTATION_VIEW_ZOOM_MAX
                  }
                  title="Přiblížit"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] px-2"
                  onClick={() => bumpAnnotZoom(-1)}
                  disabled={
                    editorMediaKind === "pdf"
                      ? pdfScale <= PDF_EDITOR_SCALE_MIN
                      : annotationView.zoom <= ANNOTATION_VIEW_ZOOM_MIN
                  }
                  title="Oddálit"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                {editorMediaKind === "pdf" && pdfNumPages > 1 ? (
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[36px] px-2"
                      onClick={() => goPdfPage(-1)}
                      disabled={pdfPage <= 1}
                      title="Předchozí stránka"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {pdfPage}/{pdfNumPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[36px] px-2"
                      onClick={() => goPdfPage(1)}
                      disabled={pdfPage >= pdfNumPages}
                      title="Další stránka"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
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
                  onClick={() => dismissAnnotationEditor()}
                >
                  Zrušit
                </Button>

                <Button
                  className="min-h-[36px]"
                  onClick={handleSaveAnnotated}
                  disabled={!baseImageLoaded || isSavingAnnotation || pdfPageRasterBusy}
                >
                  {isSavingAnnotation ? "Ukládám…" : "Uložit anotaci"}
                </Button>
              </div>
            </div>
          </div>
          {shapeLabelDialogOpen ? (
            <div
              className={cn(
                "pointer-events-auto absolute inset-0 z-[220] flex items-center justify-center p-3 sm:p-6",
                "max-lg:bg-black/80 lg:bg-black/60"
              )}
            >
              <div
                className={cn(
                  "max-h-[min(90dvh,560px)] w-full max-w-md overflow-y-auto rounded-lg border p-4 shadow-xl",
                  "max-lg:border-white/20 max-lg:bg-slate-900 max-lg:text-white",
                  "lg:border-border lg:bg-card lg:text-card-foreground"
                )}
                role="dialog"
                aria-modal="true"
              >
                <h3 className="mb-3 text-base font-semibold">
                  {shapeLabelEditingId ? "Upravit značku" : "Nová značka / model"}
                </h3>
                {shapeLabelPropsLockedByModel ? (
                  <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100 max-lg:text-amber-200">
                    Tato značka vychází z uloženého modelu — tvar a rozměry v mm měňte v nabídce Modely. Zde lze
                    upravit popisy a zobrazení textu.
                  </p>
                ) : null}
                <div className="space-y-3 text-sm">
                  <div className="flex flex-col gap-1">
                    <Label>Název</Label>
                    <Input
                      value={shapeLabelForm.label}
                      onChange={(e) =>
                        setShapeLabelForm((f) => ({ ...f, label: e.target.value }))
                      }
                      placeholder="např. Pračka"
                      className="max-lg:border-white/25 max-lg:bg-slate-950 max-lg:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label>Šířka (mm)</Label>
                      <Input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={shapeLabelForm.widthMm}
                        disabled={shapeLabelPropsLockedByModel}
                        onChange={(e) =>
                          setShapeLabelForm((f) => ({
                            ...f,
                            widthMm: Number(e.target.value) || 0,
                          }))
                        }
                        className="max-lg:border-white/25 max-lg:bg-slate-950 max-lg:text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label>Výška (mm)</Label>
                      <Input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={shapeLabelForm.heightMm}
                        disabled={shapeLabelPropsLockedByModel}
                        onChange={(e) =>
                          setShapeLabelForm((f) => ({
                            ...f,
                            heightMm: Number(e.target.value) || 0,
                          }))
                        }
                        className="max-lg:border-white/25 max-lg:bg-slate-950 max-lg:text-white"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Tvar na plánu</Label>
                    <select
                      disabled={shapeLabelPropsLockedByModel}
                      className={cn(
                        "h-9 w-full rounded-md border px-2 text-sm",
                        "max-lg:border-white/25 max-lg:bg-slate-950 max-lg:text-white",
                        "lg:border-input lg:bg-background"
                      )}
                      value={shapeLabelForm.shape}
                      onChange={(e) =>
                        setShapeLabelForm((f) => ({
                          ...f,
                          shape: e.target.value as ShapeLabelAnnotation["shape"],
                        }))
                      }
                    >
                      <option value="point">Bod / značka</option>
                      <option value="square">Čtverec</option>
                      <option value="rectangle">Obdélník</option>
                      <option value="circle">Kruh</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Poznámka (volitelně)</Label>
                    <Input
                      value={shapeLabelForm.note}
                      onChange={(e) =>
                        setShapeLabelForm((f) => ({ ...f, note: e.target.value }))
                      }
                      className="max-lg:border-white/25 max-lg:bg-slate-950 max-lg:text-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Popis do legendy (volitelně)</Label>
                    <Textarea
                      rows={2}
                      value={shapeLabelForm.legendDescription}
                      onChange={(e) =>
                        setShapeLabelForm((f) => ({
                          ...f,
                          legendDescription: e.target.value,
                        }))
                      }
                      placeholder="např. přívod vody vlevo"
                      className="max-lg:border-white/25 max-lg:bg-slate-950 max-lg:text-white"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border"
                      checked={shapeLabelForm.showLabelInline}
                      onChange={(e) =>
                        setShapeLabelForm((f) => ({
                          ...f,
                          showLabelInline: e.target.checked,
                        }))
                      }
                    />
                    <span>Zobrazit popis přímo u značky (jinak jen číslo + legenda)</span>
                  </label>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShapeLabelDialogOpen(false);
                      setShapeLabelEditingId(null);
                      pendingShapePointRef.current = null;
                    }}
                  >
                    Zrušit
                  </Button>
                  <Button type="button" onClick={() => void commitShapeLabelFromDialog()}>
                    {shapeLabelEditingId ? "Uložit změny" : "Vložit značku"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
      </UnifiedAnnotationEditor>

      <Dialog
        open={arrowNoteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (arrowNoteSavedRef.current) {
              arrowNoteSavedRef.current = false;
              return;
            }
            cancelArrowNoteDialog();
          }
        }}
      >
        <DialogContent
          overlayClassName="z-[560]"
          className="!z-[575] max-w-md border-slate-200 bg-white text-slate-900 max-lg:border-slate-700 max-lg:bg-slate-950 max-lg:text-slate-50"
          onPointerDownOutside={(e) => {
            if (arrowNoteIsNew) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (arrowNoteIsNew) {
              e.preventDefault();
              cancelArrowNoteDialog();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Popis šipky</DialogTitle>
            <DialogDescription>
              Text se zobrazí v legendě ve tvaru číslo – popis (např. „4 – upravit příčku na šířku
              225“).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="arrow-note-desc">Popis</Label>
            <Textarea
              id="arrow-note-desc"
              rows={3}
              value={arrowNoteEditText}
              onChange={(e) => setArrowNoteEditText(e.target.value)}
              placeholder="např. upravit příčku na šířku 225"
              className="resize-y"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => cancelArrowNoteDialog()}>
              Zrušit
            </Button>
            <Button type="button" onClick={() => void saveArrowNoteDialog()}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={shapeLabelLibraryPickerOpen}
        onOpenChange={setShapeLabelLibraryPickerOpen}
      >
        <DialogContent
          overlayClassName="z-[560]"
          className="!z-[575] sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Vyberte model z knihovny</DialogTitle>
            <DialogDescription>
              Po výběru klepněte na obrázek a značka se vloží s rozměry modelu.
            </DialogDescription>
          </DialogHeader>
          {annotationModelsSorted.length ? (
            <ul className="max-h-[min(60dvh,360px)] space-y-1 overflow-y-auto pr-1">
              {annotationModelsSorted.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-border px-3 py-2.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setShapeLabelPlacementModel(m);
                      shapeLabelPlacementModelRef.current = m;
                      setActiveTool("shapeLabel");
                      setShapeLabelLibraryPickerOpen(false);
                    }}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {m.widthMm} × {m.heightMm} mm
                    </span>
                    <span className="ml-2 rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                      Použít
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Zatím nemáte uložené žádné modely. Přidejte je přes tlačítko Modely v editoru.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShapeLabelLibraryPickerOpen(false)}
            >
              Zavřít
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AnnotationModelsSettingsDialog
        open={annotationModelsSettingsOpen}
        onOpenChange={setAnnotationModelsSettingsOpen}
        firestore={firestore}
        companyId={companyId}
        userId={user?.uid ?? null}
        models={annotationModelsSorted}
      />
    </>
  );

  if (isLoading && !isStandaloneMeasurementEditorRoute) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!job && !isStandaloneMeasurementEditorRoute) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Zakázka nenalezena</h2>
        <Button variant="link" onClick={() => router.push("/portal/jobs")}>
          Zpět na seznam
        </Button>
      </div>
    );
  }

  if (isStandaloneMeasurementEditorRoute) {
    const standaloneMeasurementBackHref =
      sanitizeMeasurementEditorReturnTo(searchParams.get("returnTo")) ??
      "/portal/dashboard";
    return (
      <div className={JD.page}>
        <div className={JD.contentMax}>
          <div className="flex flex-col gap-4 py-8">
            <Button
              variant="ghost"
              className="h-10 w-10 shrink-0 w-fit"
              onClick={() => router.push(standaloneMeasurementBackHref)}
            >
              <ChevronLeft className="w-6 h-6" />
              <span className="sr-only">Zpět</span>
            </Button>
            <div className="max-w-xl space-y-2">
              <h1 className={JD.headerTitle}>Foto zaměření — zařadím později</h1>
              <p className="text-sm text-slate-600">
                Vyfoťte nebo nahrajte snímek, upravte kóty v editoru a uložte. Fotka se zobrazí mezi
                nezařazenými na hlavní stránce (widget s fotoaparátem), kde ji později přiřadíte k zakázce.
              </p>
            </div>
          </div>
        </div>
        {measurementAnnotationEditorDialog}
      </div>
    );
  }

  return (
    <div className={JD.page}>
      <div className={JD.contentMax}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3 min-w-0">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => router.push("/portal/jobs")}>
          <ChevronLeft className="w-6 h-6" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className={JD.headerTitle}>{job.name}</h1>
            {(job as { jobTag?: string }).jobTag?.trim() ? (
              <Badge variant="secondary" className="font-normal max-w-[12rem] truncate">
                {jobTagLabel((job as { jobTag?: string }).jobTag)}
              </Badge>
            ) : null}
            <Badge variant="outline" className="border-primary/30 text-primary">
              ID: {jobId?.toString().substring(0, 8)}
            </Badge>
          </div>
          <p className={JD.headerSubtitle}>Detailní přehled projektu</p>
          {(job as any)?.sourceMeasurementId ? (
            <p className="text-sm text-slate-800 mt-1">
              <Link
                href="/portal/jobs/measurements"
                className="text-primary font-medium hover:underline"
              >
                Přehled zaměření
              </Link>
              <span className="text-slate-800"> · zakázka vznikla ze zaměření</span>
            </p>
          ) : null}
        </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {isAdmin && (
            <Select value={job.status} onValueChange={handleStatusChange}>
              <SelectTrigger
                className={cn(LIGHT_SELECT_TRIGGER_CLASS, "h-10 w-[min(100%,180px)] min-w-[140px]")}
              >
                <SelectValue placeholder="Změnit stav" />
              </SelectTrigger>
              <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
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
            className={JD.actionButton}
            onClick={openEditJobDialog}
          >
            <Edit2 className="w-4 h-4" /> Upravit zakázku
          </Button>

          <Button
            variant="outline"
            className={JD.actionButton}
            onClick={() => void openContractDialog("sod_work")}
          >
            <FileText className="w-4 h-4" /> Vytvořit smlouvu
          </Button>

          {isAdmin && (
            <Button variant="destructive" className={JD.actionButton} onClick={handleDeleteJob}>
              <Trash2 className="w-4 h-4" /> Smazat
            </Button>
          )}
        </div>
      </div>

      {user && companyId && jobFirestoreId ? (
        <JobTasksSection
          companyId={companyId}
          jobId={jobFirestoreId!}
          user={user}
          canEdit={canManageFolders}
        />
      ) : null}

      {user && companyId && jobFirestoreId && canSeeMeetingRecords ? (
        <JobMeetingRecordsSection
          firestore={firestore}
          companyId={companyId}
          jobId={jobFirestoreId}
          jobName={
            typeof job?.name === "string" && job.name.trim() ? job.name.trim() : "Zakázka"
          }
          jobs={jobOptionsForMeeting}
          user={user}
          profile={profile as ActivityActorProfile | null | undefined}
          canEdit={canEditMeetingRecords}
        />
      ) : null}

      <div className={JD.grid}>
        <div className={JD.mainCol}>
          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitle}>
                <FileText aria-hidden /> Popis zakázky
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={JD.body}>
                {job.description || "K této zakázce nebyl přidán žádný popis."}
              </p>
            </CardContent>
          </Card>

          {companyId && jobFirestoreId ? (
            <JobCustomerProgressAdminSection
              companyId={companyId}
              jobId={jobFirestoreId!}
              jobRef={jobRef}
              job={job as Record<string, unknown>}
              canEdit={canManageFolders}
            />
          ) : null}

          {companyId && jobFirestoreId ? (
            <JobCustomerTasksAdminSection
              companyId={companyId}
              jobId={jobFirestoreId!}
              job={job as Record<string, unknown>}
              canEdit={canManageFolders}
            />
          ) : null}

          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitle}>
                <MapPin aria-hidden /> Zákazník a adresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobCustomerAddressBlock.displayName ? (
                <div className="space-y-1">
                  <span className={JD.label}>
                    Zákazník
                  </span>
                  <p className="text-base font-semibold text-foreground">
                    {jobCustomerAddressBlock.displayName}
                  </p>
                  {customerAccessEmailSent ? (
                    <p className="text-xs text-muted-foreground">
                      Přístup odeslán e-mailem
                      {customerAccessEmailSentAt
                        ? `: ${customerAccessEmailSentAt.toLocaleString("cs-CZ")}`
                        : ""}
                    </p>
                  ) : null}
                  {isAdmin && customerId ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8"
                      disabled={customerAccessEmailSending}
                      onClick={() => void sendCustomerAccessEmailFromJob()}
                    >
                      {customerAccessEmailSending ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Odeslat přístup e-mailem
                    </Button>
                  ) : null}
                  {isAdmin && jobFirestoreId && customerPortalPreviewGate.show ? (
                    customerPortalPreviewGate.disabled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 h-8 w-full sm:w-auto"
                        disabled
                        title="Zákazník ještě nemá vytvořené přihlášení do portálu"
                      >
                        Zákaznický profil není vytvořen
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-2 h-8 w-full sm:w-auto"
                        asChild
                      >
                        <Link href={`/portal/jobs/${jobFirestoreId}/customer-preview`}>
                          Náhled jako zákazník
                        </Link>
                      </Button>
                    )
                  ) : null}
                </div>
              ) : (
                <p className={JD.bodyMuted}>
                  U zakázky není uveden název zákazníka.
                </p>
              )}
              <div className="space-y-1">
                <span className={JD.label}>
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
                  <p className={JD.bodyMuted}>
                    Adresa zákazníka není vyplněna
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitle}>
                <FileText aria-hidden /> Měření
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={JD.body}>
                {job.measuring || "Žádné poznámky k měření."}
              </p>
              {job.measuringDetails && (
                <p className="mt-2 text-sm text-gray-800">{job.measuringDetails}</p>
              )}
            </CardContent>
          </Card>

          <Card className={cn(JD.card)}>
            <CardHeader className="space-y-3">
              <CardTitle className={JD.cardTitle}>
                <FileText aria-hidden /> Smlouvy a dodatky
              </CardTitle>
              <p className={cn(JD.bodyMuted, "text-sm font-normal")}>
                Dokumenty ke zakázce používají stejnou šablonu a data jako smlouva o dílo;
                název a řadu čísel lze nastavit zvlášť u každého záznamu.
              </p>
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full sm:w-auto"
                  onClick={() => void openContractDialog("new_contract")}
                >
                  Nová smlouva
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full sm:w-auto"
                  onClick={() => void openContractDialog("new_addendum")}
                >
                  Nový dodatek
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full sm:w-auto"
                  onClick={() => {
                    const first = workContractsBaseForJob.find((c) => {
                      const r = String(c.documentRole ?? "").trim();
                      return r !== "attachment" && r !== "addendum";
                    });
                    if (!first) {
                      toast({
                        variant: "destructive",
                        title: "Nejprve smlouva",
                        description:
                          "Přílohu lze vytvořit až po uložení smlouvy u zakázky.",
                      });
                      return;
                    }
                    void openContractDialog("new_attachment", {
                      parentContractId: first.id,
                    });
                  }}
                >
                  Nová příloha
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 w-full sm:w-auto"
                  onClick={() => void openContractDialog("sod_work")}
                >
                  Smlouva o dílo (standard)
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isWorkContractsLoading ? (
                <p className={JD.bodyMuted}>Načítání…</p>
              ) : workContractsForJob.length === 0 ? (
                <p className={JD.bodyMuted}>
                  Zatím žádné smlouvy ani dodatky. Použijte tlačítka výše nebo záhlaví
                  stránky.
                </p>
              ) : (
                <div className="space-y-3">
                  {workContractsBaseForJob.map((c) => {
                    const atts =
                      attachmentsByParentContractId.get(c.id) ?? [];
                    const roleNorm = String(c.documentRole ?? "").trim();
                    const canAttach =
                      roleNorm !== "attachment" && roleNorm !== "addendum";
                    return (
                      <div
                        key={c.id}
                        className={cn(JD.innerBox, "space-y-3")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">
                              {workContractDisplayTitle(c)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {workContractDisplayTypeLabel(c)}
                              {c.parentContractId
                                ? (() => {
                                    const parent = workContractsForJob.find(
                                      (x) => x.id === c.parentContractId
                                    );
                                    return parent
                                      ? ` · Nadřazená: ${workContractDisplayTitle(parent)}`
                                      : " · Nadřazená smlouva (nenalezena)";
                                  })()
                                : ""}
                            </p>
                            {(c as WorkContractDoc).contractNumber ? (
                              <p className="text-xs font-mono text-foreground/90">
                                Číslo: {(c as WorkContractDoc).contractNumber}
                              </p>
                            ) : null}
                            <p className="text-xs text-gray-800">
                              Uloženo:{" "}
                              {formatContractDate(c.updatedAt || c.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-xs"
                            type="button"
                            onClick={() => openWorkContract(c.id, "view")}
                          >
                            Otevřít
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-xs"
                            type="button"
                            onClick={() => openWorkContract(c.id, "edit")}
                          >
                            Upravit
                          </Button>
                          {canAttach ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 text-xs"
                              type="button"
                              onClick={() =>
                                void openContractDialog("new_addendum", {
                                  parentContractId: c.id,
                                })
                              }
                            >
                              Vytvořit dodatek
                            </Button>
                          ) : null}
                          {canAttach ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-9 text-xs"
                              type="button"
                              onClick={() =>
                                void openContractDialog("new_attachment", {
                                  parentContractId: c.id,
                                })
                              }
                            >
                              Vytvořit přílohu
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-xs"
                            type="button"
                            onClick={() => generatePDFFromContractId(c.id)}
                          >
                            Generovat PDF
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-9 text-xs"
                            type="button"
                            onClick={() => deleteWorkContract(c.id)}
                          >
                            Smazat
                          </Button>
                        </div>

                        {atts.length > 0 ? (
                          <div className="border-t border-border pt-3 space-y-2">
                            <p className="text-xs font-semibold text-foreground">
                              Přílohy ke smlouvě
                            </p>
                            <ul className="space-y-2">
                              {atts.map((a) => (
                                <li
                                  key={a.id}
                                  className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2"
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium truncate">
                                        {workContractDisplayTitle(a)}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {typeof a.attachmentOrdinal ===
                                        "number"
                                          ? `Příloha č. ${a.attachmentOrdinal} · `
                                          : ""}
                                        Ke smlouvě č.{" "}
                                        {String(
                                          a.parentContractNumber ?? ""
                                        ).trim() ||
                                          (c as WorkContractDoc).contractNumber ||
                                          "—"}
                                      </p>
                                      <p className="text-xs text-gray-800">
                                        {a.contractNumber ? (
                                          <span className="font-mono">
                                            Číslo přílohy: {a.contractNumber}
                                          </span>
                                        ) : null}
                                        {a.contractNumber ? " · " : null}
                                        Uloženo:{" "}
                                        {formatContractDate(
                                          a.updatedAt || a.createdAt
                                        )}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 shrink-0">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs"
                                        type="button"
                                        onClick={() =>
                                          openWorkContract(a.id, "view")
                                        }
                                      >
                                        Otevřít
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs"
                                        type="button"
                                        onClick={() =>
                                          openWorkContract(a.id, "edit")
                                        }
                                      >
                                        Upravit
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs"
                                        type="button"
                                        onClick={() =>
                                          generatePDFFromContractId(a.id)
                                        }
                                      >
                                        PDF
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-8 text-xs"
                                        type="button"
                                        onClick={() =>
                                          deleteWorkContract(a.id)
                                        }
                                      >
                                        Smazat
                                      </Button>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {job.templateId &&
            template &&
            job.templateValues != null &&
            Object.keys(job.templateValues).length > 0 && (
              <Card className={cn(JD.card)}>
                <CardHeader>
                  <CardTitle className={JD.cardTitle}>
                    <FileStack aria-hidden /> Data šablony:{" "}
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
                          <p className={cn(JD.label, "mb-2 normal-case")}>
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
                                  <dt className="text-gray-800">{f.label}</dt>
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

          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitle}>
                <Clock aria-hidden /> Časová osa a pokrok
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="mb-2 flex justify-between text-sm text-gray-900">
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

              <div className="grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 sm:grid-cols-2 sm:gap-8">
                <div className="space-y-1">
                  <span className={JD.label}>
                    Zahájeno
                  </span>
                  <div className="flex items-center gap-2 font-semibold text-gray-950">
                    <Calendar className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    {job.startDate || "neuvedeno"}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className={JD.label}>
                    Předpokládané dokončení
                  </span>
                  <div className="flex items-center gap-2 font-semibold text-gray-950">
                    <Calendar className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    {job.endDate || "neuvedeno"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitle}>
                <Users aria-hidden /> Přiřazení pracovníci
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {job.assignedEmployeeIds?.map((empId: string) => (
                  <div
                    key={empId}
                    className={cn(JD.innerBox, "flex items-center justify-between")}
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
                  <p className={JD.bodyMuted}>
                    Žádní pracovníci nejsou přiřazeni.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className={JD.sideCol}>
          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitlePlain}>Finanční údaje</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobBudgetBreakdown ? (
                <div className={JD.financeHighlight}>
                  <p className={cn(JD.label, "normal-case")}>
                    Přehled (s DPH)
                  </p>
                  <div className="flex justify-between gap-4 tabular-nums">
                    <span>Rozpočet</span>
                    <span className="font-semibold">
                      {jobBudgetBreakdown.budgetGross.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 tabular-nums">
                    <span>Náklady</span>
                    <span className="font-semibold">
                      {jobExpenseTotals.gross.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div
                    className={cn(
                      "flex justify-between gap-4 border-t border-gray-200 pt-2 text-base font-semibold tabular-nums",
                      remainingBudgetAfterExpensesGrossKc != null &&
                        remainingBudgetAfterExpensesGrossKc < 0
                        ? "text-destructive"
                        : "text-slate-900"
                    )}
                  >
                    <span>Zbývá</span>
                    <span>
                      {remainingBudgetAfterExpensesGrossKc != null
                        ? `${remainingBudgetAfterExpensesGrossKc.toLocaleString("cs-CZ")} Kč`
                        : "—"}
                    </span>
                  </div>
                </div>
              ) : null}
              {jobBudgetBreakdown ? (
                <div className={JD.financeBreakdown}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-normal text-gray-900">
                      Zadáno
                    </Badge>
                    <span className="text-gray-800">
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
                    <span className="text-gray-800">Rozpočet bez DPH</span>
                    <span className="font-semibold tabular-nums">
                      {jobBudgetBreakdown.budgetNet.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-800">
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-gray-800">Rozpočet</span>
                  <span className="text-xl font-bold tabular-nums text-gray-950">—</span>
                </div>
              )}
              {jobBudgetBreakdown ? (
                <div className="space-y-1 border-t border-gray-200 pt-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-800">Zaplaceno bez DPH</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {jobPaid.paidNet.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-800">Zaplaceno s DPH</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {jobPaid.paidGross.toLocaleString("cs-CZ")} Kč
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-800">K doplatení (bez DPH)</span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        remainingToPayNetKc != null && remainingToPayNetKc < 0
                          ? "text-destructive"
                          : "text-slate-900"
                      )}
                    >
                      {remainingToPayNetKc != null
                        ? `${remainingToPayNetKc.toLocaleString("cs-CZ")} Kč`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-base font-semibold">
                    <span className="text-slate-900">K doplatení (s DPH)</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        remainingToPayGrossKc != null && remainingToPayGrossKc < 0
                          ? "text-destructive"
                          : "text-slate-900"
                      )}
                    >
                      {remainingToPayGrossKc != null
                        ? `${remainingToPayGrossKc.toLocaleString("cs-CZ")} Kč`
                        : "—"}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-slate-800">Náklady bez DPH</span>
                  <span className="text-lg font-semibold tabular-nums text-slate-900">
                    {jobExpenseTotals.net.toLocaleString("cs-CZ")} Kč
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-slate-800">Náklady s DPH</span>
                  <span className="text-lg font-semibold tabular-nums text-slate-900">
                    {jobExpenseTotals.gross.toLocaleString("cs-CZ")} Kč
                  </span>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className="text-gray-800">Zbývá bez DPH</span>
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
              {jobIncomesSorted.length > 0 || folderSourceExpenses.length > 0 ? (
                <div className="space-y-2 border-t border-gray-200 pt-3 text-sm">
                  <p className="font-semibold text-gray-950">
                    Doklady ze složky dokladů
                  </p>
                  <ul className="space-y-2">
                    {jobIncomesSorted.map((row) => (
                      <li
                        key={`inc-${row.id}`}
                        className="flex flex-wrap justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5"
                      >
                        <span className="text-slate-800">
                          {row.source === "company_document"
                            ? `Vydaný doklad · ${row.fileName || row.number || row.id}`
                            : `Příjem · ${row.fileName || row.id}`}
                        </span>
                        <span className="tabular-nums text-slate-900">
                          {typeof row.amountGross === "number"
                            ? row.amountGross.toLocaleString("cs-CZ")
                            : "—"}{" "}
                          Kč · {row.date || "—"}
                        </span>
                      </li>
                    ))}
                    {folderSourceExpenses.map((row) => {
                      const r = resolveExpenseAmounts(row);
                      return (
                        <li
                          key={`exp-${row.id}`}
                          className="flex flex-wrap justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5"
                        >
                          <span className="text-slate-800">
                            Náklad · {row.fileName || row.note || row.id}
                          </span>
                          <span className="tabular-nums text-slate-900">
                            {r.amountGross.toLocaleString("cs-CZ")} Kč ·{" "}
                            {row.date || "—"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-800">Vyfakturováno (s DPH)</span>
                <span className="font-semibold text-emerald-700">
                  {job.status === "fakturována" && jobBudgetBreakdown
                    ? `${jobBudgetBreakdown.budgetGross.toLocaleString("cs-CZ")} Kč`
                    : "0 Kč"}
                </span>
              </div>
            </CardContent>
          </Card>

          {companyId && jobFirestoreId ? (
            <JobBillingInvoicesSection
              companyId={companyId}
              jobId={String(jobId)}
              job={job as Record<string, unknown>}
              jobName={
                job?.name != null && String(job.name).trim() !== ""
                  ? String(job.name).trim()
                  : "Zakázka"
              }
              customerId={job?.customerId as string | undefined}
              customerName={jobCustomerAddressBlock.displayName}
              customerAddressLines={jobCustomerAddressBlock.addressLines.join("\n")}
              jobBudgetBreakdown={jobBudgetBreakdown}
              workContractsForJob={workContractsForJob}
              companyDoc={companyDoc as Record<string, unknown> | null | undefined}
              companyDisplayName={
                companyNameFromDoc ||
                (companyDoc as { companyName?: string } | null | undefined)?.companyName ||
                "Organizace"
              }
              user={user}
              canManage={canManageFolders}
              canSoftDeleteInvoices={isAdmin}
              jobStatus={
                job && typeof (job as { status?: string }).status === "string"
                  ? String((job as { status: string }).status)
                  : ""
              }
            />
          ) : null}

          {companyId && jobFirestoreId && user && firestore ? (
            <JobCommentsThread
              firestore={firestore}
              companyId={companyId}
              jobId={String(jobId)}
              userId={user.uid}
              authorName={
                String(
                  (profile as { displayName?: unknown; name?: unknown; email?: unknown })?.displayName ??
                    (profile as { name?: unknown })?.name ??
                    (profile as { email?: unknown })?.email ??
                    user.email ??
                    ""
                ).trim() || "Admin"
              }
              authorRole="admin"
              canPost={true}
              title="Poznámky / chat k zakázce"
              target={{ targetType: "job" }}
              onAfterSend={async () => {
                // Notifikace řešíme přes API (Admin SDK), aby šlo dohledat cílové uživatele.
                try {
                  const token = await user.getIdToken();
                  await fetch("/api/jobs/comments/notify", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      companyId,
                      jobId: String(jobId),
                      targetType: "job",
                    }),
                  });
                } catch {
                  // ignore
                }
              }}
            />
          ) : null}

          {companyId && jobFirestoreId ? (
            <JobDocumentEmailSection
              companyId={companyId}
              jobId={String(jobFirestoreId)}
              job={job as Record<string, unknown>}
              companyDoc={companyDoc as Record<string, unknown> | null | undefined}
              companyDisplayName={
                companyNameFromDoc ||
                (companyDoc as { companyName?: string } | null | undefined)?.companyName ||
                "Organizace"
              }
              customerName={jobCustomerAddressBlock.displayName}
              customerEmail={customerEmailForJob}
              workContractsForJob={workContractsForJob}
              jobBudgetBreakdown={jobBudgetBreakdown}
              canManage={canManageFolders}
            />
          ) : null}

          {companyId && jobFirestoreId && user ? (
            <JobMaterialOrdersSection
              companyId={companyId}
              companyDisplayName={
                companyNameFromDoc ||
                (companyDoc as { companyName?: string } | null | undefined)?.companyName ||
                "Organizace"
              }
              jobId={jobFirestoreId}
              job={job as Record<string, unknown>}
              customerName={jobCustomerAddressBlock.displayName}
              customerAddressLines={jobCustomerAddressBlock.addressLines.join("\n")}
              userId={user.uid}
              canManage={canManageFolders}
              companyDoc={(companyDoc as Record<string, unknown> | null | undefined) ?? null}
            />
          ) : null}

          {companyId && jobFirestoreId && user && vyrobaModuleOn && showVyrobaWorkshopEntry ? (
            <Card className={cn(JD.card, "border-primary/20 bg-gradient-to-br from-primary/5 to-white")}>
              <CardHeader className="pb-2">
                <CardTitle className={cn(JD.cardTitlePlain, "flex items-center gap-2")}>
                  <Factory className="h-5 w-5 text-primary" />
                  Výrobní dílna (zakázka ve výrobě)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-800">
                <p>
                  Otevře se bezpečný přehled bez cen a faktur: stav výroby, výdej materiálu včetně metráže a
                  zbytků, spotřeba a velké náhledy podkladů.
                </p>
                <Button type="button" asChild>
                  <Link href={`/portal/vyroba/zakazky/${String(jobFirestoreId)}`}>
                    Otevřít výrobní dílnu této zakázky
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {companyId && jobFirestoreId && user && vyrobaModuleOn && firestore ? (
            <JobProductionTeamSection
              firestore={firestore}
              companyId={companyId}
              jobId={String(jobFirestoreId)}
              job={job as Record<string, unknown>}
              canManage={canManageFolders}
              user={user}
            />
          ) : null}

          <Card className={cn(JD.card)}>
            <CardHeader>
              <CardTitle className={JD.cardTitlePlain}>Poznámky a historie</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4 text-sm">
                <div className="flex gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="font-semibold text-gray-950">Zakázka vytvořena</p>
                    <p className="text-xs text-gray-800">
                      {job.createdAt?.toDate
                        ? job.createdAt.toDate().toLocaleString("cs-CZ")
                        : "-"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="font-semibold text-gray-950">Stav změněn na &quot;{job.status}&quot;</p>
                    <p className="text-xs text-gray-800">
                      {job.updatedAt?.toDate
                        ? job.updatedAt.toDate().toLocaleString("cs-CZ")
                        : "-"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
      </div>

      {user && companyId && jobFirestoreId ? (
        <section
          className={JD.sectionBand}
          aria-labelledby="job-measurement-photos-heading"
        >
          <div className={JD.sectionBandInner}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <h2
                id="job-measurement-photos-heading"
                className="text-lg font-semibold tracking-tight text-slate-900"
              >
                Foto zaměření
              </h2>
              {canManageFolders ? (
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={measurementGalleryInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      void handleMeasurementPhotoQuickImport(f);
                    }}
                  />
                  <input
                    ref={measurementCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      void handleMeasurementPhotoQuickImport(f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    disabled={measurementCaptureBusy}
                    onClick={() => measurementGalleryInputRef.current?.click()}
                  >
                    {measurementCaptureBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="h-4 w-4" />
                    )}
                    Nahrát / vybrat fotku
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={measurementCaptureBusy}
                    onClick={() => measurementCameraInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    Vyfotit
                  </Button>
                </div>
              ) : null}
            </div>
            {measurementPhotosIndexPending || measurementPhotosError ? (
              <Alert
                className="mt-2 border-amber-200 bg-amber-50/90 text-amber-950"
                variant="default"
              >
                <AlertTitle className="text-sm">
                  Foto zaměření — načítání dat
                </AlertTitle>
                <AlertDescription className="text-xs sm:text-sm">
                  {measurementPhotosIndexPending
                    ? "Firestore index se vytváří, nebo dotaz ještě není dostupný. Zkuste stránku obnovit za chvíli. Pokud problém přetrvá, kontaktujte správce (chybějící index pro measurement_photos)."
                    : measurementPhotosError instanceof Error
                      ? measurementPhotosError.message
                      : "Nepodařilo se načíst seznam fotek zaměření."}
                </AlertDescription>
              </Alert>
            ) : null}
            {measurementPhotosLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Načítání…</p>
            ) : !measurementPhotosRaw?.length ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Zatím žádné foto zaměření u této zakázky.
                {canManageFolders ? (
                  <span>
                    {" "}
                    Použijte tlačítka výše — otevře se editor kót a poznámek jako u fotodokumentace.
                  </span>
                ) : null}
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {(measurementPhotosRaw ?? []).map((raw) => {
                  const row = raw as Record<string, unknown> & {
                    id: string;
                    createdBy?: string;
                  };
                  const preview = getJobMediaPreviewUrl({
                    annotatedImageUrl:
                      typeof row.annotatedImageUrl === "string"
                        ? row.annotatedImageUrl
                        : undefined,
                    imageUrl:
                      typeof row.imageUrl === "string" ? row.imageUrl : undefined,
                    url: typeof row.url === "string" ? row.url : undefined,
                    downloadURL:
                      typeof row.downloadURL === "string"
                        ? row.downloadURL
                        : undefined,
                    originalImageUrl:
                      typeof row.originalImageUrl === "string"
                        ? row.originalImageUrl
                        : undefined,
                  });
                  const titleStr =
                    typeof row.title === "string" && row.title.trim()
                      ? row.title.trim()
                      : "Foto zaměření";
                  const canDel =
                    canManageFolders || row.createdBy === user?.uid;
                  const isUnassigned = isMeasurementPhotoUnassignedForJob(row);
                  return (
                    <div
                      key={row.id}
                      className="group relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden"
                    >
                      {isUnassigned ? (
                        <Badge
                          variant="secondary"
                          className="absolute left-1 top-1 z-10 text-[10px] font-medium"
                        >
                          Nezařazená
                        </Badge>
                      ) : null}
                      <button
                        type="button"
                        className="block w-full aspect-square bg-black/5"
                        onClick={() => setMeasurementLightboxDocId(row.id)}
                      >
                        {preview ? (
                          <img
                            src={preview}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground p-2">
                            Bez náhledu
                          </span>
                        )}
                      </button>
                      <div className="p-2 space-y-1">
                        <p
                          className="text-xs font-medium text-slate-900 truncate"
                          title={titleStr}
                        >
                          {titleStr}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatMediaDate(row.createdAt)}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 text-xs"
                            onClick={() => {
                              openMeasurementPhotoAnnotationFromRow(row);
                            }}
                          >
                            <Edit2 className="w-3 h-3 mr-1" />
                            Anotovat
                          </Button>
                          {isUnassigned && canManageFolders ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() =>
                                void handleAssignMeasurementPhotoToCurrentJob(row)
                              }
                            >
                              Přiřadit k zakázce
                            </Button>
                          ) : null}
                          {isUnassigned && canManageFolders ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-0.5 px-1.5 text-[10px]"
                              title="Kopírovat do běžné fotodokumentace zakázky"
                              onClick={() =>
                                void handleTransferMeasurementToJobPhotos(row)
                              }
                            >
                              <FolderInput className="h-3 w-3" />
                              Do fotek
                            </Button>
                          ) : null}
                          {canDel ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs text-destructive"
                              onClick={() =>
                                void handleDeleteMeasurementPhoto(row)
                              }
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <Dialog
        open={Boolean(measurementLightboxDocId)}
        onOpenChange={(open) => {
          if (!open) setMeasurementLightboxDocId(null);
        }}
      >
        <DialogContent className="max-w-[min(96vw,900px)] bg-white border-slate-200">
          <DialogHeader>
            <DialogTitle>Náhled — foto zaměření</DialogTitle>
            <DialogDescription className="sr-only">
              Velký náhled fotografie se zaměřením.
            </DialogDescription>
          </DialogHeader>
          {measurementLightboxRow ? (
            <img
              src={getJobMediaPreviewUrl({
                annotatedImageUrl:
                  typeof measurementLightboxRow.annotatedImageUrl === "string"
                    ? measurementLightboxRow.annotatedImageUrl
                    : undefined,
                imageUrl:
                  typeof measurementLightboxRow.imageUrl === "string"
                    ? measurementLightboxRow.imageUrl
                    : undefined,
                url:
                  typeof measurementLightboxRow.url === "string"
                    ? measurementLightboxRow.url
                    : undefined,
                downloadURL:
                  typeof measurementLightboxRow.downloadURL === "string"
                    ? measurementLightboxRow.downloadURL
                    : undefined,
                originalImageUrl:
                  typeof measurementLightboxRow.originalImageUrl === "string"
                    ? measurementLightboxRow.originalImageUrl
                    : undefined,
              })}
              alt=""
              className="max-h-[75vh] w-auto max-w-full mx-auto rounded-md"
            />
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            {measurementLightboxRow ? (
              <Button
                type="button"
                onClick={() => {
                  setMeasurementLightboxDocId(null);
                  openMeasurementPhotoAnnotationFromRow(measurementLightboxRow);
                }}
              >
                Upravit anotace
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setMeasurementLightboxDocId(null)}
            >
              Zavřít
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {user && companyId && jobFirestoreId ? (
        <section
          className={JD.sectionBand}
          aria-labelledby="job-media-heading"
        >
          <div className={JD.sectionBandInner}>
            <JobMediaSection
              companyId={companyId}
              jobId={jobFirestoreId!}
              jobDisplayName={job?.name ?? null}
              jobRecord={job ? (job as Record<string, unknown>) : null}
              user={user}
              canManageFolders={canManageFolders}
              photos={photos?.filter(isUsablePhotoRow) as PhotoDoc[] | undefined}
              uploadLegacyPhoto={async (file, opts) => {
                await handlePhotoUpload(file, opts);
              }}
              legacyUploading={isUploading}
              layout="jobDetailWide"
              onAnnotatePhoto={openPhotoAnnotationEditor}
            />
          </div>
        </section>
      ) : null}

      {user && companyId && jobFirestoreId ? (
        <section
          className={JD.sectionBand}
          aria-labelledby="job-expenses-heading"
        >
          <div className={JD.sectionBandInner}>
            <JobExpensesSection
              companyId={companyId}
              jobId={jobFirestoreId!}
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

      {user && companyId && jobFirestoreId ? (
        <section className={JD.sectionBand} aria-labelledby="job-product-catalogs-heading">
          <div className={JD.sectionBandInner}>
            <JobProductCatalogsSection companyId={companyId} jobId={jobFirestoreId!} />
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

                <div className="space-y-3 md:col-span-2">
                  <Label>Zákazník</Label>
                  <RadioGroup
                    value={jobEditForm.customerInputMode}
                    onValueChange={(v) =>
                      setJobEditForm((prev) => ({
                        ...prev,
                        customerInputMode: v as JobCustomerInputMode,
                        ...(v === "list"
                          ? {
                              manualCustomerCompanyName: "",
                              manualCustomerAddress: "",
                              manualCustomerEmail: "",
                              manualCustomerPhone: "",
                              manualCustomerNotes: "",
                            }
                          : { customerId: "" }),
                      }))
                    }
                    className="flex flex-col gap-2 sm:flex-row sm:gap-8"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="list" id="job-edit-cust-list" />
                      <Label
                        htmlFor="job-edit-cust-list"
                        className="font-normal cursor-pointer"
                      >
                        Vybrat ze seznamu
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="manual" id="job-edit-cust-manual" />
                      <Label
                        htmlFor="job-edit-cust-manual"
                        className="font-normal cursor-pointer"
                      >
                        Nový zákazník (ručně)
                      </Label>
                    </div>
                  </RadioGroup>

                  {jobEditForm.customerInputMode === "list" ? (
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
                  ) : (
                    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                      <p className="text-sm text-foreground">
                        Po uložení se vytvoří záznam v sekci Zákazníci a zakázka
                        se s ním propojí. Povinné jsou název / jméno a adresa.
                      </p>
                      {customerEditDuplicateHint ? (
                        <Alert className="border-amber-200 bg-amber-50/90 text-amber-950">
                          <AlertTitle className="text-sm">
                            Možná duplicita
                          </AlertTitle>
                          <AlertDescription className="text-xs sm:text-sm space-y-2">
                            <span>
                              Zákazník s tímto jménem už v adresáři existuje —
                              můžete ho vybrat ze seznamu místo vytváření nového
                              záznamu.
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-1"
                              onClick={() => {
                                const id = customerEditDuplicateHint.id;
                                if (!id) return;
                                setJobEditForm((prev) => ({
                                  ...prev,
                                  customerInputMode: "list",
                                  customerId: id,
                                  manualCustomerCompanyName: "",
                                  manualCustomerAddress: "",
                                  manualCustomerEmail: "",
                                  manualCustomerPhone: "",
                                  manualCustomerNotes: "",
                                }));
                              }}
                            >
                              Použít:{" "}
                              {customerEditDuplicateHint.companyName ||
                                `${customerEditDuplicateHint.firstName || ""} ${
                                  customerEditDuplicateHint.lastName || ""
                                }`.trim() ||
                                "existující zákazník"}
                            </Button>
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="job-edit-manual-cust-name">
                            Název firmy / jméno
                            <span className="text-destructive"> *</span>
                          </Label>
                          <Input
                            id="job-edit-manual-cust-name"
                            value={jobEditForm.manualCustomerCompanyName}
                            onChange={(e) =>
                              setJobEditForm((prev) => ({
                                ...prev,
                                manualCustomerCompanyName: e.target.value,
                              }))
                            }
                            placeholder="Např. Novákovi s.r.o."
                            className={cn(
                              LIGHT_FORM_CONTROL_CLASS,
                              "min-h-[44px] md:min-h-10"
                            )}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="job-edit-manual-cust-email">
                            Email
                          </Label>
                          <Input
                            id="job-edit-manual-cust-email"
                            type="email"
                            value={jobEditForm.manualCustomerEmail}
                            onChange={(e) =>
                              setJobEditForm((prev) => ({
                                ...prev,
                                manualCustomerEmail: e.target.value,
                              }))
                            }
                            className={cn(
                              LIGHT_FORM_CONTROL_CLASS,
                              "min-h-[44px] md:min-h-10"
                            )}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="job-edit-manual-cust-phone">
                            Telefon
                          </Label>
                          <Input
                            id="job-edit-manual-cust-phone"
                            value={jobEditForm.manualCustomerPhone}
                            onChange={(e) =>
                              setJobEditForm((prev) => ({
                                ...prev,
                                manualCustomerPhone: e.target.value,
                              }))
                            }
                            className={cn(
                              LIGHT_FORM_CONTROL_CLASS,
                              "min-h-[44px] md:min-h-10"
                            )}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="job-edit-manual-cust-address">
                            Adresa
                            <span className="text-destructive"> *</span>
                          </Label>
                          <Input
                            id="job-edit-manual-cust-address"
                            value={jobEditForm.manualCustomerAddress}
                            onChange={(e) =>
                              setJobEditForm((prev) => ({
                                ...prev,
                                manualCustomerAddress: e.target.value,
                              }))
                            }
                            placeholder="Ulice, město, PSČ"
                            className={cn(
                              LIGHT_FORM_CONTROL_CLASS,
                              "min-h-[44px] md:min-h-10"
                            )}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="job-edit-manual-cust-notes">
                            Poznámka
                          </Label>
                          <Textarea
                            id="job-edit-manual-cust-notes"
                            value={jobEditForm.manualCustomerNotes}
                            onChange={(e) =>
                              setJobEditForm((prev) => ({
                                ...prev,
                                manualCustomerNotes: e.target.value,
                              }))
                            }
                            className={cn(
                              LIGHT_FORM_CONTROL_CLASS,
                              "min-h-[88px]"
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}
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
              {isContractReadOnly
                ? "Zobrazení dokumentu ke zakázce"
                : contractForm.documentRole === "attachment"
                  ? "Příloha ke smlouvě"
                  : contractForm.documentRole === "addendum"
                    ? "Dodatek ke smlouvě"
                    : "Dokument ke zakázce"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            {contractForm.documentRole === "attachment" ? (
              <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
                Příloha je vždy vázaná na zvolenou smlouvu. Číslo a název nadřazené smlouvy se
                při uložení znovu načtou ze záznamu smlouvy.
              </p>
            ) : null}
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label className="text-slate-900 shrink-0">Vybrat šablonu</Label>
                {!isContractReadOnly && contractForm.documentRole !== "attachment" && (
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
                disabled={isContractReadOnly || contractForm.documentRole === "attachment"}
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
                <Label>Typ dokumentu</Label>
                <Select
                  value={contractForm.documentRole}
                  disabled={isContractReadOnly}
                  onValueChange={(v) => {
                    setIsContractDirty(true);
                    const role =
                      v === "addendum"
                        ? "addendum"
                        : v === "attachment"
                          ? "attachment"
                          : "contract";
                    setContractForm((prev) => ({
                      ...prev,
                      documentRole: role,
                      documentSubtype:
                        role === "addendum"
                          ? "contract_addendum"
                          : role === "attachment"
                            ? "contract_attachment"
                            : prev.documentSubtype === "contract_addendum" ||
                                prev.documentSubtype === "contract_attachment"
                              ? "work_contract"
                              : prev.documentSubtype,
                      numberSeriesPrefix:
                        role === "addendum"
                          ? "DOD"
                          : role === "attachment"
                            ? "PRIL"
                            : prev.numberSeriesPrefix === "DOD" ||
                                prev.numberSeriesPrefix === "PRIL"
                              ? "SOD"
                              : prev.numberSeriesPrefix,
                      parentContractId:
                        role === "addendum" || role === "attachment"
                          ? prev.parentContractId
                          : "",
                      parentContractNumber:
                        role === "attachment" ? prev.parentContractNumber : "",
                      parentContractTitle:
                        role === "attachment" ? prev.parentContractTitle : "",
                      attachmentOrdinal:
                        role === "attachment" ? prev.attachmentOrdinal : 0,
                    }));
                  }}
                >
                  <SelectTrigger
                    className={cn(
                      LIGHT_SELECT_TRIGGER_CLASS,
                      "min-h-[44px] md:min-h-10 bg-background"
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                    <SelectItem value="contract">Smlouva</SelectItem>
                    <SelectItem value="addendum">Dodatek</SelectItem>
                    <SelectItem value="attachment">Příloha ke smlouvě</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Řada čísel (předpona)</Label>
                <Select
                  value={contractForm.numberSeriesPrefix || "SOD"}
                  disabled={
                    isContractReadOnly || !!String(contractForm.contractNumber).trim()
                  }
                  onValueChange={(v) => {
                    setIsContractDirty(true);
                    setContractForm((prev) => ({
                      ...prev,
                      numberSeriesPrefix: v,
                    }));
                  }}
                >
                  <SelectTrigger
                    className={cn(
                      LIGHT_SELECT_TRIGGER_CLASS,
                      "min-h-[44px] md:min-h-10 bg-background"
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                    <SelectItem value="SOD">SOD — smlouva o dílo</SelectItem>
                    <SelectItem value="RS">RS — rezervace / jiná smlouva</SelectItem>
                    <SelectItem value="DOD">DOD — dodatek</SelectItem>
                    <SelectItem value="PRIL">PRIL — příloha ke smlouvě</SelectItem>
                  </SelectContent>
                </Select>
                {!!String(contractForm.contractNumber).trim() ? (
                  <p className="text-xs text-muted-foreground">
                    Řadu nelze změnit po přidělení čísla. Upravte číslo ručně nebo
                    vytvořte nový dokument.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Název dokumentu</Label>
              <Input
                value={contractForm.documentTitle}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    documentTitle: e.target.value,
                  }));
                }}
                placeholder="Např. Rezervační smlouva, Dodatek č. 1…"
                disabled={isContractReadOnly}
              />
            </div>

            {contractForm.documentRole === "addendum" ? (
              <div className="space-y-2">
                <Label>Nadřazená smlouva (volitelné)</Label>
                <Select
                  value={contractForm.parentContractId || "__none__"}
                  disabled={isContractReadOnly}
                  onValueChange={(v) => {
                    setIsContractDirty(true);
                    setContractForm((prev) => ({
                      ...prev,
                      parentContractId: v === "__none__" ? "" : v,
                    }));
                  }}
                >
                  <SelectTrigger
                    className={cn(
                      LIGHT_SELECT_TRIGGER_CLASS,
                      "min-h-[44px] md:min-h-10 bg-background"
                    )}
                  >
                    <SelectValue placeholder="Vyberte smlouvu" />
                  </SelectTrigger>
                  <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                    <SelectItem value="__none__">Bez konkrétní vazby</SelectItem>
                    {parentContractChoices.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {workContractDisplayTitle(p)} ·{" "}
                        {p.contractNumber || "bez čísla"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {contractForm.documentRole === "attachment" ? (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="space-y-2">
                  <Label>Nadřazená smlouva (povinné)</Label>
                  <Select
                    value={contractForm.parentContractId || "__none__"}
                    disabled={isContractReadOnly}
                    onValueChange={(v) => {
                      setIsContractDirty(true);
                      const id = v === "__none__" ? "" : v;
                      const p = parentContractChoices.find((x) => x.id === id);
                      setContractForm((prev) => ({
                        ...prev,
                        parentContractId: id,
                        parentContractNumber: p
                          ? String(p.contractNumber ?? "").trim()
                          : "",
                        parentContractTitle: p ? workContractDisplayTitle(p) : "",
                      }));
                    }}
                  >
                    <SelectTrigger
                      className={cn(
                        LIGHT_SELECT_TRIGGER_CLASS,
                        "min-h-[44px] md:min-h-10 bg-background"
                      )}
                    >
                      <SelectValue placeholder="Vyberte smlouvu" />
                    </SelectTrigger>
                    <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                      <SelectItem value="__none__" disabled>
                        — vyberte smlouvu —
                      </SelectItem>
                      {parentContractChoices.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {parentContractKindLabelFromDoc(p)} ·{" "}
                          {workContractDisplayTitle(p)} ·{" "}
                          {p.contractNumber || "bez čísla"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wide">
                      Číslo smlouvy (nadřazené)
                    </span>
                    <span className="font-mono font-medium">
                      {contractForm.parentContractNumber || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wide">
                      Název smlouvy (nadřazené)
                    </span>
                    <span className="font-medium break-words">
                      {contractForm.parentContractTitle || "—"}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Pořadí přílohy u smlouvy</Label>
                  <Input
                    type="number"
                    min={1}
                    value={
                      contractForm.attachmentOrdinal > 0
                        ? String(contractForm.attachmentOrdinal)
                        : ""
                    }
                    readOnly={isContractReadOnly}
                    onChange={(e) => {
                      setIsContractDirty(true);
                      const n = parseInt(e.target.value, 10);
                      setContractForm((prev) => ({
                        ...prev,
                        attachmentOrdinal:
                          Number.isFinite(n) && n > 0 ? n : prev.attachmentOrdinal,
                      }));
                    }}
                    className="bg-background max-w-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Při prvním uložení se doplní pořadí podle existujících příloh u smlouvy.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Číslo dokumentu</Label>
                <Input
                  value={contractForm.contractNumber}
                  readOnly={isContractReadOnly}
                  onChange={(e) => {
                    setIsContractDirty(true);
                    setContractForm((prev) => ({
                      ...prev,
                      contractNumber: e.target.value,
                    }));
                  }}
                  placeholder="Přidělí se při uložení"
                  className={cn(
                    "font-mono text-foreground",
                    isContractReadOnly ? "bg-muted/40" : "bg-background"
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Datum dokumentu (tisk / VS)</Label>
                <Input
                  value={contractForm.contractDateLabel}
                  readOnly
                  placeholder="—"
                  className="bg-muted/40 text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Podtyp (volitelné)</Label>
              <Input
                value={contractForm.documentSubtype}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    documentSubtype: e.target.value,
                  }));
                }}
                placeholder="work_contract, reservation_contract, contract_addendum…"
                disabled={isContractReadOnly}
              />
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
              <Label>
                {contractForm.documentRole === "attachment"
                  ? "Obsah plnění zakázky"
                  : "Text smlouvy"}
              </Label>
              <Textarea
                value={contractForm.mainContractContent}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    mainContractContent: e.target.value,
                  }));
                }}
                placeholder={
                  contractForm.documentRole === "attachment"
                    ? "Popište obsah plnění zakázky (lze použít proměnné jako u smlouvy)…"
                    : "Vložte text smlouvy..."
                }
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

            {contractForm.documentRole !== "attachment" ? (
              <>
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
              </>
            ) : null}

            <div className="space-y-2">
              <Label>
                {contractForm.documentRole === "attachment"
                  ? "Poznámka (volitelné)"
                  : "Doplňující informace"}
              </Label>
              <Textarea
                value={contractForm.additionalInfo}
                onChange={(e) => {
                  setIsContractDirty(true);
                  setContractForm((prev) => ({
                    ...prev,
                    additionalInfo: e.target.value,
                  }));
                }}
                placeholder={
                  contractForm.documentRole === "attachment"
                    ? "Interní nebo doplňující poznámka k příloze…"
                    : "Volitelné doplňující informace (můžete použít i proměnné)"
                }
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
                {isSavingContract ? "Ukládání..." : "Uložit dokument"}
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

      {measurementAnnotationEditorDialog}
    </div>
  );
}
