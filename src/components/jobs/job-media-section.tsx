"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
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
import { getFirebaseStorage } from "@/firebase/storage";
import {
  uploadJobFolderImageFileViaFirebaseSdk,
} from "@/lib/job-photo-upload";
import {
  formatMediaDate,
  getJobMediaPreviewUrl,
  jobMediaHasFlattenedAdminExport,
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
  canCustomerAnnotateImage,
  canCustomerAnnotateLegacyPhoto,
  filterFoldersForCustomer,
  isImageCustomerVisible,
  isLegacyPhotoCustomerVisible,
} from "@/lib/job-customer-access";
import { CustomerMediaAnnotationViewer } from "@/components/jobs/customer-media-annotation-viewer";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Camera,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderPlus,
  ImagePlus,
  Pencil,
  StickyNote,
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
}: {
  icon: React.ReactNode;
  title: string;
  dateLine: string;
  actions: React.ReactNode;
}) {
  return (
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm sm:gap-4">
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

function JobMediaApprovalAdminSummary({ a }: { a: ParsedJobMediaApproval }) {
  if (!a.requiresCustomerApproval) return null;
  const st = a.approvalStatus;
  return (
    <div className="space-y-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-[11px] leading-snug">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="text-[10px] font-medium">
          Schválení zákazníkem
        </Badge>
        <Badge
          className={cn(
            "text-[10px] font-medium",
            st === "approved" && "bg-emerald-600 hover:bg-emerald-600",
            st === "changes_requested" && "bg-amber-600 hover:bg-amber-600",
            st === "pending" && "bg-slate-600 hover:bg-slate-600"
          )}
        >
          {approvalStatusLabelCs(st)}
        </Badge>
      </div>
      {a.approvalNoteFromAdmin ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Poznámka k žádosti: </span>
          {a.approvalNoteFromAdmin}
        </p>
      ) : null}
      {a.customerComment ? (
        <p className="text-amber-900 dark:text-amber-200">
          <span className="font-medium">Připomínka zákazníka: </span>
          {a.customerComment}
        </p>
      ) : null}
      {a.approvalRequestedAtMs ? (
        <p className="text-[10px] text-muted-foreground">
          Žádost odeslána: {new Date(a.approvalRequestedAtMs).toLocaleString("cs-CZ")}
        </p>
      ) : null}
      {a.approvedAtMs ? (
        <p className="text-[10px] text-muted-foreground">
          Schváleno zákazníkem: {new Date(a.approvedAtMs).toLocaleString("cs-CZ")}
        </p>
      ) : null}
      {a.customerCommentAtMs && st === "changes_requested" ? (
        <p className="text-[10px] text-muted-foreground">
          Připomínka odeslána: {new Date(a.customerCommentAtMs).toLocaleString("cs-CZ")}
        </p>
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
        {hasNote ? (
          <span
            className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-white"
            title="Má poznámku"
          >
            📝
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
          <JobMediaApprovalAdminSummary a={mediaApprovalSummary} />
        ) : null}
        {note?.trim() ? (
          <p className="line-clamp-2 text-[11px] leading-snug text-foreground/88">
            {note.trim()}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-start gap-2 border-t border-border/45 pt-2">
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
}) {
  const { toast } = useToast();
  const actorRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: actorProfile } = useDoc(actorRef);
  const [busy, setBusy] = useState(false);
  type FolderMediaViewerOpen = {
    url: string;
    title: string;
    fileType: "image" | "pdf";
    mediaDocumentId: string;
    annotationData?: unknown;
    readOnly: boolean;
    adminNote?: string;
  };
  const [mediaViewer, setMediaViewer] = useState<FolderMediaViewerOpen | null>(null);

  const openFolderMediaViewer = useCallback(
    (img: JobFolderImageDoc, openUrl: string, title: string) => {
      const kind = inferJobMediaItemType(img);
      if (kind === "office") {
        if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
        return;
      }
      const fileType = kind === "pdf" ? "pdf" : "image";
      const readOnlyCustomer =
        mediaScope === "customer" &&
        !canCustomerAnnotateImage(
          folder as Record<string, unknown>,
          img as Record<string, unknown>
        );
      const skipVectorLayer =
        fileType === "image" && jobMediaHasFlattenedAdminExport(img);
      setMediaViewer({
        url: openUrl,
        title,
        fileType,
        mediaDocumentId: img.id,
        annotationData: skipVectorLayer ? undefined : img.annotationData,
        readOnly: readOnlyCustomer,
        adminNote: typeof img.note === "string" ? img.note : "",
      });
    },
    [folder, mediaScope]
  );
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const folderType: JobFolderType = folder.type ?? "files";
  const isEmployeeLimited = mediaScope === "employeeLimited";
  const isCustomerScope = mediaScope === "customer";
  /** Mazání, poznámky, anotace v seznamu souborů — ne pro zákaznický portál. */
  const allowFolderStaffFileActions = !isEmployeeLimited && !isCustomerScope;
  const isAccountingFolder =
    folderType === "documents" && !isEmployeeLimited && !isCustomerScope;
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

  const images = useMemo(() => {
    const list = (imagesRaw || []) as JobFolderImageDoc[];
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
    if (!isCustomerScope) return images;
    return images.filter((img) =>
      isImageCustomerVisible(folder as Record<string, unknown>, img as Record<string, unknown>)
    );
  }, [images, isCustomerScope, folder]);

  const [folderOpen, setFolderOpen] = useState(false);
  const [showAllInFolder, setShowAllInFolder] = useState(false);
  const visibleFolderImages = useMemo(() => {
    if (showAllInFolder || imagesForUi.length <= JOB_MEDIA_INITIAL_COUNT) return imagesForUi;
    return imagesForUi.slice(0, JOB_MEDIA_INITIAL_COUNT);
  }, [imagesForUi, showAllInFolder]);

  const isFolderWide = layout === "jobDetailWide";
  const folderDocImages = useMemo(
    () =>
      visibleFolderImages.filter((img) => {
        const k = inferJobMediaItemType(img);
        return k === "pdf" || k === "office";
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
      : true);

  const persistFolderEmployeeFlags = async (patch: {
    employeeVisible: boolean;
    allowEmployeeUpload: boolean;
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
          /** Legacy (zpětná kompatibilita během přechodu) */
          employeeUploadAllowed: patch.allowEmployeeUpload,
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
    }
  ) => {
    if (!isAllowedJobMediaFile(file)) {
      toast({
        variant: "destructive",
        title: "Nepodporovaný formát",
        description: "Pouze JPG, PNG, WEBP, PDF nebo Office (DOC, XLS, PPT…).",
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

    const actorRole =
      typeof (actorProfile as { role?: unknown } | null | undefined)?.role === "string"
        ? String((actorProfile as { role: string }).role)
        : "employee";
    const allowEmployeeUpload =
      (folder as { allowEmployeeUpload?: unknown }).allowEmployeeUpload === true ||
      (folder as { employeeUploadAllowed?: unknown }).employeeUploadAllowed === true;
    console.log("UPLOAD CHECK", { role: actorRole, allowEmployeeUpload });

    const safeBaseName =
      file.name.replace(/^.*[\\/]/, "").replace(/\s+/g, " ").trim() || "photo";
    const fileType = getJobMediaFileTypeFromFile(file);

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
        });
      } else {
        const expenseFt: JobExpenseFileType = fileType;
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
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Bez zaškrtnutí „Viditelné zaměstnanci“ je složka jen pro interní
                přístup (výchozí u starších dat).
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
                Bez „Viditelné zákazníkovi“ zákazník složku neuvidí. Účetní složky typu Doklady se v klientském
                portálu nezobrazují.
              </p>
            </div>
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
                        description: "Pouze JPG, PNG, WEBP, PDF nebo Office.",
                      });
                      return;
                    }
                    openAccountingForFiles(ok);
                    return;
                  }
                  setBusy(true);
                  void (async () => {
                    for (const f of files) {
                      try {
                        await uploadOne(f);
                      } catch (err) {
                        console.error(err);
                        toast({
                          variant: "destructive",
                          title: "Nahrání selhalo",
                          description: f.name,
                        });
                      }
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
              const dateLine =
                kind === "pdf"
                  ? `PDF · ${formatMediaDate(img.createdAt)}`
                  : kind === "office"
                    ? `Office · ${formatMediaDate(img.createdAt)}`
                    : formatMediaDate(img.createdAt);
              const hasNote = !!img.note?.trim();
              const mediaApprovalSummary =
                !isCustomerScope
                  ? parseJobMediaApproval(img as unknown as Record<string, unknown>)
                  : null;

                  if (!isCustomerScope && isFolderWide && (kind === "pdf" || kind === "office")) {
                return null;
              }

              if (kind === "pdf" || kind === "office") {
                return (
                  <JobMediaFileCard
                    key={img.id}
                    borderClassName={
                      kind === "office"
                        ? "border-dashed border-blue-500/30"
                        : "border-dashed border-red-500/30"
                    }
                    preview={
                      kind === "office" ? (
                        <JobMediaOfficePreview />
                      ) : (
                        <JobMediaPdfPreview />
                      )
                    }
                    title={title}
                    dateLine={dateLine}
                    note={img.note}
                    hasNote={hasNote}
                    mediaApprovalSummary={mediaApprovalSummary}
                    actions={
                      <>
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
                              if (openUrl) openFolderMediaViewer(img, openUrl, title);
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
                                  download={title}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Download className="size-[18px]" aria-hidden />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Stáhnout
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <JobMediaIconButton label="Stáhnout" disabled>
                            <Download className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
                        )}
                        {allowFolderStaffFileActions ? (
                          <>
                            <JobMediaIconButton
                              label="Poznámka"
                              onClick={() =>
                                onNoteDialogOpen({
                                  path: {
                                    kind: "folderImages",
                                    folderId: folder.id,
                                  },
                                  imageId: img.id,
                                  currentNote: img.note || "",
                                  fileNameHint: title,
                                })
                              }
                            >
                              <StickyNote className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                            {!isCustomerScope &&
                            onOpenMediaApprovalDialog &&
                            kind !== "office" ? (
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
                  note={img.note}
                  hasNote={hasNote}
                  mediaApprovalSummary={mediaApprovalSummary}
                  actions={
                    <>
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
                                download={title}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Download className="size-[18px]" aria-hidden />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            Stáhnout
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <JobMediaIconButton label="Stáhnout" disabled>
                          <Download className="size-[18px]" aria-hidden />
                        </JobMediaIconButton>
                      )}
                      {allowFolderStaffFileActions ? (
                        <>
                          <JobMediaIconButton
                            label="Poznámka"
                            onClick={() =>
                              onNoteDialogOpen({
                                path: {
                                  kind: "folderImages",
                                  folderId: folder.id,
                                },
                                imageId: img.id,
                                currentNote: img.note || "",
                                fileNameHint: title,
                              })
                            }
                          >
                            <StickyNote className="size-[18px]" aria-hidden />
                          </JobMediaIconButton>
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
                const dateLine =
                  kind === "pdf"
                    ? `PDF · ${formatMediaDate(img.createdAt)}`
                    : `Office · ${formatMediaDate(img.createdAt)}`;
                return (
                  <MediaCompactDocRow
                    key={img.id}
                    icon={
                      kind === "office" ? (
                        <FileText className="h-6 w-6 text-blue-700" strokeWidth={1.5} />
                      ) : (
                        <FileText className="h-6 w-6 text-red-600" strokeWidth={1.5} />
                      )
                    }
                    title={title}
                    dateLine={dateLine}
                    actions={
                      <>
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
                                  download={title}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Download className="size-[18px]" aria-hidden />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              Stáhnout
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {allowFolderStaffFileActions ? (
                          <>
                            <JobMediaIconButton
                              label="Poznámka"
                              onClick={() =>
                                onNoteDialogOpen({
                                  path: {
                                    kind: "folderImages",
                                    folderId: folder.id,
                                  },
                                  imageId: img.id,
                                  currentNote: img.note || "",
                                  fileNameHint: title,
                                })
                              }
                            >
                              <StickyNote className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
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

    {firestore && user && mediaViewer ? (
      <CustomerMediaAnnotationViewer
        key={mediaViewer.mediaDocumentId}
        open={!!mediaViewer}
        onClose={() => setMediaViewer(null)}
        companyId={companyId}
        jobId={jobId}
        firestore={firestore}
        userId={user.uid}
        actorRole={
          typeof (actorProfile as { role?: string })?.role === "string"
            ? (actorProfile as { role: string }).role
            : ""
        }
        mediaUrl={mediaViewer.url}
        title={mediaViewer.title}
        fileType={mediaViewer.fileType}
        readOnly={mediaViewer.readOnly}
        storagePath={{ kind: "folderImages", folderId: folder.id }}
        mediaDocumentId={mediaViewer.mediaDocumentId}
        embeddedAnnotationData={mediaViewer.annotationData}
        adminNote={mediaViewer.adminNote}
      />
    ) : null}
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
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderType, setNewFolderType] = useState<JobFolderType>("files");
  const [creatingFolder, setCreatingFolder] = useState(false);

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
  } | null>(null);

  const openMediaApprovalDialog = useCallback(
    (ctx: { target: JobMediaRef; fileLabel: string; row: Record<string, unknown> }) => {
      const pr = parseJobMediaApproval(ctx.row);
      setMediaApprovalDlg({
        target: ctx.target,
        fileLabel: ctx.fileLabel,
        initialRequires: pr.requiresCustomerApproval,
        initialAdminNote: pr.approvalNoteFromAdmin,
      });
    },
    []
  );

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  type LegacyMediaViewerOpen = {
    url: string;
    title: string;
    fileType: "image" | "pdf";
    mediaDocumentId: string;
    annotationData?: unknown;
    readOnly: boolean;
    adminNote?: string;
  };
  const [legacyMediaViewer, setLegacyMediaViewer] = useState<LegacyMediaViewerOpen | null>(null);

  const openLegacyMediaViewer = useCallback(
    (p: LegacyPhotoDoc, openUrl: string, title: string) => {
      const kind = inferJobMediaItemType(p);
      if (kind === "office") {
        if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
        return;
      }
      const fileType = kind === "pdf" ? "pdf" : "image";
      const readOnly =
        mediaScope === "customer" &&
        !canCustomerAnnotateLegacyPhoto(p as Record<string, unknown>);
      const skipVectorLayer =
        fileType === "image" && jobMediaHasFlattenedAdminExport(p);
      setLegacyMediaViewer({
        url: openUrl,
        title,
        fileType,
        mediaDocumentId: p.id,
        annotationData: skipVectorLayer ? undefined : p.annotationData,
        readOnly,
        adminNote: typeof p.note === "string" ? p.note : "",
      });
    },
    [mediaScope]
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

  const foldersSorted = useMemo(() => {
    const list = (foldersRaw || []).filter(
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
    const list = (photos || []).filter((p) => p?.id);
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
        return k === "pdf" || k === "office";
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
                              description: `${f.name} — pouze JPG, PNG, WEBP, PDF nebo Office.`,
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
                  const dateLine =
                    kind === "pdf"
                      ? `PDF · ${formatMediaDate(p.createdAt)}`
                      : kind === "office"
                        ? `Office · ${formatMediaDate(p.createdAt)}`
                        : formatMediaDate(p.createdAt);
                  const hasNote = !!p.note?.trim();
                  const legacyMediaApprovalSummary =
                    mediaScope !== "customer"
                      ? parseJobMediaApproval(p as unknown as Record<string, unknown>)
                      : null;

                  if (mediaScope !== "customer" && isJobDetailWide && (kind === "pdf" || kind === "office")) {
                    return null;
                  }

                  if (kind === "pdf" || kind === "office") {
                    return (
                      <JobMediaFileCard
                        key={p.id}
                        borderClassName={
                          kind === "office"
                            ? "border-dashed border-blue-500/30"
                            : "border-dashed border-red-500/30"
                        }
                        preview={
                          kind === "office" ? (
                            <JobMediaOfficePreview />
                          ) : (
                            <JobMediaPdfPreview />
                          )
                        }
                        title={title}
                        dateLine={dateLine}
                        note={p.note}
                        hasNote={hasNote}
                        mediaApprovalSummary={legacyMediaApprovalSummary}
                        actions={
                          <>
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
                                      download={title}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Download className="size-[18px]" aria-hidden />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                  Stáhnout
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <JobMediaIconButton label="Stáhnout" disabled>
                                <Download className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
                            )}
                            {!hideJobMediaAdminUi ? (
                              <>
                                <JobMediaIconButton
                                  label="Poznámka"
                                  onClick={() =>
                                    openNoteEditor({
                                      path: { kind: "photos" },
                                      imageId: p.id,
                                      currentNote: p.note || "",
                                      fileNameHint: title,
                                    })
                                  }
                                >
                                  <StickyNote className="size-[18px]" aria-hidden />
                                </JobMediaIconButton>
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
                      note={p.note}
                      hasNote={hasNote}
                      mediaApprovalSummary={legacyMediaApprovalSummary}
                      actions={
                        <>
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
                                    download={title}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Download className="size-[18px]" aria-hidden />
                                  </a>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">
                                Stáhnout
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <JobMediaIconButton label="Stáhnout" disabled>
                              <Download className="size-[18px]" aria-hidden />
                            </JobMediaIconButton>
                          )}
                          {!hideJobMediaAdminUi ? (
                            <>
                              <JobMediaIconButton
                                label="Poznámka"
                                onClick={() =>
                                  openNoteEditor({
                                    path: { kind: "photos" },
                                    imageId: p.id,
                                    currentNote: p.note || "",
                                    fileNameHint: title,
                                  })
                                }
                              >
                                <StickyNote className="size-[18px]" aria-hidden />
                              </JobMediaIconButton>
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
                            const dateLine =
                              kind === "pdf"
                                ? `PDF · ${formatMediaDate(p.createdAt)}`
                                : `Office · ${formatMediaDate(p.createdAt)}`;
                            return (
                              <MediaCompactDocRow
                                key={p.id}
                                icon={
                                  kind === "office" ? (
                                    <FileText className="h-6 w-6 text-blue-700" strokeWidth={1.5} />
                                  ) : (
                                    <FileText className="h-6 w-6 text-red-600" strokeWidth={1.5} />
                                  )
                                }
                                title={title}
                                dateLine={dateLine}
                                actions={
                                  <>
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
                                              download={title}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              <Download className="size-[18px]" aria-hidden />
                                            </a>
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="text-xs">
                                          Stáhnout
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : null}
                                    {!hideJobMediaAdminUi ? (
                                      <>
                                        <JobMediaIconButton
                                          label="Poznámka"
                                          onClick={() =>
                                            openNoteEditor({
                                              path: { kind: "photos" },
                                              imageId: p.id,
                                              currentNote: p.note || "",
                                              fileNameHint: title,
                                            })
                                          }
                                        >
                                          <StickyNote className="size-[18px]" aria-hidden />
                                        </JobMediaIconButton>
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

      {firestore && user && legacyMediaViewer ? (
        <CustomerMediaAnnotationViewer
          key={legacyMediaViewer.mediaDocumentId}
          open={!!legacyMediaViewer}
          onClose={() => setLegacyMediaViewer(null)}
          companyId={companyId}
          jobId={jobId}
          firestore={firestore}
          userId={user.uid}
          actorRole={
            typeof (actorProfile as { role?: string })?.role === "string"
              ? (actorProfile as { role: string }).role
              : ""
          }
          mediaUrl={legacyMediaViewer.url}
          title={legacyMediaViewer.title}
          fileType={legacyMediaViewer.fileType}
          readOnly={legacyMediaViewer.readOnly}
          storagePath={{ kind: "photos" }}
          mediaDocumentId={legacyMediaViewer.mediaDocumentId}
          embeddedAnnotationData={legacyMediaViewer.annotationData}
          adminNote={legacyMediaViewer.adminNote}
        />
      ) : null}

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
          onApplied={() => setMediaApprovalDlg(null)}
        />
      ) : null}
      </>
    </TooltipProvider>
  );
}
