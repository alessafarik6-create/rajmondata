"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import type { User } from "firebase/auth";
import {
  useCollection,
  useDoc,
  useFirestore,
  useMemoFirebase,
} from "@/firebase";
import { getDocsSafe } from "@/lib/firestore-safe-query";
import { logActivitySafe } from "@/lib/activity-log";
import { notifyJobActivity } from "@/lib/job-activity-notify-client";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  uploadJobFolderImageBlobViaFirebaseSdk,
  uploadJobFolderImageFileViaFirebaseSdk,
} from "@/lib/job-photo-upload";
import {
  getPdfPageCountFromUrl,
  renderPdfPagesToPngBlobs,
} from "@/lib/pdf-to-image-client";
import {
  buildJobMediaCardDateLine,
  formatMediaDate,
  getJobMediaPreviewUrl,
  inferJobMediaItemType,
  isAllowedJobImageFile,
  isAllowedJobMediaFile,
  getJobMediaFileTypeFromFile,
  JOB_IMAGE_ACCEPT_ATTR,
  JOB_MEDIA_ACCEPT_ATTR,
  type JobFolderDoc,
  type JobFolderImageDoc,
  type JobFolderType,
  type JobMediaFirestorePath,
  type JobPhotoAnnotationTarget,
} from "@/lib/job-media-types";
import {
  filterFoldersForLimitedEmployee,
  canEmployeeUploadToFolder,
  isImageEmployeeVisible,
  type JobMemberPermissions,
} from "@/lib/job-employee-access";
import {
  filterFoldersForCustomer,
  isImageCustomerVisible,
  isLegacyPhotoCustomerVisible,
} from "@/lib/job-customer-access";
import { MediaApprovalRequestDialog } from "@/components/jobs/media-approval-request-dialog";
import { Badge } from "@/components/ui/badge";
import {
  approvalStatusLabelCs,
  parseJobMediaApproval,
  type JobMediaRef,
  type ParsedJobMediaApproval,
} from "@/lib/job-media-customer-approval";
import { Switch } from "@/components/ui/switch";
import {
  commitFolderAccountingExpense,
  commitFolderAccountingIncome,
  deleteFolderExpenseLinkedToImage,
  reverseFolderAccountingIncome,
} from "@/lib/job-folder-ledger";
import {
  computeExpenseAmountsFromInput,
  normalizeBudgetType,
  normalizeVatRate,
  roundMoney2,
  VAT_RATE_OPTIONS,
  type JobBudgetType,
  type VatRatePercent,
} from "@/lib/vat-calculations";
import type { JobExpenseFileType } from "@/lib/job-expense-types";
import { parseMoneyAmountInput } from "@/lib/work-contract-deposit";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildJobMediaMirrorNoteOnlyPatch,
  buildNewJobFolderImageMirrorDocument,
  buildNewJobLegacyPhotoMirrorDocument,
  companyDocumentRefForJobFolderImage,
  companyDocumentRefForJobLegacyPhoto,
} from "@/lib/job-linked-document-sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { JobEmailNotificationRecipientsPanel } from "@/components/jobs/job-email-notification-recipients-panel";
import { parseFolderEmailNotificationSettings } from "@/lib/job-notification-recipients";
import type { JobNotificationRecipient } from "@/lib/job-notification-recipients";
import {
  buildAdminRecipientCandidates,
  buildCustomerRecipientCandidates,
  buildEmployeeRecipientCandidates,
  mergeFolderRecipientsForVisibility,
  type UserRow,
} from "@/lib/job-notification-recipient-presets";
import { JobCommentsThread } from "@/components/jobs/job-comments-thread";
import { JobMediaExportNotesButtons } from "@/components/jobs/job-media-export-notes-buttons";
import { JobImportFilesFromJobDialog } from "@/components/jobs/job-import-files-from-job-dialog";
import {
  canJobMediaExportWithNotes,
  jobMediaNotesExportInputFromRow,
  pickFileCommentsForExport,
} from "@/lib/job-media-export-with-notes";
import {
  commentRowToMediaNoteLike,
  filterMediaNotesForCustomerView,
  mergeFileMediaNotesWithLegacyApprovalComment,
  parseJobMediaFileNoteDoc,
  pickMediaNotesForFile,
  sortMediaNotesChronologically,
  type JobMediaFileNoteDoc,
  type JobMediaFileNoteTarget,
} from "@/lib/job-media-file-notes";
import { JobMediaFileNotesPanel } from "@/components/jobs/job-media-file-notes-panel";
import {
  ExpandableNoteText,
  JobNoteMetaLine,
  JobNoteTextBlock,
} from "@/components/jobs/job-note-text-block";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Archive,
  Camera,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderPlus,
  Files,
  ImagePlus,
  Loader2,
  MessageSquare,
  Pencil,
  Trash2,
  Upload,
  UserCheck,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const MAX_BYTES = 20 * 1024 * 1024;

/** Mřížka náhledů — plná šířka, žádné úzké sloupce */
const JOB_MEDIA_CARD_GRID_CLASS =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

/** Kolik položek zobrazit před „Zobrazit více“ */
const JOB_MEDIA_INITIAL_COUNT = 6;

/** Seznamy médií se mají rozbalit naplno (bez vnitřního scrollu). */
const JOB_MEDIA_LIST_SCROLL_CLASS =
  "h-auto overflow-visible";

function folderTypeLabel(t: JobFolderType | undefined): string {
  switch (t ?? "files") {
    case "photos":
      return "Fotodokumentace";
    case "documents":
      return "Doklady / účetní";
    default:
      return "Obecné soubory";
  }
}

function todayIsoDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const jobMediaIconBtnClassName =
  "min-h-[38px] shrink-0 gap-1 rounded-md border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-accent [&_svg]:!size-[16px]";

function JobMediaIconButton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(jobMediaIconBtnClassName, className)}
          {...props}
        >
          {children}
          <span className="hidden md:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[220px] text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

type LegacyPhotoDoc = {
  id: string;
  fileName?: string;
  name?: string;
  fileType?: "image" | "pdf";
  imageUrl?: string;
  url?: string;
  downloadURL?: string;
  originalImageUrl?: string;
  annotatedImageUrl?: string;
  storagePath?: string;
  path?: string;
  fullPath?: string;
  annotationData?: unknown;
  note?: string;
  noteUpdatedAt?: unknown;
  noteUpdatedBy?: string;
  createdAt?: unknown;
  createdBy?: string;
};

function MediaThumb({
  row,
  alt,
}: {
  row: { id: string; fileName?: string; name?: string };
  alt?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = getJobMediaPreviewUrl(row as Parameters<typeof getJobMediaPreviewUrl>[0]);

  if (!src || broken) {
    return (
      <div className="flex aspect-[4/3] min-h-[240px] w-full items-center justify-center bg-muted px-2 text-center text-sm text-gray-700">
        {!src ? "Chybí náhled" : "Nelze načíst obrázek"}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || row.fileName || row.id}
      className="h-full w-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

/** Náhled + rychlé akce: trvale viditelná lišta akcí */
function ImageThumbWithQuickActions({
  children,
  busy,
  canManage,
  onPreview,
  onDelete,
}: {
  children: React.ReactNode;
  busy: boolean;
  canManage: boolean;
  onPreview: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/thumb relative aspect-[4/3] min-h-[240px] w-full overflow-hidden bg-muted">
      {children}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-[1] flex items-center justify-center gap-2",
          "bg-black/65 px-2 py-2"
        )}
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-9 gap-1 bg-white text-black shadow-md hover:bg-white/90"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
          aria-label="Zvětšit náhled"
        >
          <Eye className="h-4 w-4" aria-hidden />
          <span>Zobrazit</span>
        </Button>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-9 gap-1 shadow-md"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Smazat soubor"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            <span>Smazat</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Kompaktní řádek pro PDF / Office — místo vysoké karty */
function MediaCompactDocRow({
  icon,
  title,
  dateLine,
  actions,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  dateLine: string;
  actions: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900" title={title}>
            {title}
          </p>
          <p className="truncate text-xs text-gray-700">{dateLine}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div>
      </div>
      {footer ? (
        <div className="border-t border-border/40 pt-2">{footer}</div>
      ) : null}
    </div>
  );
}

function JobMediaPdfPreview() {
  return (
    <div
      className="flex aspect-[4/3] min-h-[240px] w-full flex-col items-center justify-center gap-2 bg-red-500/[0.07]"
      aria-hidden
    >
      <span className="text-3xl leading-none">📄</span>
      <FileText className="h-11 w-11 text-red-600 dark:text-red-400" strokeWidth={1.5} />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        PDF
      </span>
    </div>
  );
}

function JobMediaOfficePreview() {
  return (
    <div
      className="flex aspect-[4/3] min-h-[240px] w-full flex-col items-center justify-center gap-2 bg-blue-500/[0.07]"
      aria-hidden
    >
      <span className="text-3xl leading-none">📎</span>
      <FileText className="h-11 w-11 text-blue-700 dark:text-blue-400" strokeWidth={1.5} />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Office
      </span>
    </div>
  );
}

function JobMediaArchivePreview() {
  return (
    <div
      className="flex aspect-[4/3] min-h-[240px] w-full flex-col items-center justify-center gap-2 bg-amber-500/[0.08]"
      aria-hidden
    >
      <Archive className="h-12 w-12 text-amber-800 dark:text-amber-500" strokeWidth={1.5} />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Archiv
      </span>
    </div>
  );
}

function JobMediaCsvPreview() {
  return (
    <div
      className="flex aspect-[4/3] min-h-[240px] w-full flex-col items-center justify-center gap-2 bg-emerald-500/[0.08]"
      aria-hidden
    >
      <span className="text-3xl leading-none">📊</span>
      <FileText className="h-11 w-11 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CSV</span>
    </div>
  );
}

function JobMediaApprovalAdminSummary({
  a,
  onResend,
  resendLoading = false,
}: {
  a: ParsedJobMediaApproval;
  onResend?: () => void;
  resendLoading?: boolean;
}) {
  if (!a.requiresCustomerApproval) return null;
  const st = a.approvalStatus;
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border/50 bg-white px-2 py-2 sm:px-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="text-[10px] font-medium text-gray-800">
          Schválení zákazníkem
        </Badge>
        <Badge
          className={cn(
            "text-[10px] font-medium text-white",
            st === "approved" && "bg-emerald-600 hover:bg-emerald-600",
            st === "changes_requested" && "bg-amber-600 hover:bg-amber-600",
            st === "pending" && "bg-slate-600 hover:bg-slate-600"
          )}
        >
          {approvalStatusLabelCs(st)}
        </Badge>
      </div>
      {a.approvalNoteFromAdmin ? (
        <JobNoteTextBlock variant="admin_request" label="Poznámka k žádosti" dense>
          {a.approvalNoteFromAdmin}
        </JobNoteTextBlock>
      ) : null}
      {a.customerComment ? (
        <JobNoteTextBlock variant="customer" label="Připomínka zákazníka" dense>
          {a.customerComment}
        </JobNoteTextBlock>
      ) : null}
      {a.approvalRequestedAtMs ? (
        <JobNoteMetaLine>
          Žádost odeslána: {new Date(a.approvalRequestedAtMs).toLocaleString("cs-CZ")}
        </JobNoteMetaLine>
      ) : null}
      {a.approvalEmailSent ? (
        <JobNoteMetaLine>
          Upozornění zákazníkovi odesláno
          {a.approvalEmailSentAtMs
            ? `: ${new Date(a.approvalEmailSentAtMs).toLocaleString("cs-CZ")}`
            : ""}
        </JobNoteMetaLine>
      ) : null}
      {typeof onResend === "function" && a.approvalStatus === "pending" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[10px]"
          disabled={resendLoading}
          onClick={onResend}
        >
          {resendLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Odeslat upozornění znovu
        </Button>
      ) : null}
      {a.approvedAtMs ? (
        <JobNoteMetaLine>
          Schváleno zákazníkem: {new Date(a.approvedAtMs).toLocaleString("cs-CZ")}
        </JobNoteMetaLine>
      ) : null}
      {a.customerCommentAtMs && st === "changes_requested" ? (
        <JobNoteMetaLine>
          Připomínka odeslána: {new Date(a.customerCommentAtMs).toLocaleString("cs-CZ")}
        </JobNoteMetaLine>
      ) : null}
    </div>
  );
}

function JobMediaFileCard({
  borderClassName,
  preview,
  title,
  dateLine,
  note,
  hasNote,
  actions,
  mediaApprovalSummary,
  onResendApprovalEmail,
  resendApprovalBusy,
  extraFooter,
  customerNotesPreview,
  onOpenDrawingNotes,
  drawingNotesCount,
}: {
  borderClassName?: string;
  preview: React.ReactNode;
  title: string;
  dateLine: string;
  note?: string;
  hasNote: boolean;
  actions: React.ReactNode;
  /** Stav schválení u souboru (jen interní přehled). */
  mediaApprovalSummary?: ParsedJobMediaApproval | null;
  onResendApprovalEmail?: () => void;
  resendApprovalBusy?: boolean;
  /** Volitelný řádek nad lištou akcí (např. přepínač „ve výrobě“). */
  extraFooter?: React.ReactNode;
  customerNotesPreview?: string | null;
  onOpenDrawingNotes?: () => void;
  drawingNotesCount?: number;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        "transition-[box-shadow,border-color,transform] duration-200",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        borderClassName
      )}
    >
      <div className="relative w-full shrink-0 overflow-hidden bg-muted">
        {preview}
        {hasNote || (drawingNotesCount ?? 0) > 0 ? (
          <span
            className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-white"
            title="Má poznámku"
          >
            📝
            {(drawingNotesCount ?? 0) > 0 ? ` ${drawingNotesCount}` : ""}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 pt-2.5">
        <p
          className="truncate text-sm font-semibold leading-tight text-foreground sm:text-[15px]"
          title={title}
        >
          {title}
        </p>
        <p className="text-xs text-gray-700 sm:text-sm">{dateLine}</p>
        {mediaApprovalSummary?.requiresCustomerApproval ? (
          <JobMediaApprovalAdminSummary
            a={mediaApprovalSummary}
            onResend={onResendApprovalEmail}
            resendLoading={resendApprovalBusy}
          />
        ) : null}
        {note?.trim() ? (
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-medium text-gray-700 sm:text-sm">Interní poznámka</p>
            <ExpandableNoteText
              text={note.trim()}
              dense
              collapsedClassName="line-clamp-4"
            />
          </div>
        ) : null}
        {customerNotesPreview?.trim() ? (
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-medium text-gray-700 sm:text-sm">Poznámka k výkresu</p>
            <ExpandableNoteText
              text={customerNotesPreview.trim()}
              dense
              collapsedClassName="line-clamp-3"
            />
          </div>
        ) : null}
        {extraFooter ? (
          <div className="rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">{extraFooter}</div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-start gap-2 border-t border-border/45 pt-2">
          {onOpenDrawingNotes ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={onOpenDrawingNotes}
            >
              Poznámky{(drawingNotesCount ?? 0) > 0 ? ` (${drawingNotesCount})` : ""}
            </Button>
          ) : null}
          {actions}
        </div>
      </div>
    </div>
  );
}

function UserFolderBlock({
  folder,
  companyId,
  jobId,
  jobDisplayName,
  firestore,
  user,
  canManageFolders,
  onAnnotatePhoto,
  onNoteDialogOpen,
  layout = "default",
  mediaScope = "full",
  memberPermissions = null,
  employeeRecordId = null,
  onOpenMediaApprovalDialog,
  photoCommentDeepLink = null,
  onPhotoCommentDeepLinkConsumed,
  mediaNotesAll = [],
  onMediaNoteAdded,
  authorDisplayName = "Uživatel",
  emailPresets = null,
}: {
  folder: JobFolderDoc;
  companyId: string;
  jobId: string;
  jobDisplayName: string | null;
  firestore: Firestore;
  user: User;
  canManageFolders: boolean;
  onAnnotatePhoto: (t: JobPhotoAnnotationTarget) => void;
  onNoteDialogOpen: (ctx: {
    path: JobMediaFirestorePath;
    imageId: string;
    currentNote: string;
    fileNameHint: string;
  }) => void;
  layout?: "default" | "jobDetailWide";
  mediaScope?: "full" | "employeeLimited" | "customer";
  memberPermissions?: JobMemberPermissions | null;
  employeeRecordId?: string | null;
  onOpenMediaApprovalDialog?: (ctx: {
    target: JobMediaRef;
    fileLabel: string;
    row: Record<string, unknown>;
  }) => void;
  /** Otevře chat u souboru z deep linku (?photoComment=…) v této složce. */
  photoCommentDeepLink?: {
    folderId: string;
    fileId: string;
    fileName: string;
  } | null;
  onPhotoCommentDeepLinkConsumed?: () => void;
  mediaNotesAll?: JobMediaFileNoteDoc[];
  onMediaNoteAdded?: (note: JobMediaFileNoteDoc) => void;
  authorDisplayName?: string;
  emailPresets?: {
    employeeCandidates: JobNotificationRecipient[];
    customerCandidates: JobNotificationRecipient[];
  } | null;
}) {
  const { toast } = useToast();
  const folderEmailSettings = useMemo(
    () => parseFolderEmailNotificationSettings(folder as Record<string, unknown>),
    [folder]
  );
  const actorRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: actorProfile } = useDoc(actorRef);
  const [busy, setBusy] = useState(false);
  const [drawingNotesOpen, setDrawingNotesOpen] = useState(false);
  const [drawingNotesTarget, setDrawingNotesTarget] =
    useState<(JobMediaFileNoteTarget & { legacyRow?: Record<string, unknown> }) | null>(null);

  const [pdfConvertTarget, setPdfConvertTarget] = useState<{
    pdfDoc: JobFolderImageDoc;
    openUrl: string;
    title: string;
  } | null>(null);
  const [pdfConvertNumPages, setPdfConvertNumPages] = useState(0);
  const [pdfConvertMode, setPdfConvertMode] = useState<"all" | "single">("all");
  const [pdfConvertSinglePage, setPdfConvertSinglePage] = useState(1);
  const [pdfConvertBusy, setPdfConvertBusy] = useState(false);

  const folderType: JobFolderType = folder.type ?? "files";
  const isEmployeeLimited = mediaScope === "employeeLimited";
  const isCustomerScope = mediaScope === "customer";
  /** Mazání, poznámky, anotace v seznamu souborů — ne pro zákaznický portál. */
  const allowFolderStaffFileActions = !isEmployeeLimited && !isCustomerScope;

  const drawingNotesForTarget = useCallback(
    (fileId: string, fileRow?: Record<string, unknown>) => {
      const target: JobMediaFileNoteTarget = { fileId, folderId: folder.id };
      let picked = pickMediaNotesForFile(mediaNotesAll, target);
      if (fileRow) {
        picked = mergeFileMediaNotesWithLegacyApprovalComment(picked, fileRow, target);
      }
      if (!isCustomerScope) return picked;
      return filterMediaNotesForCustomerView(picked, user.uid);
    },
    [mediaNotesAll, folder.id, isCustomerScope, user.uid]
  );

  const openDrawingNotes = useCallback(
    (target: JobMediaFileNoteTarget & { legacyRow?: Record<string, unknown> }) => {
      setDrawingNotesTarget(target);
      setDrawingNotesOpen(true);
    },
    []
  );

  const openFolderMediaViewer = useCallback(
    (img: JobFolderImageDoc, openUrl: string, title: string) => {
      const kind = inferJobMediaItemType(img);
      if (kind === "office") {
        if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (kind === "image" || kind === "pdf") {
        onAnnotatePhoto({
          id: img.id,
          imageUrl: img.imageUrl,
          url: img.url,
          downloadURL: img.downloadURL,
          originalImageUrl: img.originalImageUrl,
          annotatedImageUrl: img.annotatedImageUrl,
          storagePath: img.storagePath,
          path: img.path,
          annotatedStoragePath: img.annotatedStoragePath,
          fileName: img.fileName,
          name: img.name,
          fileType: kind === "pdf" ? "pdf" : "image",
          annotationData: img.annotationData,
          annotationTarget: {
            kind: "folderImages",
            folderId: folder.id,
          },
        });
        return;
      }
    },
    [folder.id, onAnnotatePhoto]
  );
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const isAccountingFolder =
    folderType === "documents" && !isEmployeeLimited && !isCustomerScope;
  const showProductionToggle = allowFolderStaffFileActions && !isAccountingFolder;
  const [productionToggleBusyId, setProductionToggleBusyId] = useState<string | null>(null);
  const [folderPermBusy, setFolderPermBusy] = useState(false);

  const [accountingOpen, setAccountingOpen] = useState(false);
  const [accountingQueue, setAccountingQueue] = useState<File[]>([]);
  const [ledgerKind, setLedgerKind] = useState<"income" | "expense">("income");
  const [ledgerAmountInput, setLedgerAmountInput] = useState("");
  const [ledgerAmountType, setLedgerAmountType] = useState<"net" | "gross">(
    "net"
  );
  const [ledgerVatRate, setLedgerVatRate] = useState<string>("21");
  const [ledgerDate, setLedgerDate] = useState(todayIsoDate());
  const [ledgerSubmitting, setLedgerSubmitting] = useState(false);

  const imagesColRef = useMemoFirebase(
    () =>
      collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "folders",
        folder.id,
        "images"
      ),
    [firestore, companyId, jobId, folder.id]
  );
  const { data: imagesRaw } = useCollection<JobFolderImageDoc>(imagesColRef);

  const [fileChatOpen, setFileChatOpen] = useState(false);
  const [fileChatTarget, setFileChatTarget] = useState<{
    fileId: string;
    folderId: string;
    fileName: string;
  } | null>(null);

  const fileCommentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !jobId) return null;
    if (isCustomerScope) return null;
    const base = collection(firestore, "companies", companyId, "jobs", jobId, "comments");
    return query(
      base,
      where("targetType", "==", "file"),
      limit(400)
    );
  }, [firestore, companyId, jobId, isCustomerScope]);

  const { data: fileCommentsRaw = [] } = useCollection(fileCommentsQuery);

  const fileCommentStats = useMemo(() => {
    const uid = user?.uid || "";
    const m = new Map<string, { count: number; unread: number }>();
    const list = (Array.isArray(fileCommentsRaw) ? fileCommentsRaw : []) as Array<
      Record<string, unknown> & { id: string }
    >;
    for (const c of list) {
      const folderIdRaw = c.folderId;
      const folderId = folderIdRaw != null ? String(folderIdRaw).trim() : "";
      if (folderId !== folder.id) continue;
      const fid = String(c.fileId ?? "").trim();
      if (!fid) continue;
      const key = fid;
      const prev = m.get(key) ?? { count: 0, unread: 0 };
      prev.count += 1;
      const readBy = (c.readBy as unknown) as string[] | undefined;
      const readAtBy = c.readAtBy as Record<string, unknown> | undefined;
      const read =
        Boolean(uid) &&
        ((readAtBy && readAtBy[uid] != null) ||
          (Array.isArray(readBy) && readBy.includes(uid)));
      if (!read) prev.unread += 1;
      m.set(key, prev);
    }
    return m;
  }, [fileCommentsRaw, user?.uid, folder.id]);

  const hideJobMediaAdminUi = isCustomerScope || isEmployeeLimited;

  const fileCommentsList = (Array.isArray(fileCommentsRaw) ? fileCommentsRaw : []) as Array<
    Record<string, unknown> & { id: string }
  >;

  const renderExportNotesButtons = (img: JobFolderImageDoc, title: string) => {
    if (
      !canJobMediaExportWithNotes({
        mediaScope,
        hideJobMediaAdminUi,
        folder: folder as unknown as Record<string, unknown>,
        file: img as unknown as Record<string, unknown>,
      })
    ) {
      return null;
    }
    return (
      <JobMediaExportNotesButtons
        buildInput={() =>
          jobMediaNotesExportInputFromRow({
            row: img as unknown as Record<string, unknown>,
            fileName: title,
            jobLabel: jobDisplayName,
            comments: pickFileCommentsForExport(fileCommentsList, img.id, {
              folderId: folder.id,
            }),
            includeApproval: !isCustomerScope,
          })
        }
      />
    );
  };

  const images = useMemo(() => {
    const list = (imagesRaw ?? []) as JobFolderImageDoc[];
    return list
      .filter((x) => x && typeof x.id === "string")
      .slice()
      .sort((a, b) => {
        const ta =
          typeof (a.createdAt as { toMillis?: () => number })?.toMillis ===
          "function"
            ? (a.createdAt as { toMillis: () => number }).toMillis()
            : 0;
        const tb =
          typeof (b.createdAt as { toMillis?: () => number })?.toMillis ===
          "function"
            ? (b.createdAt as { toMillis: () => number }).toMillis()
            : 0;
        return tb - ta;
      });
  }, [imagesRaw]);

  const imagesForUi = useMemo(() => {
    let list = images;
    if (isEmployeeLimited) {
      list = list.filter((img) =>
        isImageEmployeeVisible(
          folder as Record<string, unknown>,
          img as Record<string, unknown>
        )
      );
    }
    if (isCustomerScope) {
      list = list.filter((img) =>
        isImageCustomerVisible(
          folder as Record<string, unknown>,
          img as Record<string, unknown>
        )
      );
    }
    return list;
  }, [images, isEmployeeLimited, isCustomerScope, folder]);

  const [folderOpen, setFolderOpen] = useState(false);
  const [showAllInFolder, setShowAllInFolder] = useState(false);

  const photoCommentDeepLinkHandledKey = useRef<string | null>(null);

  useEffect(() => {
    if (!photoCommentDeepLink) {
      photoCommentDeepLinkHandledKey.current = null;
      return;
    }
    if (!user?.uid) return;
    if (String(folder.id) !== String(photoCommentDeepLink.folderId)) return;
    const fid = String(photoCommentDeepLink.fileId || "").trim();
    if (!fid) return;
    const key = `${folder.id}:${fid}`;
    if (photoCommentDeepLinkHandledKey.current === key) return;
    if (imagesRaw === undefined) return;
    const hit = imagesForUi.find((img) => img.id === fid);
    if (!hit) return;
    photoCommentDeepLinkHandledKey.current = key;
    const titleFromRow = String(
      (hit as { fileName?: unknown; name?: unknown }).fileName ??
        (hit as { name?: unknown }).name ??
        ""
    ).trim();
    setFolderOpen(true);
    setFileChatTarget({
      fileId: fid,
      folderId: folder.id,
      fileName:
        String(photoCommentDeepLink.fileName || "").trim() || titleFromRow || "Soubor",
    });
    setFileChatOpen(true);
    onPhotoCommentDeepLinkConsumed?.();
  }, [
    photoCommentDeepLink,
    folder.id,
    imagesRaw,
    imagesForUi,
    user?.uid,
    onPhotoCommentDeepLinkConsumed,
  ]);

  const visibleFolderImages = useMemo(() => {
    if (showAllInFolder || imagesForUi.length <= JOB_MEDIA_INITIAL_COUNT) return imagesForUi;
    return imagesForUi.slice(0, JOB_MEDIA_INITIAL_COUNT);
  }, [imagesForUi, showAllInFolder]);

  const isFolderWide = layout === "jobDetailWide";
  const folderDocImages = useMemo(
    () =>
      visibleFolderImages.filter((img) => {
        const k = inferJobMediaItemType(img);
        return k === "pdf" || k === "office" || k === "csv";
      }),
    [visibleFolderImages]
  );

  useEffect(() => {
    if (!firestore || !companyId || !jobId || !user?.uid) return;
    if (isEmployeeLimited) return;
    if (isCustomerScope) return;
    let cancelled = false;
    const jn = jobDisplayName ?? null;
    void (async () => {
      for (const img of images) {
        if (cancelled) return;
        if (!img?.id) continue;
        const mirrorRef = companyDocumentRefForJobFolderImage(
          firestore,
          companyId,
          folder.id,
          img.id
        );
        const snap = await getDoc(mirrorRef);
        if (cancelled) return;
        if (!snap.exists()) {
          const preview = getJobMediaPreviewUrl(img);
          await setDoc(
            mirrorRef,
            buildNewJobFolderImageMirrorDocument({
              companyId,
              jobId,
              jobDisplayName: jn,
              folderId: folder.id,
              imageId: img.id,
              userId:
                typeof img.createdBy === "string" && img.createdBy
                  ? img.createdBy
                  : user.uid,
              fileName: img.fileName || img.name || img.id,
              fileType: inferJobMediaItemType(img),
              mimeType: null,
              fileUrl: preview,
              storagePath:
                (typeof img.storagePath === "string" && img.storagePath) ||
                (typeof img.path === "string" && img.path) ||
                null,
              note: typeof img.note === "string" ? img.note : null,
            }),
            { merge: true }
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    images,
    firestore,
    companyId,
    jobId,
    folder.id,
    user?.uid,
    jobDisplayName,
    isEmployeeLimited,
    isCustomerScope,
  ]);

  const showFolderUpload =
    !isCustomerScope &&
    !isAccountingFolder &&
    (isEmployeeLimited
      ? canEmployeeUploadToFolder(
          folder as Record<string, unknown> & { id: string },
          memberPermissions
        )
      : canManageFolders);

  const persistFolderEmailNotifications = async (
    enabled: boolean,
    recipients: JobNotificationRecipient[]
  ) => {
    if (!firestore || folderPermBusy) return;
    setFolderPermBusy(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "jobs", jobId, "folders", folder.id),
        {
          emailNotificationsEnabled: enabled,
          notificationRecipients: recipients,
        }
      );
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nastavení notifikací se nepodařilo uložit.",
      });
    } finally {
      setFolderPermBusy(false);
    }
  };

  const persistFolderEmployeeFlags = async (patch: {
    employeeVisible: boolean;
    allowEmployeeUpload: boolean;
    employeeCanEdit: boolean;
  }) => {
    if (!firestore || folderPermBusy) return;
    setFolderPermBusy(true);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id
        ),
        {
          employeeVisible: patch.employeeVisible,
          allowEmployeeUpload: patch.allowEmployeeUpload,
          employeeCanEdit: patch.employeeCanEdit,
          employeeUploadAllowed: patch.allowEmployeeUpload,
          ...(emailPresets
            ? {
                notificationRecipients: mergeFolderRecipientsForVisibility(
                  folderEmailSettings.recipients,
                  {
                    employeeVisible: patch.employeeVisible,
                    customerVisible: folder.customerVisible === true,
                    internalOnly: folder.internalOnly === true,
                    employeeCandidates: emailPresets.employeeCandidates,
                    customerCandidates: emailPresets.customerCandidates,
                  }
                ),
              }
            : {}),
        }
      );
      if (patch.employeeVisible) {
        toast({
          title: "Složka je viditelná pro zaměstnance",
          description: folder.name || folder.id,
        });
      } else {
        toast({
          title: "Složka je pouze interní",
          description: "Zaměstnanci ji v portálu neuvidí.",
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Oprávnění složky se nepodařilo uložit.",
      });
    } finally {
      setFolderPermBusy(false);
    }
  };

  const persistFolderCustomerFlags = async (patch: {
    customerVisible: boolean;
    customerAnnotatable: boolean;
    internalOnly: boolean;
  }) => {
    if (!firestore || folderPermBusy) return;
    setFolderPermBusy(true);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id
        ),
        {
          customerVisible: patch.customerVisible,
          customerAnnotatable: patch.customerAnnotatable,
          internalOnly: patch.internalOnly,
          ...(emailPresets
            ? {
                notificationRecipients: mergeFolderRecipientsForVisibility(
                  folderEmailSettings.recipients,
                  {
                    employeeVisible: folder.employeeVisible === true,
                    customerVisible: patch.customerVisible,
                    internalOnly: patch.internalOnly,
                    employeeCandidates: emailPresets.employeeCandidates,
                    customerCandidates: emailPresets.customerCandidates,
                  }
                ),
              }
            : {}),
        }
      );
      toast({
        title: "Nastavení pro zákazníka uloženo",
        description: folder.name || folder.id,
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Oprávnění pro klientský portál se nepodařilo uložit.",
      });
    } finally {
      setFolderPermBusy(false);
    }
  };

  const uploadOne = async (
    file: File,
    ledger?: {
      kind: "income" | "expense";
      amountInput: number;
      amountType: JobBudgetType;
      vatRate: VatRatePercent;
      date: string;
    },
    opts?: { skipNotify?: boolean }
  ): Promise<string | undefined> => {
    if (!isAllowedJobMediaFile(file)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný formát",
        description:
          "Pouze JPG, PNG, WEBP, PDF, CSV, Office (DOC, XLS…) nebo archiv (ZIP, RAR, 7z).",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        variant: "destructive",
        title: "Soubor je příliš velký",
        description: "Maximální velikost je 20 MB.",
      });
      return;
    }
    if (isAccountingFolder && !ledger) {
      toast({
        variant: "destructive",
        title: "Chybí údaje dokladu",
        description: "Vyplňte typ dokladu a částku.",
      });
      return;
    }
    if (isEmployeeLimited) {
      if (
        !canEmployeeUploadToFolder(
          folder as Record<string, unknown> & { id: string },
          memberPermissions
        )
      ) {
        toast({
          variant: "destructive",
          title: "Nahrávání není povoleno",
          description: "Do této složky nemáte oprávnění nahrávat soubory.",
        });
        return;
      }
      if (!employeeRecordId?.trim()) {
        toast({
          variant: "destructive",
          title: "Nelze nahrát soubor",
          description: "Chybí vazba na profil zaměstnance.",
        });
        return;
      }
    }

    const safeBaseName =
      file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
    const fileType = getJobMediaFileTypeFromFile(file);
    if (isAccountingFolder && (fileType === "csv" || fileType === "archive")) {
      toast({
        variant: "destructive",
        title: "Tento typ do účetní složky nelze",
        description:
          "Archivy a CSV ukládejte do složky Dokumenty nebo Soubory. Účetní složka slouží k fakturám a dokladům.",
      });
      return;
    }

    const uploadAuditBase = {
      fileSizeBytes: file.size,
      mimeType: file.type?.trim() || null,
      uploadedBy: user.uid,
      uploadedByName: authorDisplayName?.trim() || "Uživatel",
      uploadedAt: serverTimestamp(),
    };

    try {
      const { resolvedFullPath, downloadURL } =
        await uploadJobFolderImageFileViaFirebaseSdk(
          file,
          companyId,
          jobId,
          folder.id
        );

      const refDoc = doc(imagesColRef);

    if (isAccountingFolder && ledger) {
      const vatRate = normalizeVatRate(ledger.vatRate);
      const amts = computeExpenseAmountsFromInput({
        amountInput: roundMoney2(ledger.amountInput),
        amountType: ledger.amountType,
        vatRate,
      });

      if (ledger.kind === "income") {
        const { financeId } = await commitFolderAccountingIncome({
          firestore,
          companyId,
          jobId,
          jobDisplayName,
          userId: user.uid,
          imageId: refDoc.id,
          fileName: safeBaseName,
          fileUrl: downloadURL,
          date: ledger.date,
          amountInput: ledger.amountInput,
          amountType: ledger.amountType,
          vatRate,
        });
        await setDoc(refDoc, {
          id: refDoc.id,
          companyId,
          jobId,
          folderId: folder.id,
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
          ledgerKind: "income",
          ledgerDate: ledger.date,
          ledgerAmountNet: amts.amountNet,
          ledgerAmountGross: amts.amountGross,
          ledgerFinanceId: financeId,
          visibleInProduction: false,
        });
      } else {
        const expenseFt: JobExpenseFileType =
          fileType === "image" || fileType === "pdf" ? fileType : "office";
        const { expenseId, financeId } = await commitFolderAccountingExpense({
          firestore,
          companyId,
          jobId,
          jobDisplayName,
          userId: user.uid,
          imageId: refDoc.id,
          folderId: folder.id,
          fileName: safeBaseName,
          fileUrl: downloadURL,
          date: ledger.date,
          amountInput: ledger.amountInput,
          amountType: ledger.amountType,
          vatRate,
          fileType: expenseFt,
          storagePath: resolvedFullPath,
          mimeType: file.type?.trim() || null,
        });
        await setDoc(refDoc, {
          id: refDoc.id,
          companyId,
          jobId,
          folderId: folder.id,
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
          ledgerKind: "expense",
          ledgerExpenseId: expenseId,
          ledgerFinanceId: financeId,
          ledgerDate: ledger.date,
          ledgerAmountNet: amts.amountNet,
          ledgerAmountGross: amts.amountGross,
          visibleInProduction: false,
        });
      }
    } else {
      await setDoc(refDoc, {
        id: refDoc.id,
        companyId,
        jobId,
        folderId: folder.id,
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
        visibleInProduction: false,
        ...uploadAuditBase,
        ...(isEmployeeLimited
          ? {
              uploadSource: "employee-job-upload" as const,
              uploadedByEmployeeId: employeeRecordId,
              employeeVisible: true,
            }
          : {}),
      });
    }

    if (!isEmployeeLimited) {
      await setDoc(
        companyDocumentRefForJobFolderImage(
          firestore,
          companyId,
          folder.id,
          refDoc.id
        ),
        buildNewJobFolderImageMirrorDocument({
          companyId,
          jobId,
          jobDisplayName,
          folderId: folder.id,
          imageId: refDoc.id,
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
    }

    logActivitySafe(firestore, companyId, user, actorProfile, {
      actionType: "document.upload",
      actionLabel: isAccountingFolder
        ? "Nahrání dokladu do účetní složky zakázky"
        : isEmployeeLimited
          ? "Nahrání souboru zaměstnancem do složky zakázky"
          : "Nahrání souboru do složky zakázky",
      entityType: "job_folder_image",
      entityId: refDoc.id,
      entityName: safeBaseName,
      details: `Složka: ${folder.name || folder.id}`,
      sourceModule: "jobs",
      route: `/portal/jobs/${jobId}`,
      metadata: {
        jobId,
        folderId: folder.id,
        fileName: safeBaseName,
        fileType,
        mimeType: file.type?.trim() || null,
        ledgerKind: ledger?.kind ?? null,
        uploadSource: isEmployeeLimited ? "employee-job-upload" : null,
        uploadedByEmployeeId: isEmployeeLimited ? employeeRecordId : null,
      },
    });

      toast({
        title: isEmployeeLimited ? "Soubor byl nahrán" : "Soubor uložen",
        description: safeBaseName,
      });
      if (!opts?.skipNotify && user) {
        void user.getIdToken().then((token) =>
          notifyJobActivity({
            idToken: token,
            companyId,
            jobId,
            eventType: "file_upload",
            folderId: folder.id,
            folderName: folder.name ?? null,
            fileId: refDoc.id,
            fileName: safeBaseName,
            entityId: refDoc.id,
          })
        );
      }
      return safeBaseName;
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === "string"
          ? String((err as { code: string }).code)
          : "";
      const msg = err instanceof Error ? err.message : "Nahrání se nezdařilo.";
      const isDenied =
        code.includes("permission") ||
        code.includes("unauthorized") ||
        code.includes("unauthenticated") ||
        /permission denied/i.test(msg);
      toast({
        variant: "destructive",
        title: "Nahrání selhalo",
        description: isDenied ? `permission denied: ${msg}` : msg,
      });
      throw err;
    }
  };

  const openAccountingForFiles = (files: File[]) => {
    if (!files.length) return;
    if (!canManageFolders) {
      toast({
        variant: "destructive",
        title: "Nemáte oprávnění",
        description: "Do účetní složky mohou nahrávat jen správci a účetní.",
      });
      return;
    }
    setLedgerKind("income");
    setLedgerAmountInput("");
    setLedgerAmountType("net");
    setLedgerVatRate("21");
    setLedgerDate(todayIsoDate());
    setAccountingQueue(files);
    setAccountingOpen(true);
  };

  const submitAccountingDialog = async () => {
    const file = accountingQueue[0];
    if (!file) {
      setAccountingOpen(false);
      return;
    }
    const amountKc = parseMoneyAmountInput(
      ledgerAmountInput.replace(/\s/g, " ").trim()
    );
    if (amountKc == null || amountKc <= 0) {
      toast({
        variant: "destructive",
        title: "Částka",
        description: "Zadejte platnou částku větší než 0.",
      });
      return;
    }
    if (!ledgerDate.trim()) {
      toast({
        variant: "destructive",
        title: "Datum",
        description: "Vyplňte datum dokladu.",
      });
      return;
    }
    const vatRate = normalizeVatRate(Number(ledgerVatRate));
    const amountTypeResolved = normalizeBudgetType(ledgerAmountType);
    setLedgerSubmitting(true);
    try {
      await uploadOne(file, {
        kind: ledgerKind,
        amountInput: amountKc,
        amountType: amountTypeResolved,
        vatRate,
        date: ledgerDate.trim(),
      });
      setAccountingQueue((q) => {
        const next = q.slice(1);
        if (next.length === 0) {
          setAccountingOpen(false);
        } else {
          setLedgerAmountInput("");
          setLedgerAmountType("net");
          setLedgerVatRate("21");
          setLedgerDate(todayIsoDate());
        }
        return next;
      });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Účetní zápis se nepodařil",
        description:
          err instanceof Error ? err.message : "Zkuste to prosím znovu.",
      });
    } finally {
      setLedgerSubmitting(false);
    }
  };

  const deleteImage = async (img: JobFolderImageDoc) => {
    if (isCustomerScope) {
      toast({
        variant: "destructive",
        title: "Nepovolená akce",
        description: "Zákazník nemůže mazat soubory zakázky.",
      });
      return;
    }
    if (
      !window.confirm(
        `Smazat soubor „${img.fileName || img.id}“? Tato akce je nevratná.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      if (img.ledgerKind === "income") {
        await reverseFolderAccountingIncome({
          firestore,
          companyId,
          jobId,
          imageId: img.id,
        });
      } else if (
        img.ledgerKind === "expense" &&
        typeof img.ledgerExpenseId === "string" &&
        img.ledgerExpenseId
      ) {
        await deleteFolderExpenseLinkedToImage({
          firestore,
          companyId,
          jobId,
          expenseId: img.ledgerExpenseId,
          financeId:
            typeof img.ledgerFinanceId === "string" && img.ledgerFinanceId
              ? img.ledgerFinanceId
              : null,
        });
      }
      const sp =
        (typeof img.storagePath === "string" && img.storagePath) ||
        (typeof img.path === "string" && img.path) ||
        "";
      if (sp) {
        try {
          await deleteObject(ref(getFirebaseStorage(), sp));
        } catch {
          /* může být již smazáno */
        }
      }
      if (img.annotatedStoragePath) {
        try {
          await deleteObject(ref(getFirebaseStorage(), img.annotatedStoragePath));
        } catch {
          /* ignore */
        }
      }
      const batch = writeBatch(firestore);
      batch.delete(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id,
          "images",
          img.id
        )
      );
      batch.delete(
        companyDocumentRefForJobFolderImage(
          firestore,
          companyId,
          folder.id,
          img.id
        )
      );
      await batch.commit();
      logActivitySafe(firestore, companyId, user, actorProfile, {
        actionType: "document.delete",
        actionLabel: "Smazání souboru ve složce zakázky",
        entityType: "job_folder_image",
        entityId: img.id,
        entityName: img.fileName || img.name || img.id,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: {
          jobId,
          folderId: folder.id,
          fileName: img.fileName || img.name,
        },
      });
      toast({ title: "Soubor smazán" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Soubor se nepodařilo smazat.",
      });
    } finally {
      setBusy(false);
    }
  };

  const setFileVisibleInProduction = async (img: JobFolderImageDoc, value: boolean) => {
    if (!showProductionToggle) return;
    setProductionToggleBusyId(img.id);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id,
          "images",
          img.id
        ),
        {
          visibleInProduction: value,
          visibleInProductionUpdatedAt: serverTimestamp(),
        }
      );
      toast({
        title: value ? "Soubor se zobrazí ve výrobě" : "Soubor se ve výrobě nezobrazuje",
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setProductionToggleBusyId(null);
    }
  };

  const productionFooter = (img: JobFolderImageDoc) =>
    showProductionToggle ? (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Modul Výroba</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-foreground/90">Zobrazit ve výrobě</span>
          <Switch
            checked={img.visibleInProduction === true}
            disabled={busy || productionToggleBusyId === img.id}
            onCheckedChange={(v) => void setFileVisibleInProduction(img, v)}
          />
        </div>
      </div>
    ) : null;

  useEffect(() => {
    if (!pdfConvertTarget?.openUrl) {
      setPdfConvertNumPages(0);
      return;
    }
    let cancelled = false;
    setPdfConvertNumPages(0);
    void (async () => {
      try {
        const n = await getPdfPageCountFromUrl(pdfConvertTarget.openUrl);
        if (!cancelled) {
          setPdfConvertNumPages(n);
          setPdfConvertSinglePage(1);
        }
      } catch (e) {
        console.error(e);
        toast({
          variant: "destructive",
          title: "PDF",
          description: "Nelze načíst dokument (síť nebo oprávnění k souboru).",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfConvertTarget?.openUrl, toast]);

  const runPdfToImageConversion = async () => {
    if (!pdfConvertTarget || !firestore || !user) return;
    const { pdfDoc, openUrl, title } = pdfConvertTarget;
    const num = pdfConvertNumPages;
    if (num < 1) {
      toast({
        variant: "destructive",
        title: "Čekejte",
        description: "Počet stránek se ještě načítá.",
      });
      return;
    }
    const pages =
      pdfConvertMode === "all"
        ? Array.from({ length: num }, (_, i) => i + 1)
        : [Math.min(Math.max(1, pdfConvertSinglePage), num)];
    setPdfConvertBusy(true);
    try {
      const blobs = await renderPdfPagesToPngBlobs(openUrl, pages, 2);
      const baseStem =
        title.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim() || "dokument";
      const convertedNames: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        const pageNum = pages[i] ?? i + 1;
        const blob = blobs[i];
        const outFileName = `${baseStem}-strana-${pageNum}.png`;
        const { downloadURL, storagePath: resolvedFullPath } =
          await uploadJobFolderImageBlobViaFirebaseSdk(
            blob,
            companyId,
            jobId,
            folder.id,
            `${Date.now()}-${outFileName}`
          );
        const refDoc = doc(imagesColRef);
        const displayName = outFileName;
        convertedNames.push(displayName);
        await setDoc(refDoc, {
          id: refDoc.id,
          companyId,
          jobId,
          folderId: folder.id,
          imageUrl: downloadURL,
          url: downloadURL,
          originalImageUrl: downloadURL,
          downloadURL,
          fileType: "image" as const,
          storagePath: resolvedFullPath,
          path: resolvedFullPath,
          fileName: displayName,
          name: displayName,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          sourcePdfId: pdfDoc.id,
          sourcePdfName: title,
          sourcePdfUrl: openUrl,
          sourcePdfPageNumber: pageNum,
          ...(isEmployeeLimited
            ? {
                uploadSource: "employee-job-upload" as const,
                uploadedByEmployeeId: employeeRecordId,
                uploadedBy: user.uid,
                uploadedAt: serverTimestamp(),
                employeeVisible: true,
              }
            : {}),
        });
        if (!isEmployeeLimited) {
          await setDoc(
            companyDocumentRefForJobFolderImage(
              firestore,
              companyId,
              folder.id,
              refDoc.id
            ),
            buildNewJobFolderImageMirrorDocument({
              companyId,
              jobId,
              jobDisplayName,
              folderId: folder.id,
              imageId: refDoc.id,
              userId: user.uid,
              fileName: displayName,
              fileType: "image",
              mimeType: "image/png",
              fileUrl: downloadURL,
              storagePath: resolvedFullPath,
              note: null,
            }),
            { merge: true }
          );
        }
        logActivitySafe(firestore, companyId, user, actorProfile, {
          actionType: "document.upload",
          actionLabel: "Převod PDF na obrázek ve složce zakázky",
          entityType: "job_folder_image",
          entityId: refDoc.id,
          entityName: displayName,
          details: `Ze souboru ${title} (str. ${pageNum})`,
          sourceModule: "jobs",
          route: `/portal/jobs/${jobId}`,
          metadata: {
            jobId,
            folderId: folder.id,
            fileName: displayName,
            fileType: "image",
            sourcePdfId: pdfDoc.id,
          },
        });
      }
      toast({
        title: "Převod dokončen",
        description:
          blobs.length === 1
            ? "Obrázek je ve složce fotodokumentace."
            : `Vytvořeno ${blobs.length} obrázků.`,
      });
      if (convertedNames.length && user) {
        const token = await user.getIdToken();
        void notifyJobActivity({
          idToken: token,
          companyId,
          jobId,
          eventType: "file_upload",
          folderId: folder.id,
          folderName: folder.name ?? null,
          batchFileNames: convertedNames,
          entityId: `${folder.id}:pdf:${convertedNames.join(",")}`,
        });
      }
      setPdfConvertTarget(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Převod se nepodařil",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPdfConvertBusy(false);
    }
  };

  const deleteFolder = async () => {
    if (isCustomerScope) {
      toast({
        variant: "destructive",
        title: "Nepovolená akce",
        description: "Zákazník nemůže mazat složky ani soubory.",
      });
      return;
    }
    if (
      !window.confirm(
        `Smazat složku „${folder.name || folder.id}“ včetně všech souborů?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { snapshot, isIndexPending } = await getDocsSafe(
        imagesColRef,
        "job-media deleteFolder",
        `companies/${companyId}/jobs/${jobId}/folders/${folder.id}/images`
      );
      if (isIndexPending || !snapshot) {
        toast({
          variant: "destructive",
          title: "Data se připravují",
          description:
            "Nelze načíst soubory ve složce (index databáze). Zkuste to za chvíli znovu.",
        });
        return;
      }
      const removedFileCount = snapshot.docs.length;
      for (const d of snapshot.docs) {
        const data = d.data() as JobFolderImageDoc;
        if (data.ledgerKind === "income") {
          await reverseFolderAccountingIncome({
            firestore,
            companyId,
            jobId,
            imageId: d.id,
          });
        } else if (
          data.ledgerKind === "expense" &&
          typeof data.ledgerExpenseId === "string" &&
          data.ledgerExpenseId
        ) {
          await deleteFolderExpenseLinkedToImage({
            firestore,
            companyId,
            jobId,
            expenseId: data.ledgerExpenseId,
            financeId:
              typeof data.ledgerFinanceId === "string" && data.ledgerFinanceId
                ? data.ledgerFinanceId
                : null,
          });
        }
        const sp =
          (typeof data.storagePath === "string" && data.storagePath) ||
          (typeof data.path === "string" && data.path) ||
          "";
        if (sp) {
          try {
            await deleteObject(ref(getFirebaseStorage(), sp));
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
              folder.id,
              d.id
            )
          );
        } catch {
          /* */
        }
        await deleteDoc(d.ref);
      }
      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders",
          folder.id
        )
      );
      logActivitySafe(firestore, companyId, user, actorProfile, {
        actionType: "job.folder_delete",
        actionLabel: "Smazání složky médií zakázky",
        entityType: "job_folder",
        entityId: folder.id,
        entityName: folder.name || folder.id,
        details: `Odstraněno souborů: ${removedFileCount}`,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: { jobId, folderId: folder.id, removedFileCount },
      });
      toast({ title: "Složka byla odstraněna" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Složku se nepodařilo smazat.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={accountingOpen}
        onOpenChange={(o) => {
          setAccountingOpen(o);
          if (!o) setAccountingQueue([]);
        }}
      >
        <DialogContent className="max-w-md text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Účetní doklad</DialogTitle>
            <DialogDescription className="text-gray-800">
              {accountingQueue[0]
                ? `Soubor: ${accountingQueue[0].name}${
                    accountingQueue.length > 1
                      ? ` (${accountingQueue.length} celkem ve frontě)`
                      : ""
                  }`
                : "Vyberte soubor a vyplňte částku."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-gray-900">Typ dokladu</Label>
              <Select
                value={ledgerKind}
                onValueChange={(v) =>
                  setLedgerKind(v === "expense" ? "expense" : "income")
                }
              >
                <SelectTrigger className="min-h-[44px] bg-background text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Příjem (faktura / záloha)</SelectItem>
                  <SelectItem value="expense">Náklad</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-900">Částka (Kč)</Label>
              <Input
                value={ledgerAmountInput}
                onChange={(e) => setLedgerAmountInput(e.target.value)}
                placeholder="např. 12 500"
                className="min-h-[44px] bg-background text-gray-900"
                inputMode="decimal"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-gray-900">Bez / s DPH</Label>
                <Select
                  value={ledgerAmountType}
                  onValueChange={(v) =>
                    setLedgerAmountType(v === "gross" ? "gross" : "net")
                  }
                >
                  <SelectTrigger className="min-h-[44px] bg-background text-gray-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="net">Bez DPH</SelectItem>
                    <SelectItem value="gross">S DPH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-900">Sazba DPH</Label>
                <Select
                  value={ledgerVatRate}
                  onValueChange={setLedgerVatRate}
                >
                  <SelectTrigger className="min-h-[44px] bg-background text-gray-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_RATE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-900">Datum dokladu</Label>
              <Input
                type="date"
                value={ledgerDate}
                onChange={(e) => setLedgerDate(e.target.value)}
                className="min-h-[44px] bg-background text-gray-900"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={ledgerSubmitting}
              onClick={() => {
                setAccountingOpen(false);
                setAccountingQueue([]);
              }}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={ledgerSubmitting || !accountingQueue[0]}
              onClick={() => void submitAccountingDialog()}
            >
              {ledgerSubmitting ? "Ukládám…" : "Nahrát a zaúčtovat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fileChatOpen} onOpenChange={setFileChatOpen}>
        <DialogContent
          className="w-[95vw] max-w-[680px] border border-border bg-background text-foreground shadow-2xl sm:rounded-xl sm:p-6 max-h-[80vh] overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>Poznámky k souboru</DialogTitle>
            <DialogDescription>
              Chat zůstává uložený u daného souboru. Zprávy vidí zaměstnanec i administrátor.
            </DialogDescription>
          </DialogHeader>
          {fileChatTarget ? (
            <JobCommentsThread
              firestore={firestore}
              companyId={companyId}
              jobId={jobId}
              userId={user.uid}
              authorName={
                String(
                  (actorProfile as { displayName?: unknown; name?: unknown })?.displayName ??
                    (actorProfile as { name?: unknown })?.name ??
                    user.email ??
                    ""
                ).trim() || "Uživatel"
              }
              authorRole={isEmployeeLimited ? "employee" : "admin"}
              canPost={true}
              title={fileChatTarget.fileName || "Soubor"}
              target={{
                targetType: "file",
                fileId: fileChatTarget.fileId,
                folderId: fileChatTarget.folderId,
                fileName: fileChatTarget.fileName,
              }}
              dense
              onAfterSend={async (sent) => {
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
                      jobId,
                      targetType: "file",
                      fileId: fileChatTarget.fileId,
                      folderId: fileChatTarget.folderId,
                      fileName: fileChatTarget.fileName,
                      messagePreview: sent.message,
                    }),
                  });
                } catch {
                  // ignore
                }
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

    <Collapsible open={folderOpen} onOpenChange={setFolderOpen}>
      <Card className="border-border/60 bg-surface">
        <CardHeader className="space-y-3 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 text-left hover:bg-muted/60"
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    folderOpen && "rotate-180"
                  )}
                  aria-hidden
                />
                <span className="truncate text-base font-semibold text-gray-900">
                  {folder.name || "Bez názvu"}
                </span>
                <span
                  className="shrink-0 rounded-full border border-border/80 bg-background px-2 py-0.5 text-xs font-medium text-gray-900"
                  title="Typ složky"
                >
                  {folderTypeLabel(folderType)}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {imagesForUi.length}
                </span>
              </button>
            </CollapsibleTrigger>
            <div className="flex flex-wrap gap-2">
              {canManageFolders && !isEmployeeLimited ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="min-h-[40px] min-w-[44px]"
                  disabled={busy}
                  onClick={() => void deleteFolder()}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="ml-1 hidden sm:inline">Složku</span>
                </Button>
              ) : null}
            </div>
          </div>
          {canManageFolders && !isEmployeeLimited ? (
            <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Přístup zaměstnanců k této složce
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`emp-vis-${folder.id}`}
                    checked={folder.employeeVisible === true}
                    disabled={folderPermBusy}
                    onCheckedChange={(v) =>
                      void persistFolderEmployeeFlags({
                        employeeVisible: v,
                        allowEmployeeUpload: v
                          ? ((folder as { allowEmployeeUpload?: unknown }).allowEmployeeUpload === true ||
                              (folder as { employeeUploadAllowed?: unknown }).employeeUploadAllowed === true)
                          : false,
                        employeeCanEdit: v ? folder.employeeCanEdit === true : false,
                      })
                    }
                  />
                  <Label
                    htmlFor={`emp-vis-${folder.id}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    Viditelné zaměstnanci
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`emp-up-${folder.id}`}
                    checked={
                      (folder as { allowEmployeeUpload?: unknown }).allowEmployeeUpload === true ||
                      (folder as { employeeUploadAllowed?: unknown }).employeeUploadAllowed === true
                    }
                    disabled={
                      folderPermBusy || folder.employeeVisible !== true
                    }
                    onCheckedChange={(v) =>
                      void persistFolderEmployeeFlags({
                        employeeVisible: folder.employeeVisible === true,
                        allowEmployeeUpload: v,
                        employeeCanEdit: folder.employeeCanEdit === true,
                      })
                    }
                  />
                  <Label
                    htmlFor={`emp-up-${folder.id}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    Zaměstnanec může nahrávat
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`emp-edit-${folder.id}`}
                    checked={folder.employeeCanEdit === true}
                    disabled={folderPermBusy || folder.employeeVisible !== true}
                    onCheckedChange={(v) =>
                      void persistFolderEmployeeFlags({
                        employeeVisible: folder.employeeVisible === true,
                        allowEmployeeUpload:
                          (folder as { allowEmployeeUpload?: unknown }).allowEmployeeUpload === true ||
                          (folder as { employeeUploadAllowed?: unknown }).employeeUploadAllowed === true,
                        employeeCanEdit: v,
                      })
                    }
                  />
                  <Label
                    htmlFor={`emp-edit-${folder.id}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    Zaměstnanec může upravovat
                  </Label>
                </div>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Bez zaškrtnutí „Viditelné zaměstnanci“ je složka jen pro interní přístup
                (výchozí u starších dat).
              </p>
            </div>
          ) : null}
          {canManageFolders && !isEmployeeLimited && !isCustomerScope ? (
            <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/20 p-3 mt-2">
              <p className="text-xs font-medium text-muted-foreground">
                Klientský portál (zákazník)
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`cust-vis-${folder.id}`}
                    checked={folder.customerVisible === true}
                    disabled={folderPermBusy || folder.internalOnly === true}
                    onCheckedChange={(v) =>
                      void persistFolderCustomerFlags({
                        customerVisible: v,
                        customerAnnotatable: v ? folder.customerAnnotatable === true : false,
                        internalOnly: folder.internalOnly === true,
                      })
                    }
                  />
                  <Label htmlFor={`cust-vis-${folder.id}`} className="cursor-pointer text-sm font-normal">
                    Viditelné zákazníkovi
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`cust-ann-${folder.id}`}
                    checked={folder.customerAnnotatable === true}
                    disabled={
                      folderPermBusy || folder.customerVisible !== true || folder.internalOnly === true
                    }
                    onCheckedChange={(v) =>
                      void persistFolderCustomerFlags({
                        customerVisible: folder.customerVisible === true,
                        customerAnnotatable: v,
                        internalOnly: folder.internalOnly === true,
                      })
                    }
                  />
                  <Label htmlFor={`cust-ann-${folder.id}`} className="cursor-pointer text-sm font-normal">
                    Zákazník může anotovat
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`cust-int-${folder.id}`}
                    checked={folder.internalOnly === true}
                    disabled={folderPermBusy}
                    onCheckedChange={(v) =>
                      void persistFolderCustomerFlags({
                        customerVisible: v ? false : folder.customerVisible === true,
                        customerAnnotatable: v ? false : folder.customerAnnotatable === true,
                        internalOnly: v,
                      })
                    }
                  />
                  <Label htmlFor={`cust-int-${folder.id}`} className="cursor-pointer text-sm font-normal">
                    Interní pouze pro firmu
                  </Label>
                </div>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Bez „Viditelné zákazníkovi“ zákazník složku neuvidí. Účetní složky typu Doklady se v
                klientském portálu nezobrazují.
              </p>
            </div>
          ) : null}
          {canManageFolders && !isEmployeeLimited && !isCustomerScope && emailPresets ? (
            <JobEmailNotificationRecipientsPanel
              enabled={folderEmailSettings.enabled}
              recipients={folderEmailSettings.recipients}
              disabled={folderPermBusy}
              onEnabledChange={(v) => {
                let rows = folderEmailSettings.recipients;
                if (v && !rows.length && emailPresets) {
                  rows = mergeFolderRecipientsForVisibility([], {
                    employeeVisible: folder.employeeVisible === true,
                    customerVisible: folder.customerVisible === true,
                    internalOnly: folder.internalOnly === true,
                    employeeCandidates: emailPresets.employeeCandidates,
                    customerCandidates: emailPresets.customerCandidates,
                  });
                }
                void persistFolderEmailNotifications(v, rows);
              }}
              onRecipientsChange={(rows) =>
                void persistFolderEmailNotifications(folderEmailSettings.enabled, rows)
              }
              className="mt-2"
            />
          ) : null}
          {showFolderUpload ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={galleryRef}
                type="file"
                accept={JOB_MEDIA_ACCEPT_ATTR}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []).filter(Boolean);
                  e.target.value = "";
                  if (!files.length) return;
                  if (isAccountingFolder) {
                    const ok = files.filter((f) => isAllowedJobMediaFile(f));
                    if (!ok.length) {
                      toast({
                        variant: "destructive",
                        title: "Nepodporovaný formát",
                        description:
                          "Pouze JPG, PNG, WEBP, PDF, Office nebo archiv (ZIP, RAR, 7z).",
                      });
                      return;
                    }
                    openAccountingForFiles(ok);
                    return;
                  }
                  setBusy(true);
                  void (async () => {
                    const uploaded: string[] = [];
                    for (const f of files) {
                      try {
                        const name = await uploadOne(f, undefined, { skipNotify: true });
                        if (name) uploaded.push(name);
                      } catch (err) {
                        console.error(err);
                        toast({
                          variant: "destructive",
                          title: "Nahrání selhalo",
                          description: f.name,
                        });
                      }
                    }
                    if (uploaded.length && user) {
                      const token = await user.getIdToken();
                      void notifyJobActivity({
                        idToken: token,
                        companyId,
                        jobId,
                        eventType: "file_upload",
                        folderId: folder.id,
                        folderName: folder.name ?? null,
                        batchFileNames: uploaded,
                        entityId: `${folder.id}:${uploaded.join(",")}`,
                      });
                    }
                  })().finally(() => setBusy(false));
                }}
              />
              <Button
                type="button"
                variant="default"
                className="min-h-[44px] flex-1 gap-2"
                disabled={busy}
                onClick={() => galleryRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Nahrát soubor
              </Button>
              <input
                ref={cameraRef}
                type="file"
                accept={JOB_IMAGE_ACCEPT_ATTR}
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (isAccountingFolder) {
                    if (!isAllowedJobMediaFile(file)) {
                      toast({
                        variant: "destructive",
                        title: "Nepodporovaný formát",
                      });
                      return;
                    }
                    openAccountingForFiles([file]);
                    return;
                  }
                  setBusy(true);
                  void uploadOne(file)
                    .catch((err) => {
                      console.error(err);
                      toast({
                        variant: "destructive",
                        title: "Fotka se nepodařila uložit",
                      });
                    })
                    .finally(() => setBusy(false));
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] flex-1 gap-2"
                disabled={busy}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                Vyfotit
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
        {imagesForUi.length > 0 ? (
          <>
          <div
            className={cn(
              JOB_MEDIA_LIST_SCROLL_CLASS,
              isFolderWide
                ? "rounded-md border border-border/40 bg-muted/5 p-2 sm:p-3"
                : "rounded-md border border-border/40 bg-muted/5 p-2"
            )}
          >
          <div className={JOB_MEDIA_CARD_GRID_CLASS}>
            {visibleFolderImages.map((img) => {
              const kind = inferJobMediaItemType(img);
              const openUrl = getJobMediaPreviewUrl(img);
              const title = img.fileName || img.name || img.id;
              const dateLine = buildJobMediaCardDateLine(img, {
                uploaderFallback: authorDisplayName,
              });
              const hasNote = !!img.note?.trim();
              const fileDrawingNotes =
                kind === "image" || kind === "pdf"
                  ? drawingNotesForTarget(img.id, img as unknown as Record<string, unknown>)
                  : [];
              const fileDrawingPreview =
                fileDrawingNotes.length > 0
                  ? fileDrawingNotes[fileDrawingNotes.length - 1]?.text
                  : null;
              const showInternalNote = !isCustomerScope && hasNote;
              const mediaApprovalSummary =
                !isCustomerScope
                  ? parseJobMediaApproval(img as unknown as Record<string, unknown>)
                  : null;

                  if (
                    !isCustomerScope &&
                    isFolderWide &&
                    (kind === "pdf" || kind === "office" || kind === "csv")
                  ) {
                return null;
              }

              if (
                kind === "pdf" ||
                kind === "office" ||
                kind === "csv" ||
                kind === "archive"
              ) {
                return (
                  <JobMediaFileCard
                    key={img.id}
                    borderClassName={
                      kind === "office"
                        ? "border-dashed border-blue-500/30"
                        : kind === "csv"
                          ? "border-dashed border-emerald-600/35"
                          : kind === "archive"
                            ? "border-dashed border-amber-600/35"
                            : "border-dashed border-red-500/30"
                    }
                    preview={
                      kind === "office" ? (
                        <JobMediaOfficePreview />
                      ) : kind === "csv" ? (
                        <JobMediaCsvPreview />
                      ) : kind === "archive" ? (
                        <JobMediaArchivePreview />
                      ) : (
                        <JobMediaPdfPreview />
                      )
                    }
                    title={title}
                    dateLine={dateLine}
                    note={isCustomerScope ? undefined : img.note}
                    hasNote={showInternalNote}
                    customerNotesPreview={kind === "pdf" ? fileDrawingPreview : null}
                    drawingNotesCount={kind === "pdf" ? fileDrawingNotes.length : 0}
                    onOpenDrawingNotes={
                      kind === "pdf"
                        ? () =>
                            openDrawingNotes({
                              fileId: img.id,
                              folderId: folder.id,
                              fileName: title,
                              legacyRow: img as unknown as Record<string, unknown>,
                            })
                        : undefined
                    }
                    mediaApprovalSummary={mediaApprovalSummary}
                    onResendApprovalEmail={
                      mediaApprovalSummary?.requiresCustomerApproval
                        ? () =>
                            onOpenMediaApprovalDialog?.({
                              target: {
                                kind: "folderImages",
                                folderId: folder.id,
                                imageId: img.id,
                              },
                              fileLabel: title,
                              row: img as unknown as Record<string, unknown>,
                            })
                        : undefined
                    }
                    resendApprovalBusy={false}
                    extraFooter={productionFooter(img)}
                    actions={
                      <>
                        {renderExportNotesButtons(img, title)}
                        {kind !== "archive" ? (
                          <JobMediaIconButton
                            label="Otevřít v novém okně"
                            disabled={!openUrl}
                            onClick={() => {
                              if (openUrl)
                                window.open(
                                  openUrl,
                                  "_blank",
                                  "noopener,noreferrer"
                                );
                            }}
                          >
                            <ExternalLink className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        ) : null}
                        <JobMediaIconButton
                          label={`Poznámky (${fileCommentStats.get(img.id)?.count ?? 0})`}
                          disabled={!user?.uid}
                          onClick={() => {
                            setFileChatTarget({
                              fileId: img.id,
                              folderId: folder.id,
                              fileName: title,
                            });
                            setFileChatOpen(true);
                          }}
                        >
                          <span className="relative inline-flex items-center">
                            <MessageSquare className="size-[18px]" aria-hidden />
                            {(fileCommentStats.get(img.id)?.unread ?? 0) > 0 ? (
                              <span className="absolute -right-2 -top-2 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {fileCommentStats.get(img.id)?.unread ?? 0}
                              </span>
                            ) : null}
                          </span>
                        </JobMediaIconButton>
                        {kind === "pdf" ? (
                          <JobMediaIconButton
                            label="Náhled"
                            disabled={!openUrl}
                            onClick={() => {
                              if (openUrl) openFolderMediaViewer(img, openUrl, title);
                            }}
                          >
                            <Eye className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        ) : null}
                        {kind === "pdf" && allowFolderStaffFileActions ? (
                          <JobMediaIconButton
                            label="Převést na obrázek"
                            disabled={busy || !openUrl}
                            onClick={() =>
                              setPdfConvertTarget({
                                pdfDoc: img,
                                openUrl: openUrl || "",
                                title,
                              })
                            }
                          >
                            <ImagePlus className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        ) : null}
                        {openUrl ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className={jobMediaIconBtnClassName}
                                asChild
                              >
                                <a
                                  href={openUrl}
                                  {...(kind === "archive"
                                    ? { download: title }
                                    : {
                                        target: "_blank",
                                        rel: "noopener noreferrer",
                                      })}
                                >
                                  <Download className="size-[18px]" aria-hidden />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              {kind === "archive" ? "Stáhnout" : "Otevřít v prohlížeči"}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <JobMediaIconButton label="Stáhnout" disabled>
                            <Download className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        )}
                        {allowFolderStaffFileActions ? (
                          <>
                            {!isCustomerScope &&
                            onOpenMediaApprovalDialog &&
                            kind !== "office" &&
                            kind !== "archive" ? (
                              <JobMediaIconButton
                                label="Schválení zákazníkem"
                                onClick={() =>
                                  onOpenMediaApprovalDialog({
                                    target: {
                                      kind: "folderImages",
                                      folderId: folder.id,
                                      imageId: img.id,
                                    },
                                    fileLabel: title,
                                    row: img as unknown as Record<string, unknown>,
                                  })
                                }
                              >
                                <UserCheck className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                            ) : null}
                            <JobMediaIconButton
                              label="Smazat soubor"
                              disabled={busy}
                              className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void deleteImage(img)}
                            >
                              <Trash2 className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          </>
                        ) : null}
                      </>
                    }
                  />
                );
              }

              return (
                <JobMediaFileCard
                  key={img.id}
                  borderClassName="border-border/55"
                  preview={
                    isFolderWide ? (
                      <ImageThumbWithQuickActions
                        busy={busy}
                        canManage={
                          canManageFolders && allowFolderStaffFileActions
                        }
                        onPreview={() => {
                          if (openUrl) openFolderMediaViewer(img, openUrl, title);
                        }}
                        onDelete={() => void deleteImage(img)}
                      >
                        <MediaThumb row={img} alt={title} />
                      </ImageThumbWithQuickActions>
                    ) : (
                      <MediaThumb row={img} alt={title} />
                    )
                  }
                  title={title}
                    dateLine={dateLine}
                    note={isCustomerScope ? undefined : img.note}
                    hasNote={showInternalNote}
                    customerNotesPreview={fileDrawingPreview}
                    drawingNotesCount={fileDrawingNotes.length}
                    onOpenDrawingNotes={() =>
                      openDrawingNotes({
                        fileId: img.id,
                        folderId: folder.id,
                        fileName: title,
                        legacyRow: img as unknown as Record<string, unknown>,
                      })
                    }
                    mediaApprovalSummary={mediaApprovalSummary}
                    onResendApprovalEmail={
                      mediaApprovalSummary?.requiresCustomerApproval
                        ? () =>
                            onOpenMediaApprovalDialog?.({
                              target: {
                                kind: "folderImages",
                                folderId: folder.id,
                                imageId: img.id,
                              },
                              fileLabel: title,
                              row: img as unknown as Record<string, unknown>,
                            })
                        : undefined
                    }
                    resendApprovalBusy={false}
                    extraFooter={productionFooter(img)}
                    actions={
                      <>
                        {renderExportNotesButtons(img, title)}
                        <JobMediaIconButton
                          label={`Poznámky (${fileCommentStats.get(img.id)?.count ?? 0})`}
                        disabled={!user?.uid}
                        onClick={() => {
                          setFileChatTarget({
                            fileId: img.id,
                            folderId: folder.id,
                            fileName: title,
                          });
                          setFileChatOpen(true);
                        }}
                      >
                        <span className="relative inline-flex items-center">
                          <MessageSquare className="size-[18px]" aria-hidden />
                          {(fileCommentStats.get(img.id)?.unread ?? 0) > 0 ? (
                            <span className="absolute -right-2 -top-2 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {fileCommentStats.get(img.id)?.unread ?? 0}
                            </span>
                          ) : null}
                        </span>
                      </JobMediaIconButton>
                      <JobMediaIconButton
                        label="Náhled"
                        disabled={!openUrl}
                        onClick={() => {
                          if (openUrl) openFolderMediaViewer(img, openUrl, title);
                        }}
                      >
                        <Eye className="size-[18px]" aria-hidden />
                      </JobMediaIconButton>
                      {allowFolderStaffFileActions ? (
                        <JobMediaIconButton
                          label="Anotovat"
                          onClick={() =>
                            onAnnotatePhoto({
                              id: img.id,
                              imageUrl: img.imageUrl,
                              url: img.url,
                              downloadURL: img.downloadURL,
                              originalImageUrl: img.originalImageUrl,
                              annotatedImageUrl: img.annotatedImageUrl,
                              storagePath: img.storagePath,
                              path: img.path,
                              annotatedStoragePath: img.annotatedStoragePath,
                              fileName: img.fileName,
                              name: img.name,
                              fileType: inferJobMediaItemType(img),
                              annotationData: img.annotationData,
                              annotationTarget: {
                                kind: "folderImages",
                                folderId: folder.id,
                              },
                            })
                          }
                        >
                          <Pencil className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                      ) : null}
                      {openUrl ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className={jobMediaIconBtnClassName}
                              asChild
                            >
                              <a
                                href={openUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Download className="size-[18px]" aria-hidden />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            Otevřít v prohlížeči
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <JobMediaIconButton label="Otevřít" disabled>
                          <Download className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                      )}
                      {allowFolderStaffFileActions ? (
                        <>
                          {!isCustomerScope && onOpenMediaApprovalDialog ? (
                            <JobMediaIconButton
                              label="Schválení zákazníkem"
                              onClick={() =>
                                onOpenMediaApprovalDialog({
                                  target: {
                                    kind: "folderImages",
                                    folderId: folder.id,
                                    imageId: img.id,
                                  },
                                  fileLabel: title,
                                  row: img as unknown as Record<string, unknown>,
                                })
                              }
                            >
                              <UserCheck className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          ) : null}
                          <JobMediaIconButton
                            label="Smazat soubor"
                            disabled={busy}
                            className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void deleteImage(img)}
                          >
                            <Trash2 className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        </>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </div>
          {!isCustomerScope && isFolderWide && folderDocImages.length > 0 ? (
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
              {folderDocImages.map((img) => {
                const kind = inferJobMediaItemType(img);
                const openUrl = getJobMediaPreviewUrl(img);
                const title = img.fileName || img.name || img.id;
                const dateLine = buildJobMediaCardDateLine(img, {
                  uploaderFallback: authorDisplayName,
                });
                return (
                  <MediaCompactDocRow
                    key={img.id}
                    icon={
                      kind === "archive" ? (
                        <Archive className="h-6 w-6 text-amber-800" strokeWidth={1.5} />
                      ) : kind === "office" ? (
                        <FileText className="h-6 w-6 text-blue-700" strokeWidth={1.5} />
                      ) : (
                        <FileText className="h-6 w-6 text-red-600" strokeWidth={1.5} />
                      )
                    }
                    title={title}
                    dateLine={dateLine}
                    footer={productionFooter(img)}
                    actions={
                      <>
                        {renderExportNotesButtons(img, title)}
                        <JobMediaIconButton
                          label="Otevřít"
                          disabled={!openUrl}
                          onClick={() => {
                            if (openUrl)
                              window.open(openUrl, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <ExternalLink className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                        {kind === "pdf" ? (
                          <JobMediaIconButton
                            label="Celá obrazovka"
                            disabled={!openUrl}
                            onClick={() => {
                              if (openUrl) openFolderMediaViewer(img, openUrl, title);
                            }}
                          >
                            <Eye className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        ) : null}
                        {kind === "pdf" && allowFolderStaffFileActions ? (
                          <JobMediaIconButton
                            label="Převést na obrázek"
                            disabled={busy || !openUrl}
                            onClick={() =>
                              setPdfConvertTarget({
                                pdfDoc: img,
                                openUrl: openUrl || "",
                                title,
                              })
                            }
                          >
                            <ImagePlus className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        ) : null}
                        {openUrl ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className={jobMediaIconBtnClassName}
                                asChild
                              >
                                <a
                                  href={openUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Download className="size-[18px]" aria-hidden />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Otevřít v prohlížeči
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {allowFolderStaffFileActions ? (
                          <>
                            <JobMediaIconButton
                              label="Smazat"
                              disabled={busy}
                              className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void deleteImage(img)}
                            >
                              <Trash2 className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          </>
                        ) : null}
                      </>
                    }
                  />
                );
              })}
            </div>
          ) : null}
          </div>
          {imagesForUi.length > JOB_MEDIA_INITIAL_COUNT ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setShowAllInFolder((v) => !v)}
            >
              {showAllInFolder
                ? "Zobrazit méně"
                : `Zobrazit více (${imagesForUi.length - JOB_MEDIA_INITIAL_COUNT} dalších)`}
            </Button>
          ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">V této složce zatím nic není.</p>
        )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>

    <Dialog
      open={!!pdfConvertTarget}
      onOpenChange={(open) => {
        if (!open && !pdfConvertBusy) setPdfConvertTarget(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Převést PDF na obrázek</DialogTitle>
          <DialogDescription>
            Původní PDF zůstane v úložišti. Nové PNG se uloží do stejné složky a u obrázku
            bude odkaz na zdrojové PDF.
          </DialogDescription>
        </DialogHeader>
        {pdfConvertNumPages < 1 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Zjišťuji počet stránek…
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Stránek v dokumentu: <strong>{pdfConvertNumPages}</strong>
            </p>
            {pdfConvertNumPages > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="pdf-convert-pages">Rozsah</Label>
                <Select
                  value={pdfConvertMode}
                  onValueChange={(v) => setPdfConvertMode(v as "all" | "single")}
                >
                  <SelectTrigger id="pdf-convert-pages">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny stránky ({pdfConvertNumPages})</SelectItem>
                    <SelectItem value="single">Jen vybraná stránka</SelectItem>
                  </SelectContent>
                </Select>
                {pdfConvertMode === "single" ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pdf-convert-page-num">Číslo stránky (1–{pdfConvertNumPages})</Label>
                    <Input
                      id="pdf-convert-page-num"
                      type="number"
                      min={1}
                      max={pdfConvertNumPages}
                      value={pdfConvertSinglePage}
                      onChange={(e) =>
                        setPdfConvertSinglePage(
                          Math.min(
                            pdfConvertNumPages,
                            Math.max(1, Number(e.target.value) || 1)
                          )
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={pdfConvertBusy}
            onClick={() => setPdfConvertTarget(null)}
          >
            Zrušit
          </Button>
          <Button
            type="button"
            disabled={
              pdfConvertBusy || pdfConvertNumPages < 1 || !pdfConvertTarget
            }
            onClick={() => void runPdfToImageConversion()}
          >
            {pdfConvertBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Převádím…
              </>
            ) : (
              "Převést"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={drawingNotesOpen} onOpenChange={setDrawingNotesOpen}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Poznámky k výkresu</DialogTitle>
          <DialogDescription>
            {drawingNotesTarget?.fileName?.trim() || "Soubor"} — historie a nová poznámka.
          </DialogDescription>
        </DialogHeader>
        {drawingNotesTarget ? (
          <JobMediaFileNotesPanel
            firestore={firestore}
            companyId={companyId}
            jobId={jobId}
            userId={user.uid}
            authorName={authorDisplayName}
            target={drawingNotesTarget}
            legacyFileRow={drawingNotesTarget.legacyRow}
            allNotes={mediaNotesAll}
            customerPortal={isCustomerScope}
            onNoteAdded={onMediaNoteAdded}
          />
        ) : null}
      </DialogContent>
    </Dialog>

    </>
  );
}

export type JobMediaSectionProps = {
  companyId: string;
  jobId: string;
  /** Název zakázky pro globální doklady */
  jobDisplayName?: string | null;
  user: User | null;
  canManageFolders: boolean;
  /** Legacy fotodokumentace (kolekce photos). */
  photos: LegacyPhotoDoc[] | undefined;
  uploadLegacyPhoto: (
    file: File,
    opts?: { skipUploadingFlag?: boolean }
  ) => Promise<void>;
  legacyUploading: boolean;
  onAnnotatePhoto: (target: JobPhotoAnnotationTarget) => void;
  /** Plná šířka detailu zakázky — kompaktnější dokumenty, výchozí sbalená sekce */
  layout?: "default" | "jobDetailWide";
  /** Omezený režim zaměstnance u zakázky; `customer` = jen explicitně zpřístupněné složky a soubory */
  mediaScope?: "full" | "employeeLimited" | "customer";
  memberPermissions?: JobMemberPermissions | null;
  /** companies/.../employees/{id} — audit nahrání */
  employeeRecordId?: string | null;
  /** Legacy kolekce photos — jen pokud true a scope limited */
  showLegacyPhotosForEmployee?: boolean;
  /** Dokument zakázky z Firestore — pro určení zákazníka u schvalování médií. */
  jobRecord?: Record<string, unknown> | null;
  /** Předvyplnění zákazníka v notifikacích složek (z detailu zakázky). */
  folderCustomerNotificationCandidates?: JobNotificationRecipient[] | null;
  /** Deep link z e-mailu (?photoComment=…) — otevře chat u souboru v příslušné složce. */
  photoCommentDeepLink?: {
    folderId: string;
    fileId: string;
    fileName: string;
  } | null;
  /** Po úspěšném otevření chatu z deep linku (např. odstranění query z URL). */
  onPhotoCommentDeepLinkConsumed?: () => void;
};

export function JobMediaSection({
  companyId,
  jobId,
  jobDisplayName = null,
  user,
  canManageFolders,
  photos,
  uploadLegacyPhoto,
  legacyUploading,
  onAnnotatePhoto,
  layout = "default",
  mediaScope = "full",
  memberPermissions = null,
  employeeRecordId = null,
  showLegacyPhotosForEmployee = false,
  jobRecord = null,
  photoCommentDeepLink = null,
  onPhotoCommentDeepLinkConsumed,
  folderCustomerNotificationCandidates = null,
}: JobMediaSectionProps) {
  /** Skrýt nahrávání / mazání / interní akce — zaměstnanec i zákazník. */
  const hideJobMediaAdminUi =
    mediaScope === "employeeLimited" || mediaScope === "customer";
  const firestore = useFirestore();
  const { toast } = useToast();
  const actorRef = useMemoFirebase(
    () =>
      firestore && user?.uid ? doc(firestore, "users", user.uid) : null,
    [firestore, user?.uid]
  );
  const { data: actorProfile } = useDoc(actorRef);

  const jobMembersRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId && canManageFolders && mediaScope === "full"
        ? collection(firestore, "companies", companyId, "jobs", jobId, "jobMembers")
        : null,
    [firestore, companyId, jobId, canManageFolders, mediaScope]
  );
  const { data: jobMembersRaw = [] } = useCollection(jobMembersRef);

  const companyUsersRef = useMemoFirebase(
    () =>
      firestore && companyId && canManageFolders && mediaScope === "full"
        ? query(collection(firestore, "users"), where("companyId", "==", companyId), limit(300))
        : null,
    [firestore, companyId, canManageFolders, mediaScope]
  );
  const { data: companyUsersRaw = [] } = useCollection(companyUsersRef, {
    suppressGlobalPermissionError: true,
  });

  const emailPresets = useMemo(() => {
    if (!canManageFolders || mediaScope !== "full") return null;
    const usersByUid = new Map<string, UserRow>();
    for (const row of companyUsersRaw as Array<{ id: string } & Record<string, unknown>>) {
      if (!row?.id) continue;
      usersByUid.set(row.id, {
        id: row.id,
        email: typeof row.email === "string" ? row.email : undefined,
        displayName: typeof row.displayName === "string" ? row.displayName : undefined,
        name: typeof row.name === "string" ? row.name : undefined,
        role: typeof row.role === "string" ? row.role : undefined,
      });
    }
    const members = (jobMembersRaw as Array<Record<string, unknown>>).map((m) => ({
      authUserId: typeof m.authUserId === "string" ? m.authUserId : undefined,
      displayName: typeof m.displayName === "string" ? m.displayName : undefined,
      name: typeof m.name === "string" ? m.name : undefined,
      email: typeof m.email === "string" ? m.email : undefined,
      role: typeof m.role === "string" ? m.role : undefined,
    }));
    const employeeCandidates = buildEmployeeRecipientCandidates(members, usersByUid);
    const adminCandidates = buildAdminRecipientCandidates([...usersByUid.values()]);
    const customerCandidates =
      folderCustomerNotificationCandidates?.length
        ? folderCustomerNotificationCandidates
        : buildCustomerRecipientCandidates([]);
    return {
      employeeCandidates,
      customerCandidates,
      adminCandidates,
    };
  }, [
    canManageFolders,
    mediaScope,
    jobMembersRaw,
    companyUsersRaw,
    folderCustomerNotificationCandidates,
  ]);

  const folderEmailPresetsForBlocks = useMemo(() => {
    if (!emailPresets) return null;
    return {
      employeeCandidates: emailPresets.employeeCandidates,
      customerCandidates: emailPresets.customerCandidates,
    };
  }, [emailPresets]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderType, setNewFolderType] = useState<JobFolderType>("files");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [importFromJobOpen, setImportFromJobOpen] = useState(false);

  const jobsForImportRef = useMemoFirebase(
    () =>
      firestore && companyId && !hideJobMediaAdminUi && canManageFolders
        ? collection(firestore, "companies", companyId, "jobs")
        : null,
    [firestore, companyId, hideJobMediaAdminUi, canManageFolders]
  );
  const { data: jobsForImportRaw } = useCollection(jobsForImportRef);
  const jobsForImport = jobsForImportRaw ?? [];
  const customersForImportRef = useMemoFirebase(
    () =>
      firestore && companyId && !hideJobMediaAdminUi && canManageFolders
        ? collection(firestore, "companies", companyId, "customers")
        : null,
    [firestore, companyId, hideJobMediaAdminUi, canManageFolders]
  );
  const { data: customersForImportRaw } = useCollection(customersForImportRef);
  const customersByIdForImport = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const c of customersForImportRaw ?? []) {
      const id = String((c as { id?: string }).id ?? "").trim();
      if (id) m.set(id, c as Record<string, unknown>);
    }
    return m;
  }, [customersForImportRaw]);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteCtx, setNoteCtx] = useState<{
    path: JobMediaFirestorePath;
    imageId: string;
    fileNameHint: string;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  const [mediaApprovalDlg, setMediaApprovalDlg] = useState<{
    target: JobMediaRef;
    fileLabel: string;
    initialRequires: boolean;
    initialAdminNote: string;
    initialApprovalEmailSent: boolean;
  } | null>(null);

  const openMediaApprovalDialog = useCallback(
    (ctx: { target: JobMediaRef; fileLabel: string; row: Record<string, unknown> }) => {
      const pr = parseJobMediaApproval(ctx.row);
      setMediaApprovalDlg({
        target: ctx.target,
        fileLabel: ctx.fileLabel,
        initialRequires: pr.requiresCustomerApproval,
        initialAdminNote: pr.approvalNoteFromAdmin,
        initialApprovalEmailSent: pr.approvalEmailSent,
      });
    },
    []
  );

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const openLegacyMediaViewer = useCallback(
    (p: LegacyPhotoDoc, openUrl: string, title: string) => {
      const kind = inferJobMediaItemType(p);
      if (kind === "office") {
        if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (kind === "image" || kind === "pdf") {
        onAnnotatePhoto({
          id: p.id,
          imageUrl: p.imageUrl,
          url: p.url,
          downloadURL: p.downloadURL,
          originalImageUrl: p.originalImageUrl,
          annotatedImageUrl: p.annotatedImageUrl,
          storagePath: p.storagePath,
          path: p.path,
          fullPath: p.fullPath,
          fileName: p.fileName,
          name: p.name,
          fileType: kind === "pdf" ? "pdf" : "image",
          annotationData: p.annotationData,
          annotationTarget: { kind: "photos" },
        });
        return;
      }
    },
    [onAnnotatePhoto]
  );

  const isJobDetailWide = layout === "jobDetailWide";
  const [mediaGalleryOpen, setMediaGalleryOpen] = useState(() => !isJobDetailWide);
  const [showAllLegacyPhotos, setShowAllLegacyPhotos] = useState(false);

  const foldersColRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "folders"
          )
        : null,
    [firestore, companyId, jobId]
  );

  const { data: foldersRaw } = useCollection<JobFolderDoc>(foldersColRef);

  const legacyFileCommentsQuery = useMemoFirebase(
    () =>
      firestore && companyId && jobId && mediaScope !== "customer"
        ? query(
            collection(firestore, "companies", companyId, "jobs", jobId, "comments"),
            where("targetType", "==", "file"),
            limit(500)
          )
        : null,
    [firestore, companyId, jobId, mediaScope]
  );
  const { data: legacyFileCommentsRaw = [] } = useCollection(legacyFileCommentsQuery);

  const mediaNotesQuery = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? query(
            collection(firestore, "companies", companyId, "jobs", jobId, "media_notes"),
            limit(500)
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: mediaNotesRaw = [] } = useCollection(mediaNotesQuery);
  const [optimisticMediaNotes, setOptimisticMediaNotes] = useState<JobMediaFileNoteDoc[]>([]);

  const legacyFileCommentsList = (Array.isArray(legacyFileCommentsRaw)
    ? legacyFileCommentsRaw
    : []) as Array<Record<string, unknown> & { id: string }>;

  const mediaNotesFromFirestore = useMemo(() => {
    const list = (Array.isArray(mediaNotesRaw) ? mediaNotesRaw : []) as Array<
      Record<string, unknown> & { id: string }
    >;
    const parsed: JobMediaFileNoteDoc[] = [];
    for (const row of list) {
      const n = parseJobMediaFileNoteDoc(row, row.id);
      if (n) parsed.push(n);
    }
    for (const row of legacyFileCommentsList) {
      const legacy = commentRowToMediaNoteLike(row);
      if (legacy && legacy.visibleToCustomer) parsed.push(legacy);
    }
    return sortMediaNotesChronologically(parsed);
  }, [mediaNotesRaw, legacyFileCommentsList]);

  const mediaNotesAll = useMemo(() => {
    const byId = new Map<string, JobMediaFileNoteDoc>();
    for (const n of mediaNotesFromFirestore) byId.set(n.id, n);
    for (const n of optimisticMediaNotes) byId.set(n.id, n);
    return sortMediaNotesChronologically([...byId.values()]);
  }, [mediaNotesFromFirestore, optimisticMediaNotes]);

  const handleMediaNoteAdded = useCallback(
    (note: JobMediaFileNoteDoc) => {
      setOptimisticMediaNotes((prev) =>
        prev.some((x) => x.id === note.id) ? prev : [...prev, note]
      );
      if (user) {
        void user.getIdToken().then((token) =>
          notifyJobActivity({
            idToken: token,
            companyId,
            jobId,
            eventType: "file_note",
            folderId: note.folderId ?? null,
            fileId: note.fileId,
            fileName: null,
            messagePreview: note.text,
            visibleToCustomer: note.visibleToCustomer,
            entityId: note.id,
          })
        );
      }
    },
    [user, companyId, jobId]
  );

  const authorDisplayName = useMemo(() => {
    const p = actorProfile as { displayName?: unknown; name?: unknown } | null;
    return (
      String(p?.displayName ?? p?.name ?? user?.email ?? "").trim() || "Uživatel"
    );
  }, [actorProfile, user?.email]);

  const [legacyDrawingNotesOpen, setLegacyDrawingNotesOpen] = useState(false);
  const [legacyDrawingNotesTarget, setLegacyDrawingNotesTarget] =
    useState<(JobMediaFileNoteTarget & { legacyRow?: Record<string, unknown> }) | null>(null);

  const legacyDrawingNotesFor = useCallback(
    (fileId: string, fileRow?: Record<string, unknown>) => {
      const target = { fileId, folderId: null as string | null };
      let picked = pickMediaNotesForFile(mediaNotesAll, target);
      if (fileRow) {
        picked = mergeFileMediaNotesWithLegacyApprovalComment(picked, fileRow, target);
      }
      if (mediaScope !== "customer") return picked;
      return user?.uid
        ? filterMediaNotesForCustomerView(picked, user.uid)
        : picked;
    },
    [mediaNotesAll, mediaScope, user?.uid]
  );

  const renderLegacyExportNotesButtons = useCallback(
    (p: { id: string } & Record<string, unknown>, title: string) => {
      if (
        !canJobMediaExportWithNotes({
          mediaScope,
          hideJobMediaAdminUi,
          folder: null,
          file: p,
        })
      ) {
        return null;
      }
      return (
        <JobMediaExportNotesButtons
          buildInput={() =>
            jobMediaNotesExportInputFromRow({
              row: p,
              fileName: title,
              jobLabel: jobDisplayName,
              comments: pickFileCommentsForExport(legacyFileCommentsList, p.id, {
                legacyPhotos: true,
              }),
              includeApproval: mediaScope !== "customer",
            })
          }
        />
      );
    },
    [
      mediaScope,
      hideJobMediaAdminUi,
      jobDisplayName,
      legacyFileCommentsList,
    ]
  );

  const foldersSorted = useMemo(() => {
    const list = (foldersRaw ?? []).filter(
      (f) => f && typeof f.id === "string"
    ) as JobFolderDoc[];
    return list.slice().sort((a, b) => {
      const na = (a.name || "").toLowerCase();
      const nb = (b.name || "").toLowerCase();
      return na.localeCompare(nb, "cs");
    });
  }, [foldersRaw]);

  const foldersSortedForUi = useMemo(() => {
    if (mediaScope === "customer") {
      return filterFoldersForCustomer(
        foldersSorted as unknown as (Record<string, unknown> & { id: string; type?: string })[]
      ) as unknown as JobFolderDoc[];
    }
    if (mediaScope !== "employeeLimited") return foldersSorted;
    return filterFoldersForLimitedEmployee(
      foldersSorted as unknown as (Record<string, unknown> & { id: string })[],
      memberPermissions
    ) as unknown as JobFolderDoc[];
  }, [foldersSorted, mediaScope, memberPermissions]);

  const openNoteEditor = useCallback(
    (ctx: {
      path: JobMediaFirestorePath;
      imageId: string;
      currentNote: string;
      fileNameHint: string;
    }) => {
      if (mediaScope === "customer") return;
      setNoteCtx({
        path: ctx.path,
        imageId: ctx.imageId,
        fileNameHint: ctx.fileNameHint,
      });
      setNoteDraft(ctx.currentNote);
      setNoteOpen(true);
    },
    [mediaScope]
  );

  const saveNote = async () => {
    if (mediaScope === "customer") {
      toast({
        variant: "destructive",
        title: "Nepovolená akce",
        description: "Zákazník nemůže upravovat poznámky u souborů.",
      });
      return;
    }
    if (!firestore || !user || !noteCtx) return;
    const text = noteDraft.trim();
    setNoteSaving(true);
    try {
      if (noteCtx.path.kind === "photos") {
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "photos",
            noteCtx.imageId
          ),
          text
            ? {
                note: text,
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
            : {
                note: deleteField(),
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
        );
      } else if (noteCtx.path.kind === "folderImages") {
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "folders",
            noteCtx.path.folderId,
            "images",
            noteCtx.imageId
          ),
          text
            ? {
                note: text,
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
            : {
                note: deleteField(),
                noteUpdatedAt: serverTimestamp(),
                noteUpdatedBy: user.uid,
              }
        );
      } else if (noteCtx.path.kind === "measurementPhotos") {
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "measurement_photos",
            noteCtx.imageId
          ),
          text
            ? {
                note: text,
                updatedAt: serverTimestamp(),
              }
            : {
                note: deleteField(),
                updatedAt: serverTimestamp(),
              }
        );
      }

      const mirrorPatch = buildJobMediaMirrorNoteOnlyPatch({
        note: text || null,
        fileNameFallback: noteCtx.fileNameHint,
        jobDisplayName,
      });
      if (noteCtx.path.kind === "photos") {
        await setDoc(
          companyDocumentRefForJobLegacyPhoto(
            firestore,
            companyId,
            noteCtx.imageId
          ),
          mirrorPatch,
          { merge: true }
        );
      } else if (noteCtx.path.kind === "folderImages") {
        await setDoc(
          companyDocumentRefForJobFolderImage(
            firestore,
            companyId,
            noteCtx.path.folderId,
            noteCtx.imageId
          ),
          mirrorPatch,
          { merge: true }
        );
      }

      toast({ title: text ? "Poznámka uložena" : "Poznámka odstraněna" });
      if (text && user) {
        void user.getIdToken().then((token) =>
          notifyJobActivity({
            idToken: token,
            companyId,
            jobId,
            eventType: "file_note",
            folderId:
              noteCtx.path.kind === "folderImages" ? noteCtx.path.folderId : null,
            fileId: noteCtx.imageId,
            fileName: noteCtx.fileNameHint,
            messagePreview: text,
            visibleToCustomer: true,
            entityId: noteCtx.imageId,
          })
        );
      }
      if (user && companyId) {
        logActivitySafe(firestore, companyId, user, actorProfile, {
          actionType: "job_media.note_update",
          actionLabel: text ? "Úprava poznámky u média" : "Odstranění poznámky u média",
          entityType:
            noteCtx.path.kind === "photos"
              ? "job_photo"
              : noteCtx.path.kind === "folderImages"
                ? "job_folder_image"
                : "measurement_photo",
          entityId: noteCtx.imageId,
          entityName: noteCtx.fileNameHint,
          sourceModule: "jobs",
          route: `/portal/jobs/${jobId}`,
          metadata: {
            jobId,
            folderId:
              noteCtx.path.kind === "folderImages"
                ? noteCtx.path.folderId
                : null,
            newNotePreview: text ? text.slice(0, 200) : null,
          },
        });
      }
      setNoteOpen(false);
      setNoteCtx(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Poznámku se nepodařilo uložit.",
      });
    } finally {
      setNoteSaving(false);
    }
  };

  const deleteLegacyPhoto = async (p: LegacyPhotoDoc) => {
    if (!firestore) return;
    if (mediaScope === "customer") {
      toast({
        variant: "destructive",
        title: "Nepovolená akce",
        description: "Zákazník nemůže mazat soubory zakázky.",
      });
      return;
    }
    if (
      !window.confirm(
        `Smazat soubor „${p.fileName || p.id}“? Tato akce je nevratná.`
      )
    ) {
      return;
    }
    try {
      const sp =
        (typeof p.storagePath === "string" && p.storagePath) ||
        (typeof p.path === "string" && p.path) ||
        "";
      if (sp) {
        try {
          await deleteObject(ref(getFirebaseStorage(), sp));
        } catch {
          /* */
        }
      }
      if ((p as { annotatedStoragePath?: string }).annotatedStoragePath) {
        try {
          await deleteObject(
            ref(
              getFirebaseStorage(),
              (p as { annotatedStoragePath?: string }).annotatedStoragePath!
            )
          );
        } catch {
          /* */
        }
      }
      const batch = writeBatch(firestore);
      batch.delete(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "photos",
          p.id
        )
      );
      batch.delete(companyDocumentRefForJobLegacyPhoto(firestore, companyId, p.id));
      await batch.commit();
      if (user && companyId) {
        logActivitySafe(firestore, companyId, user, actorProfile, {
          actionType: "document.delete",
          actionLabel: "Smazání fotky ze základní fotodokumentace",
          entityType: "job_photo",
          entityId: p.id,
          entityName: p.fileName || p.name || p.id,
          sourceModule: "jobs",
          route: `/portal/jobs/${jobId}`,
          metadata: { jobId, fileName: p.fileName || p.name },
        });
      }
      toast({ title: "Soubor smazán" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Soubor se nepodařilo smazat.",
      });
    }
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!firestore || !user || !name) {
      toast({
        variant: "destructive",
        title: "Zadejte název složky",
      });
      return;
    }
    if (!canManageFolders) {
      toast({
        variant: "destructive",
        title: "Nemáte oprávnění",
        description: "Vytvářet složky mohou jen správci.",
      });
      return;
    }
    setCreatingFolder(true);
    try {
      const refDoc = doc(
        collection(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "folders"
        )
      );
      await setDoc(refDoc, {
        id: refDoc.id,
        name,
        type: newFolderType,
        companyId,
        jobId,
        employeeVisible: false,
        allowEmployeeUpload: false,
        /** Legacy (zpětná kompatibilita během přechodu) */
        employeeUploadAllowed: false,
        customerVisible: false,
        customerAnnotatable: false,
        internalOnly: false,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      logActivitySafe(firestore, companyId, user, actorProfile, {
        actionType: "job.folder_create",
        actionLabel: "Vytvoření složky médií zakázky",
        entityType: "job_folder",
        entityId: refDoc.id,
        entityName: name,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: { jobId, folderId: refDoc.id },
      });
      setNewFolderName("");
      setNewFolderType("files");
      setNewFolderOpen(false);
      toast({ title: "Složka vytvořena", description: name });
      if (user) {
        void user.getIdToken().then((token) =>
          notifyJobActivity({
            idToken: token,
            companyId,
            jobId,
            eventType: "folder_create",
            folderId: refDoc.id,
            folderName: name,
            entityId: refDoc.id,
          })
        );
      }
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Složku se nepodařilo vytvořit.",
      });
    } finally {
      setCreatingFolder(false);
    }
  };

  const photosSorted = useMemo(() => {
    const list = (photos ?? []).filter((p) => p?.id);
    return list.slice().sort((a, b) => {
      const ta =
        typeof (a.createdAt as { toMillis?: () => number })?.toMillis ===
        "function"
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      const tb =
        typeof (b.createdAt as { toMillis?: () => number })?.toMillis ===
        "function"
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      return tb - ta;
    });
  }, [photos]);

  const photosSortedForUi = useMemo(() => {
    if (mediaScope === "customer") {
      return photosSorted.filter((p) =>
        isLegacyPhotoCustomerVisible(p as Record<string, unknown>)
      );
    }
    if (mediaScope !== "employeeLimited") return photosSorted;
    if (!showLegacyPhotosForEmployee) return [];
    return photosSorted.filter(
      (p) => (p as { employeeVisible?: boolean }).employeeVisible !== false
    );
  }, [mediaScope, photosSorted, showLegacyPhotosForEmployee]);

  const visibleLegacyPhotos = useMemo(() => {
    if (
      showAllLegacyPhotos ||
      photosSortedForUi.length <= JOB_MEDIA_INITIAL_COUNT
    ) {
      return photosSortedForUi;
    }
    return photosSortedForUi.slice(0, JOB_MEDIA_INITIAL_COUNT);
  }, [photosSortedForUi, showAllLegacyPhotos]);

  const legacyDocPhotos = useMemo(
    () =>
      visibleLegacyPhotos.filter((p) => {
        const k = inferJobMediaItemType(p);
        return k === "pdf" || k === "office" || k === "csv";
      }),
    [visibleLegacyPhotos]
  );

  useEffect(() => {
    if (!firestore || !companyId || !jobId || !user?.uid) return;
    if (mediaScope === "employeeLimited" || mediaScope === "customer") return;
    let cancelled = false;
    const jn = jobDisplayName ?? null;
    void (async () => {
      for (const p of photosSorted) {
        if (cancelled) return;
        if (!p?.id) continue;
        const mirrorRef = companyDocumentRefForJobLegacyPhoto(
          firestore,
          companyId,
          p.id
        );
        const snap = await getDoc(mirrorRef);
        if (cancelled) return;
        if (!snap.exists()) {
          const preview = getJobMediaPreviewUrl(p);
          await setDoc(
            mirrorRef,
            buildNewJobLegacyPhotoMirrorDocument({
              companyId,
              jobId,
              jobDisplayName: jn,
              photoId: p.id,
              userId:
                typeof p.createdBy === "string" && p.createdBy
                  ? p.createdBy
                  : user.uid,
              fileName: p.fileName || p.name || p.id,
              fileType: inferJobMediaItemType(p),
              mimeType: null,
              fileUrl: preview,
              storagePath:
                (typeof p.storagePath === "string" && p.storagePath) ||
                (typeof p.path === "string" && p.path) ||
                null,
              note: typeof p.note === "string" ? p.note : null,
            }),
            { merge: true }
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    photosSorted,
    firestore,
    companyId,
    jobId,
    user?.uid,
    jobDisplayName,
    mediaScope,
  ]);

  if (!firestore || !user) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Pro práci s fotkami se přihlaste.
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <>
      <Card
        className={cn(
          "bg-surface border-border overflow-hidden",
          isJobDetailWide && "w-full min-w-0"
        )}
      >
        <Collapsible open={mediaGalleryOpen} onOpenChange={setMediaGalleryOpen}>
          <CardHeader className="space-y-3 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 text-left hover:bg-muted/50"
                >
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                      mediaGalleryOpen && "rotate-180"
                    )}
                    aria-hidden
                  />
                  <ImagePlus className="h-5 w-5 shrink-0 text-primary" />
                  <span
                    id="job-media-heading"
                    className="min-w-0 truncate text-base font-semibold text-gray-900 sm:text-lg"
                  >
                    Fotodokumentace a složky
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-gray-700 sm:text-sm">
                    {photosSortedForUi.length} souborů
                    {foldersSortedForUi.length > 0
                      ? ` · ${foldersSortedForUi.length} složek`
                      : ""}
                  </span>
                </button>
              </CollapsibleTrigger>
              <div className="flex shrink-0 flex-wrap gap-2">
              {canManageFolders && !hideJobMediaAdminUi && user ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setImportFromJobOpen(true)}
                >
                  <Files className="h-4 w-4" aria-hidden />
                  Importovat soubory z jiné zakázky
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setMediaGalleryOpen((o) => !o)}
              >
                {mediaGalleryOpen ? "Sbalit" : "Rozbalit"}
              </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {mediaScope !== "employeeLimited" && mediaScope !== "customer" ? (
                <>
                  <input
                    ref={galleryRef}
                    type="file"
                    accept={JOB_MEDIA_ACCEPT_ATTR}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []).filter(
                        (f) => f && f.size > 0
                      );
                      e.target.value = "";
                      if (!files.length) {
                        toast({
                          variant: "destructive",
                          title: "Žádný soubor",
                        });
                        return;
                      }
                      void (async () => {
                        for (const f of files) {
                          if (!isAllowedJobMediaFile(f)) {
                            toast({
                              variant: "destructive",
                              title: "Přeskočeno",
                              description: `${f.name} — nepodporovaný formát (viz povolené typy).`,
                            });
                            continue;
                          }
                          try {
                            await uploadLegacyPhoto(f, {
                              skipUploadingFlag: true,
                            });
                          } catch (err) {
                            console.error(err);
                          }
                        }
                      })();
                    }}
                  />
                  <Button
                    type="button"
                    className="min-h-[44px] flex-1 gap-2 sm:min-w-[140px] sm:flex-none"
                    disabled={legacyUploading}
                    onClick={() => galleryRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Nahrát soubor
                  </Button>
                  <input
                    ref={cameraRef}
                    type="file"
                    accept={JOB_IMAGE_ACCEPT_ATTR}
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) {
                        toast({
                          variant: "destructive",
                          title: "Nebyla pořízena fotografie",
                        });
                        return;
                      }
                      if (!isAllowedJobImageFile(file)) {
                        toast({
                          variant: "destructive",
                          title: "Nepodporovaný formát",
                        });
                        return;
                      }
                      void uploadLegacyPhoto(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] flex-1 gap-2 sm:min-w-[140px] sm:flex-none"
                    disabled={legacyUploading}
                    onClick={() => cameraRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    Vyfotit
                  </Button>
                </>
              ) : null}
              {canManageFolders && mediaScope !== "customer" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] gap-2 sm:min-w-[140px]"
                  onClick={() => setNewFolderOpen(true)}
                >
                  <FolderPlus className="h-4 w-4" />
                  Nová složka
                </Button>
              ) : null}
            </div>
            {legacyUploading ? (
              <p className="text-sm text-muted-foreground">Nahrávání…</p>
            ) : null}
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-0 pt-0">
              <div
                className={cn(
                  JOB_MEDIA_LIST_SCROLL_CLASS,
                  "space-y-5 rounded-md border border-border/40 bg-muted/5 p-3 sm:p-4"
                )}
              >
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Základní fotodokumentace
                  </h3>
                  {photosSortedForUi.length > 0 ? (
                    <>
                      <div className={JOB_MEDIA_CARD_GRID_CLASS}>
                        {visibleLegacyPhotos.map((p) => {
                  const kind = inferJobMediaItemType(p);
                  const openUrl = getJobMediaPreviewUrl(p);
                  const title = p.fileName || p.name || p.id;
                  const dateLine = buildJobMediaCardDateLine(p, {
                    uploaderFallback: authorDisplayName,
                  });
                  const hasNote = !!p.note?.trim();
                  const showLegacyInternalNote = mediaScope !== "customer" && hasNote;
                  const legacyFileDrawingNotes =
                    kind === "image" || kind === "pdf"
                      ? legacyDrawingNotesFor(p.id, p as unknown as Record<string, unknown>)
                      : [];
                  const legacyFileDrawingPreview =
                    legacyFileDrawingNotes.length > 0
                      ? legacyFileDrawingNotes[legacyFileDrawingNotes.length - 1]?.text
                      : null;
                  const legacyMediaApprovalSummary =
                    mediaScope !== "customer"
                      ? parseJobMediaApproval(p as unknown as Record<string, unknown>)
                      : null;

                  if (
                    mediaScope !== "customer" &&
                    isJobDetailWide &&
                    (kind === "pdf" || kind === "office" || kind === "csv")
                  ) {
                    return null;
                  }

                  if (
                    kind === "pdf" ||
                    kind === "office" ||
                    kind === "csv" ||
                    kind === "archive"
                  ) {
                    return (
                      <JobMediaFileCard
                        key={p.id}
                        borderClassName={
                          kind === "office"
                            ? "border-dashed border-blue-500/30"
                            : kind === "csv"
                              ? "border-dashed border-emerald-600/35"
                              : kind === "archive"
                                ? "border-dashed border-amber-600/35"
                                : "border-dashed border-red-500/30"
                        }
                        preview={
                          kind === "office" ? (
                            <JobMediaOfficePreview />
                          ) : kind === "csv" ? (
                            <JobMediaCsvPreview />
                          ) : kind === "archive" ? (
                            <JobMediaArchivePreview />
                          ) : (
                            <JobMediaPdfPreview />
                          )
                        }
                        title={title}
                        dateLine={dateLine}
                        note={mediaScope === "customer" ? undefined : p.note}
                        hasNote={showLegacyInternalNote}
                        customerNotesPreview={kind === "pdf" ? legacyFileDrawingPreview : null}
                        drawingNotesCount={kind === "pdf" ? legacyFileDrawingNotes.length : 0}
                        onOpenDrawingNotes={
                          kind === "pdf"
                            ? () => {
                                setLegacyDrawingNotesTarget({
                                  fileId: p.id,
                                  folderId: null,
                                  fileName: title,
                                  legacyRow: p as unknown as Record<string, unknown>,
                                });
                                setLegacyDrawingNotesOpen(true);
                              }
                            : undefined
                        }
                        mediaApprovalSummary={legacyMediaApprovalSummary}
                        onResendApprovalEmail={
                          legacyMediaApprovalSummary?.requiresCustomerApproval
                            ? () =>
                                openMediaApprovalDialog({
                                  target: { kind: "photos", photoId: p.id },
                                  fileLabel: title,
                                  row: p as unknown as Record<string, unknown>,
                                })
                            : undefined
                        }
                        resendApprovalBusy={false}
                        actions={
                          <>
                            {renderLegacyExportNotesButtons(
                              p as unknown as Record<string, unknown> & { id: string },
                              title
                            )}
                            <JobMediaIconButton
                              label="Otevřít v novém okně"
                              disabled={!openUrl}
                              onClick={() => {
                                if (openUrl)
                                  window.open(
                                    openUrl,
                                    "_blank",
                                    "noopener,noreferrer"
                                  );
                              }}
                            >
                              <ExternalLink className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                            {kind === "pdf" ? (
                              <JobMediaIconButton
                                label="Celá obrazovka"
                                disabled={!openUrl}
                                onClick={() => {
                                  if (openUrl) openLegacyMediaViewer(p, openUrl, title);
                                }}
                              >
                                <Eye className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                            ) : null}
                            {openUrl ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className={jobMediaIconBtnClassName}
                                    asChild
                                  >
                                    <a
                                      href={openUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Download className="size-[18px]" aria-hidden />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                  Otevřít v prohlížeči
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <JobMediaIconButton label="Otevřít" disabled>
                                <Download className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                            )}
                            {!hideJobMediaAdminUi ? (
                              <>
                                {kind !== "office" ? (
                                  <JobMediaIconButton
                                    label="Schválení zákazníkem"
                                    onClick={() =>
                                      openMediaApprovalDialog({
                                        target: { kind: "photos", photoId: p.id },
                                        fileLabel: title,
                                        row: p as unknown as Record<string, unknown>,
                                      })
                                    }
                                  >
                                    <UserCheck className="size-[18px]" aria-hidden />
                                  </JobMediaIconButton>
                                ) : null}
                                <JobMediaIconButton
                                  label="Smazat soubor"
                                  className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => void deleteLegacyPhoto(p)}
                                >
                                  <Trash2 className="size-[18px]" aria-hidden />
                                </JobMediaIconButton>
                              </>
                            ) : null}
                          </>
                        }
                      />
                    );
                  }

                  return (
                    <JobMediaFileCard
                      key={p.id}
                      borderClassName="border-border/55"
                      preview={
                        isJobDetailWide ? (
                          <ImageThumbWithQuickActions
                            busy={legacyUploading}
                            canManage={
                              canManageFolders && !hideJobMediaAdminUi
                            }
                            onPreview={() => {
                              if (openUrl) openLegacyMediaViewer(p, openUrl, title);
                            }}
                            onDelete={() => void deleteLegacyPhoto(p)}
                          >
                            <MediaThumb row={p} alt={title} />
                          </ImageThumbWithQuickActions>
                        ) : (
                          <MediaThumb row={p} alt={title} />
                        )
                      }
                      title={title}
                      dateLine={dateLine}
                      note={mediaScope === "customer" ? undefined : p.note}
                      hasNote={showLegacyInternalNote}
                      customerNotesPreview={legacyFileDrawingPreview}
                      drawingNotesCount={legacyFileDrawingNotes.length}
                      onOpenDrawingNotes={() => {
                        setLegacyDrawingNotesTarget({
                          fileId: p.id,
                          folderId: null,
                          fileName: title,
                          legacyRow: p as unknown as Record<string, unknown>,
                        });
                        setLegacyDrawingNotesOpen(true);
                      }}
                      mediaApprovalSummary={legacyMediaApprovalSummary}
                      onResendApprovalEmail={
                        legacyMediaApprovalSummary?.requiresCustomerApproval
                          ? () =>
                              openMediaApprovalDialog({
                                target: { kind: "photos", photoId: p.id },
                                fileLabel: title,
                                row: p as unknown as Record<string, unknown>,
                              })
                          : undefined
                      }
                      resendApprovalBusy={false}
                      actions={
                        <>
                          {renderLegacyExportNotesButtons(
                            p as unknown as Record<string, unknown> & { id: string },
                            title
                          )}
                          <JobMediaIconButton
                            label="Náhled"
                            disabled={!openUrl}
                            onClick={() => {
                              if (openUrl) openLegacyMediaViewer(p, openUrl, title);
                            }}
                          >
                            <Eye className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                          {!hideJobMediaAdminUi ? (
                            <JobMediaIconButton
                              label="Anotovat"
                              onClick={() =>
                                onAnnotatePhoto({
                                  id: p.id,
                                  imageUrl: p.imageUrl,
                                  url: p.url,
                                  downloadURL: p.downloadURL,
                                  originalImageUrl: p.originalImageUrl,
                                  annotatedImageUrl: p.annotatedImageUrl,
                                  storagePath: p.storagePath,
                                  path: p.path,
                                  fullPath: p.fullPath,
                                  fileName: p.fileName,
                                  name: p.name,
                                  fileType: inferJobMediaItemType(p),
                                  annotationData: p.annotationData,
                                  annotationTarget: { kind: "photos" },
                                })
                              }
                            >
                              <Pencil className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          ) : null}
                          {openUrl ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className={jobMediaIconBtnClassName}
                                  asChild
                                >
                                  <a
                                    href={openUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Download className="size-[18px]" aria-hidden />
                                  </a>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">
                                Otevřít v prohlížeči
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <JobMediaIconButton label="Otevřít" disabled>
                              <Download className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          )}
                          {!hideJobMediaAdminUi ? (
                            <>
                              <JobMediaIconButton
                                label="Schválení zákazníkem"
                                onClick={() =>
                                  openMediaApprovalDialog({
                                    target: { kind: "photos", photoId: p.id },
                                    fileLabel: title,
                                    row: p as unknown as Record<string, unknown>,
                                  })
                                }
                              >
                                <UserCheck className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                              <JobMediaIconButton
                                label="Smazat soubor"
                                className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void deleteLegacyPhoto(p)}
                              >
                                <Trash2 className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                            </>
                          ) : null}
                        </>
                      }
                    />
                  );
                })}
              </div>
                      {mediaScope !== "customer" && isJobDetailWide && legacyDocPhotos.length > 0 ? (
                        <div className="space-y-2 border-t border-border/50 pt-3">
                          {legacyDocPhotos.map((p) => {
                            const kind = inferJobMediaItemType(p);
                            const openUrl = getJobMediaPreviewUrl(p);
                            const title = p.fileName || p.name || p.id;
                            const dateLine = buildJobMediaCardDateLine(p, {
                              uploaderFallback: authorDisplayName,
                            });
                            return (
                              <MediaCompactDocRow
                                key={p.id}
                                icon={
                                  kind === "archive" ? (
                                    <Archive className="h-6 w-6 text-amber-800" strokeWidth={1.5} />
                                  ) : kind === "office" ? (
                                    <FileText className="h-6 w-6 text-blue-700" strokeWidth={1.5} />
                                  ) : (
                                    <FileText className="h-6 w-6 text-red-600" strokeWidth={1.5} />
                                  )
                                }
                                title={title}
                                dateLine={dateLine}
                                actions={
                                  <>
                                    {renderLegacyExportNotesButtons(
                                      p as unknown as Record<string, unknown> & { id: string },
                                      title
                                    )}
                                    <JobMediaIconButton
                                      label="Otevřít"
                                      disabled={!openUrl}
                                      onClick={() => {
                                        if (openUrl)
                                          window.open(openUrl, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      <ExternalLink className="size-[18px]" aria-hidden />
                                    </JobMediaIconButton>
                                    {kind === "pdf" ? (
                                      <JobMediaIconButton
                                        label="Celá obrazovka"
                                        disabled={!openUrl}
                                        onClick={() => {
                                          if (openUrl) openLegacyMediaViewer(p, openUrl, title);
                                        }}
                                      >
                                        <Eye className="size-[18px]" aria-hidden />
                                      </JobMediaIconButton>
                                    ) : null}
                                    {openUrl ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            className={jobMediaIconBtnClassName}
                                            asChild
                                          >
                                            <a
                                              href={openUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              <Download className="size-[18px]" aria-hidden />
                                            </a>
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="text-xs">
                                          Otevřít v prohlížeči
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : null}
                                    {!hideJobMediaAdminUi ? (
                                      <>
                                        {kind !== "office" ? (
                                          <JobMediaIconButton
                                            label="Schválení zákazníkem"
                                            onClick={() =>
                                              openMediaApprovalDialog({
                                                target: { kind: "photos", photoId: p.id },
                                                fileLabel: title,
                                                row: p as unknown as Record<string, unknown>,
                                              })
                                            }
                                          >
                                            <UserCheck className="size-[18px]" aria-hidden />
                                          </JobMediaIconButton>
                                        ) : null}
                                        <JobMediaIconButton
                                          label="Smazat"
                                          className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                          onClick={() => void deleteLegacyPhoto(p)}
                                        >
                                          <Trash2 className="size-[18px]" aria-hidden />
                                        </JobMediaIconButton>
                                      </>
                                    ) : null}
                                  </>
                                }
                              />
                            );
                          })}
                        </div>
                      ) : null}
                      {photosSortedForUi.length > JOB_MEDIA_INITIAL_COUNT ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full text-muted-foreground"
                          onClick={() => setShowAllLegacyPhotos((v) => !v)}
                        >
                          {showAllLegacyPhotos
                            ? "Zobrazit méně"
                            : `Zobrazit více (${photosSortedForUi.length - JOB_MEDIA_INITIAL_COUNT} dalších)`}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {mediaScope === "customer"
                        ? "Pro tuto zakázku zatím nejsou zpřístupněné žádné dokumenty."
                        : "Zatím žádné soubory ve fotodokumentaci."}
                    </p>
                  )}
                </section>

                {foldersSortedForUi.length > 0 ? (
                  <section className="space-y-3 border-t border-border/50 pt-4">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Vlastní složky
                    </h3>
                    <div className="space-y-3">
                      {foldersSortedForUi.map((folder) => (
                        <UserFolderBlock
                          key={folder.id}
                          folder={folder}
                          companyId={companyId}
                          jobId={jobId}
                          jobDisplayName={jobDisplayName ?? null}
                          firestore={firestore}
                          user={user}
                          canManageFolders={canManageFolders}
                          onAnnotatePhoto={onAnnotatePhoto}
                          onNoteDialogOpen={openNoteEditor}
                          layout={layout}
                          mediaScope={mediaScope}
                          memberPermissions={memberPermissions}
                          employeeRecordId={employeeRecordId}
                          onOpenMediaApprovalDialog={openMediaApprovalDialog}
                          photoCommentDeepLink={photoCommentDeepLink}
                          onPhotoCommentDeepLinkConsumed={onPhotoCommentDeepLinkConsumed}
                          mediaNotesAll={mediaNotesAll}
                          onMediaNoteAdded={handleMediaNoteAdded}
                          authorDisplayName={authorDisplayName}
                          emailPresets={folderEmailPresetsForBlocks}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-md text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Nová složka</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-gray-900">Název</Label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Název složky"
                className="min-h-[44px] bg-background text-gray-900"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-900">Typ složky</Label>
              <Select
                value={newFolderType}
                onValueChange={(v) => setNewFolderType(v as JobFolderType)}
              >
                <SelectTrigger className="min-h-[44px] bg-background text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="photos">Fotodokumentace</SelectItem>
                  <SelectItem value="documents">Doklady / účetní</SelectItem>
                  <SelectItem value="files">Obecné soubory</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={creatingFolder || !newFolderName.trim()}
              onClick={() => void createFolder()}
            >
              Vytvořit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Poznámka k souboru</DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Text poznámky…"
            rows={5}
            className="min-h-[120px]"
          />
          <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNoteDraft("");
              }}
            >
              Vymazat text
            </Button>
            <Button type="button" variant="outline" onClick={() => setNoteOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={noteSaving} onClick={() => void saveNote()}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={legacyDrawingNotesOpen} onOpenChange={setLegacyDrawingNotesOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Poznámky k výkresu</DialogTitle>
            <DialogDescription>
              {legacyDrawingNotesTarget?.fileName?.trim() || "Soubor"} — historie a nová poznámka.
            </DialogDescription>
          </DialogHeader>
          {legacyDrawingNotesTarget && user ? (
            <JobMediaFileNotesPanel
              firestore={firestore}
              companyId={companyId}
              jobId={jobId}
              userId={user.uid}
              authorName={authorDisplayName}
              target={legacyDrawingNotesTarget}
              legacyFileRow={legacyDrawingNotesTarget.legacyRow}
              allNotes={mediaNotesAll}
              customerPortal={mediaScope === "customer"}
              onNoteAdded={handleMediaNoteAdded}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {firestore && user && mediaApprovalDlg ? (
        <MediaApprovalRequestDialog
          open={!!mediaApprovalDlg}
          onOpenChange={(v) => {
            if (!v) setMediaApprovalDlg(null);
          }}
          firestore={firestore}
          companyId={companyId}
          jobId={jobId}
          adminUid={user.uid}
          jobRecord={jobRecord}
          target={mediaApprovalDlg.target}
          fileLabel={mediaApprovalDlg.fileLabel}
          initialRequires={mediaApprovalDlg.initialRequires}
          initialAdminNote={mediaApprovalDlg.initialAdminNote}
          initialApprovalEmailSent={mediaApprovalDlg.initialApprovalEmailSent}
          onApplied={() => setMediaApprovalDlg(null)}
        />
      ) : null}

      {user && canManageFolders && !hideJobMediaAdminUi && importFromJobOpen ? (
        <JobImportFilesFromJobDialog
          open={importFromJobOpen}
          onOpenChange={setImportFromJobOpen}
          companyId={companyId}
          targetJobId={jobId}
          jobDisplayName={jobDisplayName}
          user={user}
          jobs={jobsForImport as Record<string, unknown>[]}
          customersById={customersByIdForImport}
        />
      ) : null}
      </>
    </TooltipProvider>
  );
}
