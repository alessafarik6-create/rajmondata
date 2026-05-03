"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import {
  ArrowLeft,
  CirclePause,
  CirclePlay,
  ExternalLink,
  Factory,
  FileText,
  ImageIcon,
  Layers,
  Loader2,
  Package,
  Plus,
  Play,
  ZoomIn,
  CheckCircle2,
  Pencil,
  Trash2,
  FileDown,
  Printer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { canAccessCompanyModule } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import { isCompanyPrivileged, normalizeCompanyRole } from "@/lib/company-privilege";
import type { InventoryItemRow } from "@/lib/inventory-types";
import { resolveInventoryItemImageUrl } from "@/lib/inventory-item-image";
import { InventoryItemThumbnail } from "@/components/warehouse/inventory-item-thumbnail";
import Image from "next/image";
import {
  lengthToMillimeters,
  millimetersToUnit,
} from "@/lib/job-production-settings";
import {
  canStartProductionWorkflow,
  parseProductionWorkflowStatus,
} from "@/lib/production-job-workflow";
import {
  filterFoldersForProductionView,
  isJobFileMarkedForProduction,
  isJobImageVisibleInProductionView,
  resolveJobFolderImageDownloadUrl,
  type ProductionFolderRow,
} from "@/lib/job-production-media";
import {
  isMeasurementPhotoUnassignedForJob,
  isMeasurementPhotoVisibleInProduction,
} from "@/lib/measurement-photos";
import {
  CsvMaterialProposalDialog,
  type CsvMaterialDialogSource,
} from "@/components/production/csv-material-proposal-dialog";
import { JobProductionPdfDocumentationPanel } from "@/components/production/job-production-pdf-documentation";
import { ProductionIssuePanelShell } from "@/components/production/production-issue-panel-shell";
import {
  ProductionWorkbenchSplit,
  type ProductionWorkbenchHeights,
} from "@/components/production/production-workbench-split";
import { useStockPiecesSummaries } from "@/hooks/use-stock-pieces-summaries";
import type { StockPiecesSummary } from "@/hooks/use-stock-pieces-summaries";
import { formatMmCs } from "@/lib/stock-pieces-display";
import {
  buildProductionA4WorkListPdf,
  downloadProductionA4WorkListPdf,
  openProductionA4WorkListPdfPrint,
} from "@/lib/production-a4-work-list-pdf";
import {
  PRODUCTION_DRAWING_STATUS_BADGE_CLASS,
  PRODUCTION_DRAWING_STATUS_LABELS,
  type ProductionDrawingStatusDoc,
  type ProductionDrawingStatusValue,
  upsertProductionDrawingStatus,
} from "@/lib/production-drawing-status";
import {
  loadProductionIssueUserLayout,
  readProductionIssueLayoutFromLocalStorage,
  readProductionTopPanelHeightFromLocalStorage,
  saveProductionIssueUserLayout,
  writeProductionIssueLayoutToLocalStorage,
  writeProductionTopPanelHeightToLocalStorage,
} from "@/lib/production-issue-user-layout";
import {
  buildProductionWorksheetPdf,
  downloadProductionWorksheetPdf,
  openProductionWorksheetPdfInNewTab,
  type ProductionWorksheetDrawingRef,
} from "@/lib/production-worksheet-pdf";
import { Checkbox } from "@/components/ui/checkbox";
import { JobMaterialOrdersSection } from "@/components/jobs/job-material-orders-section";

const CARD = "border-slate-200 bg-white text-slate-900";
const DEFAULT_PRODUCTION_WORKBENCH_TOP_PX = 600;
const PRODUCTION_TOP_PANEL_VIEWPORT_RESERVE = 180;
const PRODUCTION_TOP_PANEL_MIN_PX = 420;

/** Kompaktní řádek kusů pro metráž (bez výpisu všech zbytků v kartě). */
function compactLengthStockSummary(sp: StockPiecesSummary | undefined): string | null {
  if (!sp || sp.loading) return null;
  const parts: string[] = [];
  if (sp.full > 0) parts.push(`plné ${sp.full}`);
  if (sp.partial > 0) parts.push(`načaté ${sp.partial}`);
  const sumMm = (sp.partialLengthsMm || []).reduce((a, b) => a + (Number(b) || 0), 0);
  if (sumMm > 0) parts.push(`zbytek ${formatMmCs(sumMm)} mm`);
  return parts.length ? parts.join(" · ") : null;
}

/** Legacy jobs/.../photos — bez nadřazené složky; po job-level legacyPhotosEmployeeVisible řídí viditelnost souboru. */
const LEGACY_JOB_PHOTOS_FOLDER_STUB: ProductionFolderRow = {
  id: "job-photos",
  employeeVisible: true,
  name: "Fotodokumentace u zakázky",
};

type AttachmentKind = "drawing" | "pdf" | "photo" | "other" | "csv";

type JobAttachmentFile = {
  id: string;
  folderId: string;
  folderName: string;
  fileUrl: string;
  fileName: string;
  kind: AttachmentKind;
  createdAt?: unknown;
  uploadedBy?: string;
  uploadedByName?: string;
  /** Složka zakázky / legacy fotky u zakázky / měření */
  mediaSource?: "folder" | "job_legacy" | "measurement";
  /** ID dokumentu ve složce (images/{id}) — pro CSV návrh ve výrobě */
  folderImageDocId?: string;
};

function attachmentKindFromName(name: string, fileTypeHint?: string): AttachmentKind {
  const ft = String(fileTypeHint || "").toLowerCase();
  if (ft === "csv") return "csv";
  const n = String(name || "").toLowerCase();
  if (/\.(csv)(\?|$)/i.test(n)) return "csv";
  if (/\.(pdf)(\?|$)/i.test(n)) return "pdf";
  if (/\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(n)) return "photo";
  if (/\.(dwg|dxf|step|stp|stl|iges|igs|plt)(\?|$)/i.test(n)) return "drawing";
  return "other";
}

/** Náhled zbytku: vlastní obrázek řádky, jinak původní skladová položka. */
function remainderRowHeroThumb(
  row: InventoryItemRow,
  parent: InventoryItemRow | undefined
): Record<string, unknown> | undefined {
  const r = row as unknown as Record<string, unknown>;
  if (resolveInventoryItemImageUrl(r)) return r;
  if (parent) return parent as unknown as Record<string, unknown>;
  return r;
}

function stockModeShortLabel(mode: string | null | undefined): string {
  const m = String(mode || "pieces").toLowerCase();
  if (m === "length") return "Metráž";
  if (m === "area") return "Plocha";
  if (m === "mass") return "Hmotnost";
  if (m === "generic") return "Obecná evidence";
  return "Kusy";
}

function availableStockQtyForIssueForm(i: InventoryItemRow): number {
  const mode = String(i.stockTrackingMode || "pieces");
  if (mode === "length") {
    const cur = i.currentLength;
    if (cur != null && Number.isFinite(Number(cur))) return Number(cur);
  }
  return Number(i.quantity ?? 0);
}

function defaultLengthInputUnit(item: InventoryItemRow | null): "mm" | "cm" | "m" {
  if (!item) return "mm";
  const u = String(item.lengthStockUnit || item.unit || "mm")
    .trim()
    .toLowerCase();
  if (u === "cm" || u === "m" || u === "mm") return u;
  return "mm";
}

function quantityInStockUnits(
  item: InventoryItemRow,
  qtyInput: number,
  inputLengthUnit: "mm" | "cm" | "m" | null
): number | null {
  const mode = String(item.stockTrackingMode || "pieces");
  if (mode !== "length" || !inputLengthUnit) return qtyInput;
  const mm = lengthToMillimeters(qtyInput, inputLengthUnit);
  if (mm == null) return null;
  const stockU = String(item.lengthStockUnit || item.unit || "mm")
    .trim()
    .toLowerCase();
  return millimetersToUnit(mm, stockU);
}

function lengthUnitEditableForItem(item: InventoryItemRow | null | undefined): boolean {
  if (!item || String(item.stockTrackingMode) !== "length") return false;
  const stockU = String(item.lengthStockUnit || item.unit || "mm")
    .trim()
    .toLowerCase();
  return stockU === "mm" || stockU === "cm" || stockU === "m";
}

type IssueQueueLine = {
  key: string;
  itemId: string;
  qtyStr: string;
  /** Počet opakování stejné délky (jen metráž). */
  repeatCountStr: string;
  note: string;
  batchNumber: string;
  inputLengthUnit: "mm" | "cm" | "m" | null;
  /** Klíč PDF řádku (`folderId-id`), nebo null = nepřiřazeno */
  productionDrawingKey?: string | null;
};

function issueLineTotalInStockUnits(item: InventoryItemRow, ln: IssueQueueLine): number | null {
  const q = Number(String(ln.qtyStr).replace(",", "."));
  if (!Number.isFinite(q) || q <= 0) return null;
  let rep = 1;
  if (String(item.stockTrackingMode) === "length") {
    rep = Number(String(ln.repeatCountStr ?? "1").replace(",", "."));
    if (!Number.isFinite(rep) || rep < 1 || Math.floor(rep) !== rep) return null;
  }
  const inputLen = lengthUnitEditableForItem(item) ? ln.inputLengthUnit : null;
  const c = quantityInStockUnits(item, q, inputLen);
  if (c == null || !Number.isFinite(c)) return null;
  return c * rep;
}

function newIssueQueueLineKey(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Zůstatek na řádce po odečtení řádků ve frontě (stejná položka může být vícekrát). */
function projectedAvailableForItem(item: InventoryItemRow, priorQueue: IssueQueueLine[]): number {
  let avail = availableStockQtyForIssueForm(item);
  for (const ln of priorQueue) {
    if (ln.itemId !== item.id) continue;
    const total = issueLineTotalInStockUnits(item, ln);
    if (total != null && Number.isFinite(total)) avail -= total;
  }
  return avail;
}

function formatIsoCs(iso: unknown): string {
  if (typeof iso !== "string" || !iso.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("cs-CZ");
}

function formatConsumptionCreatedAt(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return formatIsoCs(raw);
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate?: () => Date }).toDate === "function"
  ) {
    try {
      return formatIsoCs((raw as { toDate: () => Date }).toDate().toISOString());
    } catch {
      return "";
    }
  }
  const o = raw as { seconds?: number; _seconds?: number };
  const sec =
    typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : null;
  if (sec != null) return formatIsoCs(new Date(sec * 1000).toISOString());
  return "";
}

function LengthCutSummary({
  item,
  issueQtyStr,
  repeatCountStr,
  inputUnit,
  availableInStockUnit,
}: {
  item: InventoryItemRow;
  issueQtyStr: string;
  repeatCountStr: string;
  inputUnit: "mm" | "cm" | "m" | null;
  availableInStockUnit: number;
}) {
  const u = String(item.unit || "").trim() || "—";
  const q = Number(String(issueQtyStr).replace(",", "."));
  const rep = Number(String(repeatCountStr || "1").replace(",", "."));
  const repOk = Number.isFinite(rep) && rep >= 1 && Math.floor(rep) === rep;
  if (!Number.isFinite(q) || q <= 0) {
    return (
      <div className="rounded-md border border-blue-100 bg-blue-50/70 p-3 text-xs text-slate-800 space-y-1">
        <p className="font-semibold text-blue-950">Metráž — přehled řezu</p>
        <p>
          Zásoba na řádce: <strong>{availableInStockUnit}</strong> {u}
        </p>
        <p className="text-slate-600">Zadejte odebírané množství pro výpočet zbytku po řezu.</p>
      </div>
    );
  }
  const convOne = quantityInStockUnits(item, q, inputUnit);
  const conv =
    convOne != null && Number.isFinite(convOne) && repOk ? convOne * rep : null;
  const rem =
    conv != null && Number.isFinite(conv) ? Math.max(0, availableInStockUnit - conv) : null;
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50/70 p-3 text-xs text-slate-800 space-y-1.5">
      <p className="font-semibold text-blue-950">Metráž — řez</p>
      <p>
        Zásoba před výdejem: <strong>{availableInStockUnit}</strong> {u}
      </p>
      <p>
        Odebírá se na zakázku ({repOk ? `${rep}×` : "?×"} stejná délka):{" "}
        <strong>
          {conv != null && Number.isFinite(conv) ? conv.toFixed(4).replace(/\.?0+$/, "") : "—"}
        </strong>{" "}
        {u}
      </p>
      <p>
        Zůstane na skladě (zbytek):{" "}
        <strong>{rem != null ? rem.toFixed(4).replace(/\.?0+$/, "") : "—"}</strong> {u}
      </p>
    </div>
  );
}

type SafeJobView = Record<string, unknown> & { jobId?: string };

export default function VyrobaZakazkaDetailPage() {
  const params = useParams();
  const jobIdRaw = params?.jobId;
  const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { company, companyId } = useCompany();
  const platformCatalog = useMergedPlatformModuleCatalog();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<any>(userRef);
  const role = String(profile?.role || "employee");
  const globalRolesArr = useMemo(
    () => (Array.isArray(profile?.globalRoles) ? profile.globalRoles.map(String) : []),
    [profile?.globalRoles]
  );

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && profile?.employeeId && normalizeCompanyRole(role) === "employee"
        ? doc(firestore, "companies", companyId, "employees", String(profile.employeeId))
        : null,
    [firestore, companyId, profile?.employeeId, role]
  );
  const { data: employeeRow } = useDoc(employeeRef);

  /** Vlastník / admin / manažer + super_admin; opraveno pro role zapsané různou velikostí písmen. */
  const isPrivilegedViewer = useMemo(
    () => isCompanyPrivileged(role, globalRolesArr),
    [role, globalRolesArr]
  );

  /**
   * Modul výroba + vedení / super_admin, nebo zaměstnanec s canAccessProduction.
   * Konkrétní zakázku navíc povoluje API (přiřazení k výrobnímu týmu).
   */
  const accessOk =
    company &&
    canAccessCompanyModule(company, "vyroba", platformCatalog) &&
    (isPrivilegedViewer ||
      userCanAccessProductionPortal({
        role,
        globalRoles: profile?.globalRoles,
        employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
      }));

  const foldersCol = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", String(jobId), "folders")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: foldersRaw } = useCollection(foldersCol);

  const invCol = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(collection(firestore, "companies", companyId, "inventoryItems"), limit(2500))
        : null,
    [firestore, companyId]
  );
  const { data: inventoryRaw } = useCollection(invCol);

  const stockCategoriesCol = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(collection(firestore, "companies", companyId, "stockCategories"), limit(200))
        : null,
    [firestore, companyId]
  );
  const { data: stockCategoriesRaw = [] } = useCollection(stockCategoriesCol, {
    suppressGlobalPermissionError: true as const,
  });
  const stockCategories = useMemo(() => {
    const raw = Array.isArray(stockCategoriesRaw) ? stockCategoriesRaw : [];
    return raw
      .map((c: any) => ({
        id: String(c?.id ?? ""),
        name: String(c?.name ?? ""),
        order: Number(c?.order) || 0,
      }))
      .filter((c) => c.id && c.name)
      .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, "cs"));
  }, [stockCategoriesRaw]);
  const inventoryItems = useMemo(() => {
    const list = Array.isArray(inventoryRaw) ? inventoryRaw : [];
    return list
      .filter(
        (r): r is InventoryItemRow =>
          !!r &&
          typeof (r as { id?: string }).id === "string" &&
          (r as { isDeleted?: boolean }).isDeleted !== true
      )
      .sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), "cs")
      );
  }, [inventoryRaw]);

  const issueableInventory = useMemo(() => {
    return inventoryItems.filter((i) => {
      const mode = String(i.stockTrackingMode || "pieces");
      const av =
        mode === "length"
          ? i.currentLength != null && Number.isFinite(Number(i.currentLength))
            ? Number(i.currentLength)
            : Number(i.quantity ?? 0)
          : Number(i.quantity ?? 0);
      if (av <= 1e-9) return false;
      if (i.remainderFullyConsumed === true) return false;
      if (i.isRemainder === true && i.remainderAvailable === false) return false;
      return true;
    });
  }, [inventoryItems]);

  const [issueCategoryFilter, setIssueCategoryFilter] = useState<string>("__all__");
  const issueableInventoryFiltered = useMemo(() => {
    if (issueCategoryFilter === "__all__") return issueableInventory;
    if (issueCategoryFilter === "__none__") {
      return issueableInventory.filter((i) => !String(i.categoryId ?? "").trim());
    }
    return issueableInventory.filter((i) => String(i.categoryId ?? "").trim() === issueCategoryFilter);
  }, [issueableInventory, issueCategoryFilter]);

  const [jobView, setJobView] = useState<SafeJobView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibleFolderPick, setVisibleFolderPick] = useState<Set<string>>(new Set());
  const [consumptions, setConsumptions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [issueItemId, setIssueItemId] = useState<string>("");
  const [issueQty, setIssueQty] = useState<string>("");
  const [issueNote, setIssueNote] = useState<string>("");
  const [issueBatch, setIssueBatch] = useState<string>("");
  const [issueRepeatCount, setIssueRepeatCount] = useState<string>("1");
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueQueue, setIssueQueue] = useState<IssueQueueLine[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [queueEditOpen, setQueueEditOpen] = useState(false);
  const [queueEditLine, setQueueEditLine] = useState<IssueQueueLine | null>(null);
  const [queueEditQtyStr, setQueueEditQtyStr] = useState("");
  const [queueEditRepeatStr, setQueueEditRepeatStr] = useState("1");
  const [issueInputLengthUnit, setIssueInputLengthUnit] = useState<"mm" | "cm" | "m">("mm");
  const [attachmentFiles, setAttachmentFiles] = useState<JobAttachmentFile[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [startSaving, setStartSaving] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const [editConsumptionOpen, setEditConsumptionOpen] = useState(false);
  const [editConsumptionBusy, setEditConsumptionBusy] = useState(false);
  const [editConsumptionRow, setEditConsumptionRow] = useState<Record<string, unknown> | null>(null);
  const [editConsumptionQty, setEditConsumptionQty] = useState("");
  const [editConsumptionNote, setEditConsumptionNote] = useState("");

  const [deleteConsumptionTarget, setDeleteConsumptionTarget] = useState<Record<string, unknown> | null>(null);
  const [csvMaterialDialog, setCsvMaterialDialog] = useState<CsvMaterialDialogSource | null>(null);
  const [previewTab, setPreviewTab] = useState<"pdf" | "image">("pdf");
  const [productionPdfSelectedIndex, setProductionPdfSelectedIndex] = useState(0);
  const [attachDrawingToExport, setAttachDrawingToExport] = useState(true);
  const [bulkPickIds, setBulkPickIds] = useState<Set<string>>(() => new Set());
  const [workbenchHeights, setWorkbenchHeights] = useState<ProductionWorkbenchHeights>({
    splitPct: 46,
    topPanelHeight: DEFAULT_PRODUCTION_WORKBENCH_TOP_PX,
  });
  const [a4IncludeUnassigned, setA4IncludeUnassigned] = useState(false);
  const [queueEditDrawingKey, setQueueEditDrawingKey] = useState<string | null>(null);

  const productionPdfRows = useMemo(
    () =>
      attachmentFiles
        .filter((f) => f.kind === "pdf")
        .map((f) => ({
          id: `${f.folderId}-${f.id}`,
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          folderName: f.folderName,
        })),
    [attachmentFiles]
  );

  useEffect(() => {
    setProductionPdfSelectedIndex((i) =>
      Math.min(i, Math.max(0, productionPdfRows.length - 1))
    );
  }, [productionPdfRows.length]);

  const loadApi = useCallback(async () => {
    if (!user || !jobId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const idToken = await user.getIdToken();
      const [vRes, cRes] = await Promise.all([
        fetch(`/api/company/production/job-view?jobId=${encodeURIComponent(String(jobId))}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
        fetch(`/api/company/production/material-consumptions?jobId=${encodeURIComponent(String(jobId))}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        }),
      ]);
      const vJson = await vRes.json().catch(() => ({}));
      const cJson = await cRes.json().catch(() => ({}));
      if (!vRes.ok) {
        const msg =
          typeof vJson.error === "string"
            ? vJson.error
            : vRes.status === 403
              ? "Nemáte přístup k této zakázce ve výrobě (nejste přiřazeni k výrobnímu týmu nebo nemáte oprávnění)."
              : "Zakázku nelze zobrazit.";
        setLoadError(msg);
        setJobView(null);
        setVisibleFolderPick(new Set());
        setConsumptions([]);
        toast({ variant: "destructive", title: "Chyba", description: msg });
        return;
      }
      setJobView((vJson.job as SafeJobView) || null);
      const folderIdsRaw = (vJson.settings as { productionVisibleFolderIds?: unknown } | null | undefined)
        ?.productionVisibleFolderIds;
      const folderIds = Array.isArray(folderIdsRaw)
        ? folderIdsRaw.map((x) => String(x)).filter(Boolean)
        : [];
      setVisibleFolderPick(new Set(folderIds));
      if (!cRes.ok) {
        const msg =
          typeof cJson.error === "string" ? cJson.error : "Historii spotřeby nelze načíst.";
        setConsumptions([]);
        toast({
          variant: "destructive",
          title: "Částečné načtení",
          description: `${msg} Zbytek stránky je k dispozici.`,
        });
      } else {
        setConsumptions(Array.isArray(cJson.consumptions) ? cJson.consumptions : []);
      }
      setLoadError(null);
    } catch (e) {
      const desc = e instanceof Error ? e.message : "Načtení se nezdařilo.";
      setLoadError(desc);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: desc,
      });
      setJobView(null);
      setVisibleFolderPick(new Set());
    } finally {
      setLoading(false);
    }
  }, [user, jobId, toast]);

  useEffect(() => {
    if (accessOk && user && jobId) void loadApi();
  }, [accessOk, user, jobId, loadApi]);

  /**
   * Složky podle příznaku „Výroba“, výběru ve vedení, případně viditelnosti pro zaměstnance (fotky/soubory).
   * Typ „dokumenty“ je vyloučen (smlouvy / účetní).
   */
  const productionFolderDebug =
    typeof process !== "undefined" && process.env.NODE_ENV === "development";

  const visibleFolders = useMemo((): ProductionFolderRow[] => {
    return filterFoldersForProductionView(foldersRaw ?? [], {
      visibleFolderPick,
      isPrivilegedViewer,
      jobId: jobId ? String(jobId) : undefined,
      roleLabel: role,
      debugLog: productionFolderDebug,
    });
  }, [foldersRaw, visibleFolderPick, isPrivilegedViewer, jobId, role, productionFolderDebug]);

  const openEditConsumption = useCallback((row: Record<string, unknown>) => {
    setEditConsumptionRow(row);
    setEditConsumptionQty(String(row.quantity ?? row.quantityUsed ?? ""));
    setEditConsumptionNote(String(row.note ?? ""));
    setEditConsumptionOpen(true);
  }, []);

  const saveEditedConsumption = useCallback(async () => {
    if (!user || !jobId || !editConsumptionRow) return;
    const qty = Number(String(editConsumptionQty).replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladné množství." });
      return;
    }
    setEditConsumptionBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/material-consumption-update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          jobId: String(jobId),
          consumptionId: String(editConsumptionRow.id ?? ""),
          quantity: qty,
          note: editConsumptionNote,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof j?.error === "string" ? j.error : "Uložení se nezdařilo.";
        toast({ variant: "destructive", title: "Chyba", description: msg });
        return;
      }
      const editWarnings = Array.isArray(j?.warnings)
        ? (j.warnings as unknown[]).filter((w): w is string => typeof w === "string" && w.trim().length > 0)
        : [];
      toast({ title: "Spotřeba upravena" });
      if (editWarnings.length) {
        toast({
          title: "Upozornění",
          description: editWarnings.join(" "),
        });
      }
      setEditConsumptionOpen(false);
      setEditConsumptionRow(null);
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setEditConsumptionBusy(false);
    }
  }, [user, jobId, editConsumptionRow, editConsumptionQty, editConsumptionNote, toast, loadApi]);

  const confirmDeleteConsumption = useCallback(async () => {
    if (!user || !jobId || !deleteConsumptionTarget) return;
    setEditConsumptionBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/material-consumption-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          jobId: String(jobId),
          consumptionId: String(deleteConsumptionTarget.id ?? ""),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof j?.error === "string" ? j.error : "Smazání se nezdařilo.";
        toast({ variant: "destructive", title: "Chyba", description: msg });
        return;
      }
      const delWarnings = Array.isArray(j?.warnings)
        ? (j.warnings as unknown[]).filter((w): w is string => typeof w === "string" && w.trim().length > 0)
        : [];
      const missingStockMsg =
        "Původní skladová položka už neexistuje, záznam spotřeby byl smazán bez vrácení na sklad.";
      const noRestock = delWarnings.some((w) => w.includes("neexistuje") && w.includes("bez vrácení"));
      if (delWarnings.length) {
        toast({
          title: "Spotřeba smazána",
          description: delWarnings.join(" "),
        });
      } else {
        toast({
          title: "Spotřeba smazána",
          description: noRestock ? missingStockMsg : "Materiál byl vrácen na sklad.",
        });
      }
      setDeleteConsumptionTarget(null);
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Smazání se nezdařilo.",
      });
    } finally {
      setEditConsumptionBusy(false);
    }
  }, [user, jobId, deleteConsumptionTarget, toast, loadApi]);

  useEffect(() => {
    if (!issueItemId) return;
    if (!issueableInventoryFiltered.some((i) => i.id === issueItemId)) {
      setIssueItemId("");
    }
  }, [issueableInventoryFiltered, issueItemId]);

  const selectedItem = useMemo(
    () =>
      issueableInventoryFiltered.find((i) => i.id === issueItemId) ??
      inventoryItems.find((i) => i.id === issueItemId) ??
      null,
    [issueableInventoryFiltered, inventoryItems, issueItemId]
  );

  useEffect(() => {
    if (!selectedItem) return;
    if (String(selectedItem.stockTrackingMode) === "length") {
      setIssueInputLengthUnit(defaultLengthInputUnit(selectedItem));
    }
  }, [selectedItem?.id, selectedItem?.stockTrackingMode]);

  const visibleFolderIdsKey = useMemo(
    () => visibleFolders.map((f) => `${f.id}:${f.name || ""}`).join("|"),
    [visibleFolders]
  );

  useEffect(() => {
    if (!firestore || !companyId || !jobId || !accessOk) return;
    let cancelled = false;
    setAttachmentsLoading(true);
    (async () => {
      const all: JobAttachmentFile[] = [];
      const jid = String(jobId);
      try {
        for (const f of visibleFolders) {
          const q = query(
            collection(
              firestore,
              "companies",
              companyId,
              "jobs",
              jid,
              "folders",
              f.id,
              "images"
            ),
            orderBy("createdAt", "desc"),
            limit(120)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const row = d.data() as Record<string, unknown>;
            if (!isJobImageVisibleInProductionView(f, row, isPrivilegedViewer)) return;
            if (!isJobFileMarkedForProduction(row)) return;
            const url = resolveJobFolderImageDownloadUrl(row);
            const name = String(row.fileName || row.name || "soubor");
            if (!url) return;
            const fileTypeHint = String(row.fileType || "").toLowerCase();
            const rowCreatedBy =
              typeof row.createdBy === "string" && row.createdBy.trim()
                ? row.createdBy.trim()
                : typeof row.uploadedBy === "string" && row.uploadedBy.trim()
                  ? row.uploadedBy.trim()
                  : undefined;
            const rowCreatedByName =
              typeof row.createdByName === "string" && row.createdByName.trim()
                ? row.createdByName.trim()
                : typeof row.uploadedByName === "string" && row.uploadedByName.trim()
                  ? row.uploadedByName.trim()
                  : undefined;
            all.push({
              id: `folder:${f.id}:${d.id}`,
              folderId: f.id,
              folderName: String(f.name || f.id),
              fileUrl: url,
              fileName: name,
              kind: attachmentKindFromName(name, fileTypeHint),
              createdAt: row.createdAt,
              uploadedBy: rowCreatedBy,
              uploadedByName: rowCreatedByName,
              mediaSource: "folder",
              folderImageDocId: d.id,
            });
          });
        }

        const legacyPhotosAllowed =
          isPrivilegedViewer || jobView?.legacyPhotosEmployeeVisible === true;

        if (legacyPhotosAllowed) {
          const photosCol = collection(firestore, "companies", companyId, "jobs", jid, "photos");
          try {
            const pq = query(photosCol, orderBy("createdAt", "desc"), limit(120));
            const psnap = await getDocs(pq);
            psnap.forEach((d) => {
              const row = d.data() as Record<string, unknown>;
              if (!isJobImageVisibleInProductionView(LEGACY_JOB_PHOTOS_FOLDER_STUB, row, isPrivilegedViewer)) {
                return;
              }
              if (!isJobFileMarkedForProduction(row)) return;
              const url = resolveJobFolderImageDownloadUrl(row);
              const name = String(row.fileName || row.name || `Foto-${d.id}`).trim() || d.id;
              if (!url) return;
              all.push({
                id: `legacy:${d.id}`,
                folderId: "job-photos",
                folderName: "Fotodokumentace u zakázky",
                fileUrl: url,
                fileName: name,
                kind: attachmentKindFromName(name),
                createdAt: row.createdAt,
                uploadedBy: typeof row.uploadedBy === "string" ? row.uploadedBy : undefined,
                uploadedByName: typeof row.uploadedByName === "string" ? row.uploadedByName : undefined,
                mediaSource: "job_legacy",
              });
            });
          } catch {
            try {
              const psnap = await getDocs(query(photosCol, limit(120)));
              psnap.forEach((d) => {
                const row = d.data() as Record<string, unknown>;
                if (!isJobImageVisibleInProductionView(LEGACY_JOB_PHOTOS_FOLDER_STUB, row, isPrivilegedViewer)) {
                  return;
                }
                if (!isJobFileMarkedForProduction(row)) return;
                const url = resolveJobFolderImageDownloadUrl(row);
                const name = String(row.fileName || row.name || `Foto-${d.id}`).trim() || d.id;
                if (!url) return;
                all.push({
                  id: `legacy:${d.id}`,
                  folderId: "job-photos",
                  folderName: "Fotodokumentace u zakázky",
                  fileUrl: url,
                  fileName: name,
                  kind: attachmentKindFromName(name),
                  createdAt: row.createdAt,
                  uploadedBy: typeof row.uploadedBy === "string" ? row.uploadedBy : undefined,
                  uploadedByName: typeof row.uploadedByName === "string" ? row.uploadedByName : undefined,
                  mediaSource: "job_legacy",
                });
              });
            } catch {
              /* ignore */
            }
          }
        }

        const mq = query(
          collection(firestore, "companies", companyId, "measurement_photos"),
          where("jobId", "==", jid),
          limit(120)
        );
        const msnap = await getDocs(mq);
        msnap.forEach((d) => {
          const row = d.data() as Record<string, unknown>;
          if (isMeasurementPhotoUnassignedForJob(row)) return;
          if (!isMeasurementPhotoVisibleInProduction(row, isPrivilegedViewer)) return;
          if (!isJobFileMarkedForProduction(row)) return;
          const url = resolveJobFolderImageDownloadUrl(row);
          if (!url) return;
          const name =
            String(row.title || row.fileName || row.name || `Zaměření-${d.id}`).trim() || d.id;
          all.push({
            id: `meas:${d.id}`,
            folderId: "measurement",
            folderName: "Zaměření",
            fileUrl: url,
            fileName: name,
            kind: "photo",
            createdAt: row.createdAt ?? row.updatedAt,
            uploadedBy: typeof row.createdBy === "string" ? row.createdBy : undefined,
            uploadedByName: undefined,
            mediaSource: "measurement",
          });
        });

        const ts = (x: JobAttachmentFile) => {
          const raw = x.createdAt;
          if (raw && typeof raw === "object" && "toDate" in raw && typeof (raw as { toDate: () => Date }).toDate === "function") {
            try {
              return (raw as { toDate: () => Date }).toDate().getTime();
            } catch {
              return 0;
            }
          }
          if (typeof raw === "string") {
            const t = new Date(raw).getTime();
            return Number.isFinite(t) ? t : 0;
          }
          const o = raw as { seconds?: number } | undefined;
          if (o && typeof o.seconds === "number") return o.seconds * 1000;
          return 0;
        };
        all.sort((a, b) => ts(b) - ts(a));

        if (process.env.NODE_ENV === "development") {
          const byKind = { photo: 0, pdf: 0, drawing: 0, other: 0, csv: 0 };
          for (const x of all) byKind[x.kind]++;
          console.debug("[Vyroba zakázka] podklady", {
            jobId: jid,
            visibleFolders: visibleFolders.length,
            totalFiles: all.length,
            measurement: all.filter((x) => x.mediaSource === "measurement").length,
            legacyJobPhotos: all.filter((x) => x.mediaSource === "job_legacy").length,
            fromFolders: all.filter((x) => x.mediaSource === "folder").length,
            byKind,
            privileged: isPrivilegedViewer,
          });
        }

        if (!cancelled) setAttachmentFiles(all);
      } finally {
        if (!cancelled) setAttachmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    firestore,
    companyId,
    jobId,
    accessOk,
    visibleFolderIdsKey,
    isPrivilegedViewer,
    jobView?.legacyPhotosEmployeeVisible,
    role,
  ]);

  const workflowStatus = useMemo(
    () => parseProductionWorkflowStatus(jobView as Record<string, unknown> | null),
    [jobView]
  );
  const canShowStartButton = jobView != null && canStartProductionWorkflow(workflowStatus);
  const productionRunning =
    workflowStatus === "started" || workflowStatus === "in_progress" || workflowStatus === "paused";

  const consumptionSummary = useMemo(() => {
    const map = new Map<
      string,
      { name: string; unit: string; qty: number; itemId: string | null }
    >();
    consumptions.forEach((c) => {
      const itemIdRaw =
        typeof c.inventoryItemId === "string" && c.inventoryItemId.trim()
          ? c.inventoryItemId.trim()
          : typeof c.sourceStockItemId === "string" && c.sourceStockItemId.trim()
            ? c.sourceStockItemId.trim()
            : null;
      const name = String(c.itemName || "");
      const unit = String(c.unit || "");
      const key = itemIdRaw ?? `name:${name}`;
      const qty = Number(c.quantity ?? 0);
      const prev = map.get(key);
      if (prev) {
        prev.qty += qty;
        if (!prev.itemId && itemIdRaw) prev.itemId = itemIdRaw;
      } else {
        map.set(key, { name, unit, qty, itemId: itemIdRaw });
      }
    });
    return Array.from(map.values());
  }, [consumptions]);

  const remainderRows = useMemo(
    () =>
      consumptions.filter(
        (c) => typeof c.remainderItemId === "string" && String(c.remainderItemId).trim().length > 0
      ),
    [consumptions]
  );

  const inventoryById = useMemo(() => {
    const m = new Map<string, InventoryItemRow>();
    for (const i of inventoryItems) m.set(i.id, i);
    return m;
  }, [inventoryItems]);

  const pdfAttachmentByDrawingKey = useMemo(() => {
    const m = new Map<string, JobAttachmentFile>();
    for (const f of attachmentFiles) {
      if (f.kind === "pdf") m.set(`${f.folderId}-${f.id}`, f);
    }
    return m;
  }, [attachmentFiles]);

  const drawingStatusCol = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", String(companyId), "jobs", String(jobId), "productionDrawingStatus")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: drawingStatusDocsRaw = [] } = useCollection<
    ProductionDrawingStatusDoc & { id?: string }
  >(drawingStatusCol, { suppressGlobalPermissionError: true as const });

  const drawingStatusByKey = useMemo(() => {
    const m = new Map<string, ProductionDrawingStatusDoc & { id?: string }>();
    const rows = Array.isArray(drawingStatusDocsRaw) ? drawingStatusDocsRaw : [];
    for (const d of rows) {
      const id = String((d as { id?: string }).id ?? d.drawingKey ?? "");
      if (id) m.set(id, d);
    }
    return m;
  }, [drawingStatusDocsRaw]);

  const activeProductionDrawingKey = useMemo((): string | null => {
    if (previewTab !== "pdf" || productionPdfRows.length === 0) return null;
    const i = Math.min(Math.max(0, productionPdfSelectedIndex), productionPdfRows.length - 1);
    return productionPdfRows[i]?.id ?? null;
  }, [previewTab, productionPdfRows, productionPdfSelectedIndex]);

  const stockPieceMetas = useMemo(() => {
    const ids = new Set<string>();
    for (const ln of issueQueue) ids.add(ln.itemId);
    if (issueItemId) ids.add(issueItemId);
    for (const inv of issueableInventoryFiltered.slice(0, 48)) {
      if (String(inv.stockTrackingMode) === "length") ids.add(inv.id);
    }
    const out: { id: string; pieceLengthMm: number | null }[] = [];
    for (const id of ids) {
      const inv = inventoryById.get(id);
      if (!inv || String(inv.stockTrackingMode) !== "length") continue;
      const pl = inv.pieceLengthMm;
      out.push({
        id,
        pieceLengthMm: pl != null && Number.isFinite(Number(pl)) ? Number(pl) : null,
      });
    }
    return out;
  }, [issueQueue, issueItemId, issueableInventoryFiltered, inventoryById]);

  const stockPieceMetasKey = useMemo(
    () =>
      stockPieceMetas
        .map((m) => `${m.id}:${m.pieceLengthMm ?? ""}`)
        .sort()
        .join("|"),
    [stockPieceMetas]
  );

  const stockPiecesSummaryByItem = useStockPiecesSummaries(
    firestore,
    companyId ?? null,
    stockPieceMetas,
    stockPieceMetasKey
  );

  const firstImageAttachment = useMemo(
    () => attachmentFiles.find((f) => f.kind === "photo" || f.kind === "drawing"),
    [attachmentFiles]
  );

  /** Zbytkové řádky skladu vázané na tuto zakázku (výdej řezem + evidence consumedByJobId). */
  const remainderInventoryRows = useMemo(() => {
    if (!jobId) return [];
    const jid = String(jobId);
    return inventoryItems.filter((i) => {
      if (i.isRemainder !== true) return false;
      if (String(i.consumedByJobId || "") === jid) return true;
      return consumptions.some((c) => c.remainderItemId === i.id);
    });
  }, [inventoryItems, jobId, consumptions]);

  const shelfAvailableQty = useMemo(() => {
    if (!selectedItem) return 0;
    const mode = String(selectedItem.stockTrackingMode || "pieces");
    if (mode === "length") {
      const cur = selectedItem.currentLength;
      if (cur != null && Number.isFinite(Number(cur))) return Number(cur);
    }
    return Number(selectedItem.quantity ?? 0);
  }, [selectedItem]);

  /** Dostupné pro další řádek výdeje včetně odečtu fronty „Materiál k výdeji“. */
  const availableQty = useMemo(
    () => (selectedItem ? projectedAvailableForItem(selectedItem, issueQueue) : 0),
    [selectedItem, issueQueue]
  );

  const productionActorLabel = useMemo(
    () =>
      String(
        profile?.displayName ||
          profile?.name ||
          (user?.email as string | undefined) ||
          profile?.email ||
          ""
      ).trim(),
    [profile?.displayName, profile?.name, profile?.email, user?.email]
  );

  useEffect(() => {
    if (!firestore || !companyId || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      const remote = await loadProductionIssueUserLayout(firestore, user.uid, companyId);
      const ls = readProductionIssueLayoutFromLocalStorage(companyId, user.uid);
      const merged = { ...ls, ...remote };
      if (cancelled) return;
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      const topMax = Math.max(PRODUCTION_TOP_PANEL_MIN_PX, vh - PRODUCTION_TOP_PANEL_VIEWPORT_RESERVE);
      const topFromDedicated = readProductionTopPanelHeightFromLocalStorage(companyId, user.uid);
      const topFromMerged =
        typeof merged.productionWorkbenchTopPx === "number" && Number.isFinite(merged.productionWorkbenchTopPx)
          ? merged.productionWorkbenchTopPx
          : topFromDedicated;
      const topClamped =
        typeof topFromMerged === "number" && Number.isFinite(topFromMerged)
          ? Math.min(Math.max(PRODUCTION_TOP_PANEL_MIN_PX, topFromMerged), topMax)
          : Math.min(Math.max(PRODUCTION_TOP_PANEL_MIN_PX, DEFAULT_PRODUCTION_WORKBENCH_TOP_PX), topMax);
      setWorkbenchHeights((prev) => ({
        splitPct:
          typeof merged.productionPdfPanelWidth === "number" && Number.isFinite(merged.productionPdfPanelWidth)
            ? Math.min(72, Math.max(28, merged.productionPdfPanelWidth))
            : prev.splitPct,
        topPanelHeight: topClamped,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, user?.uid]);

  useEffect(() => {
    if (!companyId || !user?.uid) return;
    writeProductionTopPanelHeightToLocalStorage(companyId, user.uid, workbenchHeights.topPanelHeight);
  }, [companyId, user?.uid, workbenchHeights.topPanelHeight]);

  useEffect(() => {
    if (!firestore || !companyId || !user?.uid) return;
    const t = window.setTimeout(() => {
      const patch = {
        productionPdfPanelWidth: workbenchHeights.splitPct,
        productionMaterialPanelWidth: 100 - workbenchHeights.splitPct,
        productionWorkbenchTopPx: workbenchHeights.topPanelHeight,
      };
      void saveProductionIssueUserLayout(firestore, user.uid, companyId, patch);
      writeProductionIssueLayoutToLocalStorage(companyId, user.uid, patch);
    }, 800);
    return () => window.clearTimeout(t);
  }, [firestore, companyId, user?.uid, workbenchHeights]);

  const lengthUnitEditable = useMemo(() => lengthUnitEditableForItem(selectedItem), [selectedItem]);

  const remainderPreview = useMemo(() => {
    const q = Number(String(issueQty).replace(",", "."));
    if (!selectedItem || !Number.isFinite(q) || q <= 0) return null;
    const inputUnit = lengthUnitEditable ? issueInputLengthUnit : null;
    const convOne = quantityInStockUnits(selectedItem, q, inputUnit);
    if (convOne == null || !Number.isFinite(convOne)) return null;
    let rep = 1;
    if (String(selectedItem.stockTrackingMode) === "length") {
      rep = Number(String(issueRepeatCount).replace(",", "."));
      if (!Number.isFinite(rep) || rep < 1 || Math.floor(rep) !== rep) return null;
    }
    const conv = convOne * rep;
    return Math.max(0, availableQty - conv);
  }, [
    selectedItem,
    issueQty,
    issueRepeatCount,
    availableQty,
    issueInputLengthUnit,
    lengthUnitEditable,
  ]);

  const bulkRepresentativeIdx = useMemo(() => {
    const pos = new Map<string, number>();
    consumptions.forEach((c, i) => {
      const g =
        typeof (c as { bulkIssueGroupId?: unknown }).bulkIssueGroupId === "string"
          ? String((c as { bulkIssueGroupId: string }).bulkIssueGroupId).trim()
          : "";
      if (!g) return;
      if (!pos.has(g)) pos.set(g, i);
    });
    return pos;
  }, [consumptions]);

  const startProduction = async () => {
    if (!user || !jobId) return;
    setStartSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ jobId: String(jobId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Zahájení se nezdařilo.");
      }
      toast({
        title: "Výroba zahájena",
        description: "Stav zakázky je nyní aktivní (ve výrobě), zapsal se čas a autor zahájení.",
      });
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Zahájení se nezdařilo.",
      });
    } finally {
      setStartSaving(false);
    }
  };

  const runWorkflow = async (action: "pause" | "resume" | "complete") => {
    if (!user || !jobId) return;
    setWorkflowSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/workflow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ jobId: String(jobId), action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Akci se nepodařilo provést.");
      }
      const labels: Record<string, string> = {
        pause: "Výroba byla pozastavena.",
        resume: "Výroba byla obnovena.",
        complete: "Výroba byla označena jako dokončená.",
      };
      toast({ title: "Uloženo", description: labels[action] || "Stav byl aktualizován." });
      setCompleteOpen(false);
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Akci se nepodařilo provést.",
      });
    } finally {
      setWorkflowSaving(false);
    }
  };

  const submitIssue = async () => {
    if (!user || !jobId || !selectedItem) return;
    const qty = Number(String(issueQty).replace(",", "."));
    if (!issueItemId || !Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Vyberte položku a množství." });
      return;
    }
    let repeatCount = 1;
    if (String(selectedItem.stockTrackingMode) === "length") {
      repeatCount = Number(String(issueRepeatCount).replace(",", "."));
      if (!Number.isFinite(repeatCount) || repeatCount < 1 || Math.floor(repeatCount) !== repeatCount) {
        toast({
          variant: "destructive",
          title: "Počet kusů",
          description: "Zadejte celé kladné číslo (kolikrát odebrat tuto délku).",
        });
        return;
      }
    }
    const inputUnitForApi =
      String(selectedItem.stockTrackingMode) === "length" && lengthUnitEditable
        ? issueInputLengthUnit
        : null;
    const conv = quantityInStockUnits(selectedItem, qty, inputUnitForApi);
    if (conv == null || !Number.isFinite(conv)) {
      toast({
        variant: "destructive",
        title: "Neplatná délka",
        description: "Zkontrolujte jednotku a zadejte kladné množství.",
      });
      return;
    }
    const convTotal = conv * repeatCount;
    if (convTotal > availableQty + 1e-9) {
      toast({ variant: "destructive", title: "Nelze vydat více než je skladem." });
      return;
    }
    setIssueSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/issue-material", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          jobId: String(jobId),
          itemId: issueItemId,
          quantity: qty,
          repeatCount,
          note: issueNote.trim() || null,
          batchNumber: issueBatch.trim() || null,
          inputLengthUnit: inputUnitForApi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Výdej se nezdařil.");
      }
      const allocs = Array.isArray(data.allocations)
        ? (data.allocations as { pieceId?: string; usedLengthMm?: number; remainingAfterMm?: number }[])
        : [];
      const allocDesc =
        allocs.length > 0
          ? allocs
              .map(
                (a) =>
                  `Kus ${String(a.pieceId ?? "").slice(0, 8)}… −${Number(a.usedLengthMm).toFixed(1)} mm → zbývá ${Number(a.remainingAfterMm).toFixed(1)} mm`
              )
              .join("; ")
          : "Zápis byl uložen na zakázku a do skladu.";
      toast({ title: "Materiál vydán", description: allocDesc });
      setIssueQty("");
      setIssueRepeatCount("1");
      setIssueNote("");
      setIssueBatch("");
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Výdej se nezdařil.",
      });
    } finally {
      setIssueSaving(false);
    }
  };

  const validateIssueQueueAgainstInventory = useCallback((): { ok: true } | { ok: false; message: string } => {
    if (issueQueue.length === 0) return { ok: false, message: "Seznam výdeje je prázdný." };
    const sim = new Map<string, number>();
    for (const ln of issueQueue) {
      const item = inventoryById.get(ln.itemId);
      if (!item) return { ok: false, message: `Neznámá položka (${ln.itemId}).` };
      if (!sim.has(ln.itemId)) sim.set(ln.itemId, availableStockQtyForIssueForm(item));
      const avail = sim.get(ln.itemId)!;
      const total = issueLineTotalInStockUnits(item, ln);
      if (total == null || !Number.isFinite(total) || total <= 0) {
        return {
          ok: false,
          message: `U řádku „${item.name}“ zkontrolujte množství a u metráže počet opakování (celé číslo).`,
        };
      }
      if (String(item.stockTrackingMode) === "pieces" && !Number.isInteger(total)) {
        return { ok: false, message: `U kusové evidence musí být u „${item.name}“ celé číslo.` };
      }
      if (total > avail + 1e-9) {
        return {
          ok: false,
          message: `Nedostatek skladu u „${item.name}“: požadováno ${total}, dostupné ${avail} ${item.unit || "ks"} (včetně řádků ve frontě výše).`,
        };
      }
      sim.set(ln.itemId, avail - total);
    }
    return { ok: true };
  }, [issueQueue, inventoryById]);

  const addCurrentFormToIssueQueue = useCallback(() => {
    if (!selectedItem) {
      toast({ variant: "destructive", title: "Vyberte skladovou položku." });
      return;
    }
    const qty = Number(String(issueQty).replace(",", "."));
    if (!issueItemId || !Number.isFinite(qty) || qty <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladné množství." });
      return;
    }
    const repLine =
      String(selectedItem.stockTrackingMode) === "length"
        ? Number(String(issueRepeatCount).replace(",", "."))
        : 1;
    if (
      String(selectedItem.stockTrackingMode) === "length" &&
      (!Number.isFinite(repLine) || repLine < 1 || Math.floor(repLine) !== repLine)
    ) {
      toast({
        variant: "destructive",
        title: "Počet kusů",
        description: "U metráže zadejte celé kladné číslo opakování.",
      });
      return;
    }
    const inputUnitForLine = lengthUnitEditableForItem(selectedItem) ? issueInputLengthUnit : null;
    const conv = quantityInStockUnits(selectedItem, qty, inputUnitForLine);
    if (conv == null || !Number.isFinite(conv)) {
      toast({ variant: "destructive", title: "Neplatná délka", description: "Zkontrolujte jednotku." });
      return;
    }
    const convTotal = conv * repLine;
    const left = projectedAvailableForItem(selectedItem, issueQueue);
    if (convTotal > left + 1e-9) {
      toast({
        variant: "destructive",
        title: "Nedostatek skladu",
        description: "Po odečtení fronty už na skladě tolik není.",
      });
      return;
    }
    setIssueQueue((q) => [
      ...q,
      {
        key: newIssueQueueLineKey(),
        itemId: selectedItem.id,
        qtyStr: issueQty.trim(),
        repeatCountStr:
          String(selectedItem.stockTrackingMode) === "length"
            ? issueRepeatCount.trim() || "1"
            : "1",
        note: issueNote.trim(),
        batchNumber: issueBatch.trim(),
        inputLengthUnit: inputUnitForLine,
        productionDrawingKey: activeProductionDrawingKey,
      },
    ]);
    setIssueQty("");
    toast({ title: "Přidáno do výdeje", description: String(selectedItem.name) });
  }, [
    selectedItem,
    issueItemId,
    issueQty,
    issueRepeatCount,
    issueNote,
    issueBatch,
    issueInputLengthUnit,
    issueQueue,
    toast,
    activeProductionDrawingKey,
  ]);

  const addSameStockLineAgain = useCallback(() => {
    const last = [...issueQueue].reverse().find((l) => l.itemId === issueItemId);
    if (last) {
      setIssueQueue((q) => [...q, { ...last, key: newIssueQueueLineKey() }]);
      toast({
        title: "Řádek zkopírován",
        description: "Upravte množství u nového řádku v seznamu (nebo ponechte stejné).",
      });
      return;
    }
    toast({
      variant: "destructive",
      title: "Nelze zkopírovat",
      description:
        "Nejdříve přidejte položku do výdeje, nebo vyplňte údaje výše a použijte „Přidat do výdeje“.",
    });
  }, [issueQueue, issueItemId, toast]);

  const removeIssueQueueLine = useCallback((key: string) => {
    setIssueQueue((q) => q.filter((l) => l.key !== key));
  }, []);

  const openEditIssueQueueLine = useCallback((ln: IssueQueueLine) => {
    setQueueEditLine(ln);
    setQueueEditQtyStr(ln.qtyStr);
    setQueueEditRepeatStr(ln.repeatCountStr ?? "1");
    setQueueEditDrawingKey(ln.productionDrawingKey ?? null);
    setQueueEditOpen(true);
  }, []);

  const saveIssueQueueLineQty = useCallback(() => {
    if (!queueEditLine) return;
    const item = inventoryById.get(queueEditLine.itemId);
    if (!item) {
      toast({ variant: "destructive", title: "Položka už není ve skladu." });
      return;
    }
    const trimmed = queueEditQtyStr.trim();
    const next = Number(String(trimmed).replace(",", "."));
    if (!Number.isFinite(next) || next <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladné množství." });
      return;
    }
    const rep =
      String(item.stockTrackingMode) === "length"
        ? Number(String(queueEditRepeatStr).replace(",", "."))
        : 1;
    if (String(item.stockTrackingMode) === "length" && (!Number.isFinite(rep) || rep < 1 || Math.floor(rep) !== rep)) {
      toast({ variant: "destructive", title: "Počet opakování musí být celé kladné číslo." });
      return;
    }
    const inputLen = lengthUnitEditableForItem(item) ? queueEditLine.inputLengthUnit : null;
    const convOne = quantityInStockUnits(item, next, inputLen);
    if (convOne == null || !Number.isFinite(convOne)) {
      toast({ variant: "destructive", title: "Neplatná délka nebo jednotka." });
      return;
    }
    const conv = convOne * rep;
    const others = issueQueue.filter((l) => l.key !== queueEditLine.key);
    const left = projectedAvailableForItem(item, others);
    if (conv > left + 1e-9) {
      toast({ variant: "destructive", title: "Nedostatek skladu", description: "Zadejte menší množství." });
      return;
    }
    const repStr = String(item.stockTrackingMode) === "length" ? String(Math.floor(rep)) : "1";
    setIssueQueue((q) =>
      q.map((l) =>
        l.key === queueEditLine.key
          ? { ...l, qtyStr: trimmed, repeatCountStr: repStr, productionDrawingKey: queueEditDrawingKey }
          : l
      )
    );
    setQueueEditOpen(false);
    setQueueEditLine(null);
  }, [
    queueEditLine,
    queueEditQtyStr,
    queueEditRepeatStr,
    queueEditDrawingKey,
    issueQueue,
    inventoryById,
    toast,
  ]);

  const submitBulkIssue = useCallback(async () => {
    if (!user || !jobId) return;
    const v = validateIssueQueueAgainstInventory();
    if (!v.ok) {
      toast({ variant: "destructive", title: "Nelze potvrdit výdej", description: v.message });
      return;
    }
    setBulkSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/issue-material-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          jobId: String(jobId),
          lines: issueQueue.map((ln) => ({
            itemId: ln.itemId,
            quantity: Number(String(ln.qtyStr).replace(",", ".")),
            repeatCount: Number(String(ln.repeatCountStr ?? "1").replace(",", ".")) || 1,
            note: ln.note || null,
            batchNumber: ln.batchNumber || null,
            inputLengthUnit: ln.inputLengthUnit,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Hromadný výdej se nezdařil.");
      }
      toast({
        title: "Hromadný výdej uložen",
        description: `Zapsáno ${issueQueue.length} řádků na zakázku a do skladu.`,
      });
      setIssueQueue([]);
      await loadApi();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Hromadný výdej se nezdařil.",
      });
    } finally {
      setBulkSaving(false);
    }
  }, [user, jobId, issueQueue, validateIssueQueueAgainstInventory, toast, loadApi]);

  const resolveExportDrawing = useCallback((): ProductionWorksheetDrawingRef | null => {
    if (previewTab === "pdf" && productionPdfRows.length > 0) {
      const i = Math.min(
        Math.max(0, productionPdfSelectedIndex),
        productionPdfRows.length - 1
      );
      const r = productionPdfRows[i];
      return r ? { url: r.fileUrl, fileName: r.fileName, kind: "pdf" } : null;
    }
    if (previewTab === "image" && firstImageAttachment) {
      const k = firstImageAttachment.kind === "pdf" ? "pdf" : "image";
      return {
        url: firstImageAttachment.fileUrl,
        fileName: firstImageAttachment.fileName,
        kind: k,
      };
    }
    if (productionPdfRows.length > 0) {
      const i = Math.min(
        Math.max(0, productionPdfSelectedIndex),
        productionPdfRows.length - 1
      );
      const r = productionPdfRows[i];
      return r ? { url: r.fileUrl, fileName: r.fileName, kind: "pdf" } : null;
    }
    if (firstImageAttachment) {
      const k = firstImageAttachment.kind === "pdf" ? "pdf" : "image";
      return {
        url: firstImageAttachment.fileUrl,
        fileName: firstImageAttachment.fileName,
        kind: k,
      };
    }
    return null;
  }, [previewTab, productionPdfRows, productionPdfSelectedIndex, firstImageAttachment]);

  const runProductionWorksheetPdf = useCallback(
    async (action: "download" | "print") => {
      if (!jobView) return;
      const j = jobView as Record<string, unknown>;
      const jobName = String(jobView.displayLabel || jobView.name || jobId);
      const customer = String(
        j.customerName ||
          j.customerCompanyName ||
          j.companyName ||
          j.customerDisplayName ||
          ""
      );
      const pendingLines =
        issueQueue.length > 0
          ? issueQueue.map((ln) => {
              const inv = inventoryById.get(ln.itemId);
              const cut =
                inv && String(inv.stockTrackingMode) === "length" && ln.repeatCountStr !== "1"
                  ? `${ln.repeatCountStr}× ${ln.qtyStr}`
                  : ln.qtyStr;
              return `${inv?.name ?? ln.itemId}: ${cut}`;
            })
          : [];

      const drawingRef = resolveExportDrawing();
      const shouldAttach =
        attachDrawingToExport && drawingRef != null && (drawingRef.kind === "pdf" || drawingRef.kind === "image");
      const drawingNote =
        !shouldAttach && drawingRef
          ? `Výkres (nepřiloženo v tomto exportu): ${drawingRef.fileName}\n${drawingRef.url}`
          : undefined;

      const rows = consumptions.map((raw) => {
        const c = raw as Record<string, unknown>;
        const itemName = String(c.itemName || "");
        const qty = String(c.quantity ?? c.quantityUsed ?? "");
        const unit = String(c.unit || "");
        const rc = c.repeatCount != null ? String(c.repeatCount) : "—";
        const rem =
          c.quantityRemainingOnStock != null ? String(c.quantityRemainingOnStock) : "—";
        const allocs = c.stockPieceAllocations;
        let allocStr = "—";
        if (Array.isArray(allocs)) {
          allocStr = allocs
            .map((a: unknown) => {
              const x = a as Record<string, unknown>;
              const u = x.usedLengthMm;
              const r = x.remainingAfterMm;
              const pid = String(x.pieceId || "").slice(0, 8);
              return `${pid}… −${u} mm → ${r} mm`;
            })
            .join("; ");
        }
        return {
          itemName,
          quantity: qty,
          unit,
          repeatCount: rc,
          remainingOnStock: rem,
          allocations: allocStr,
          note: c.note != null ? String(c.note) : "",
          createdBy: c.createdByName != null ? String(c.createdByName) : "",
          createdAt: formatConsumptionCreatedAt(c.createdAt),
        };
      });

      const dateLabel = new Date().toLocaleString("cs-CZ");
      try {
        const doc = await buildProductionWorksheetPdf({
          jobName,
          customerLabel: customer,
          dateLabel,
          drawingNote,
          rows,
          pendingLines: pendingLines.length ? pendingLines : undefined,
          attachDrawing: shouldAttach,
          drawing: shouldAttach ? drawingRef : null,
        });
        if (action === "print") openProductionWorksheetPdfInNewTab(doc);
        else downloadProductionWorksheetPdf(doc, jobName, dateLabel);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "PDF se nepodařilo vytvořit",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      }
    },
    [
      jobView,
      jobId,
      consumptions,
      issueQueue,
      inventoryById,
      resolveExportDrawing,
      attachDrawingToExport,
      toast,
    ]
  );

  const issueQueueLinesForA4Filter = useCallback(
    (scope: "single" | "all", drawingKey: string | null, includeUnassigned: boolean): IssueQueueLine[] => {
      if (scope === "all") return issueQueue;
      if (!drawingKey) {
        if (!includeUnassigned) return [];
        return issueQueue.filter((l) => !l.productionDrawingKey);
      }
      const forPdf = issueQueue.filter((l) => l.productionDrawingKey === drawingKey);
      if (!includeUnassigned) return forPdf;
      const unass = issueQueue.filter((l) => !l.productionDrawingKey);
      return [...forPdf, ...unass];
    },
    [issueQueue]
  );

  const materialRowsForA4 = useCallback(
    (lines: IssueQueueLine[]) =>
      lines.map((ln) => {
        const inv = inventoryById.get(ln.itemId);
        const unit = inv?.unit || "ks";
        const cuts =
          inv && String(inv.stockTrackingMode) === "length"
            ? ln.repeatCountStr && ln.repeatCountStr !== "1"
              ? `${ln.repeatCountStr}× ${ln.qtyStr} ${ln.inputLengthUnit || ""}`
              : `${ln.qtyStr} ${ln.inputLengthUnit || ""}`
            : "—";
        const sp = stockPiecesSummaryByItem[ln.itemId];
        const remainder =
          inv && String(inv.stockTrackingMode) === "length" && sp && !sp.loading ? sp.label : "—";
        const stDoc = ln.productionDrawingKey ? drawingStatusByKey.get(ln.productionDrawingKey) : null;
        const st = (stDoc?.status as ProductionDrawingStatusValue) || "unprepared";
        return {
          itemName: String(inv?.name ?? ln.itemId),
          quantity: ln.qtyStr,
          unit,
          cuts,
          remainder,
          note: [ln.note, ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean).join(" · "),
          statusLabel: PRODUCTION_DRAWING_STATUS_LABELS[st],
        };
      }),
    [inventoryById, stockPiecesSummaryByItem, drawingStatusByKey]
  );

  const runA4WorkListExport = useCallback(
    async (
      action: "download" | "print",
      scope: "single" | "all",
      drawingKey: string | null,
      opts?: { includeUnassigned?: boolean }
    ) => {
      if (!jobView) return;
      const j = jobView as Record<string, unknown>;
      const jobName = String(jobView.displayLabel || jobView.name || jobId);
      const customer = String(
        j.customerName ||
          j.customerCompanyName ||
          j.companyName ||
          j.customerDisplayName ||
          ""
      );
      const dateLabel = new Date().toLocaleString("cs-CZ");
      const lines = issueQueueLinesForA4Filter(scope, drawingKey, opts?.includeUnassigned === true);
      if (lines.length === 0) {
        toast({
          variant: "destructive",
          title: "Žádný materiál",
          description:
            scope === "single"
              ? "K tomuto výkresu není přiřazen žádný řádek — přidejte materiál nebo zapněte „Zahrnout nepřiřazený materiál“."
              : "Seznam „Materiál pro zakázku“ je prázdný.",
        });
        return;
      }
      let drawingRef: ProductionWorksheetDrawingRef | null = null;
      if (scope === "single" && drawingKey) {
        const row = productionPdfRows.find((r) => r.id === drawingKey);
        if (row) drawingRef = { url: row.fileUrl, fileName: row.fileName, kind: "pdf" };
      } else if (scope === "all" && productionPdfRows.length > 0) {
        const i = Math.min(Math.max(0, productionPdfSelectedIndex), productionPdfRows.length - 1);
        const row = productionPdfRows[i];
        if (row)
          drawingRef = {
            url: row.fileUrl,
            fileName: `Souhrn výkresů (aktuální: ${row.fileName})`,
            kind: "pdf",
          };
      }
      const footerParts: string[] = [];
      if (scope === "single" && drawingKey) {
        const st = drawingStatusByKey.get(drawingKey)?.status as ProductionDrawingStatusValue | undefined;
        if (st) footerParts.push(`Stav výkresu: ${PRODUCTION_DRAWING_STATUS_LABELS[st]}`);
      }
      try {
        const doc = await buildProductionA4WorkListPdf({
          jobName,
          customerLabel: customer,
          dateLabel,
          drawing: drawingRef,
          materialRows: materialRowsForA4(lines),
          footerNote: footerParts.length ? footerParts.join(" · ") : undefined,
        });
        if (action === "print") openProductionA4WorkListPdfPrint(doc);
        else downloadProductionA4WorkListPdf(doc, jobName, dateLabel);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Export A4 se nezdařil",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      }
    },
    [
      jobView,
      jobId,
      issueQueueLinesForA4Filter,
      materialRowsForA4,
      productionPdfRows,
      productionPdfSelectedIndex,
      drawingStatusByKey,
      toast,
      a4IncludeUnassigned,
      activeProductionDrawingKey,
    ]
  );

  const setDrawingStatusFlow = useCallback(
    async (drawingKey: string, status: ProductionDrawingStatusValue) => {
      if (!firestore || !companyId || !jobId || !user) return;
      const att = pdfAttachmentByDrawingKey.get(drawingKey);
      const row = productionPdfRows.find((r) => r.id === drawingKey);
      const fileName = row?.fileName || att?.fileName || drawingKey;
      const fileId = att?.id || "";
      const folderId = att?.folderId || "";
      if (!fileId || !folderId) {
        toast({
          variant: "destructive",
          title: "Chybí metadata souboru",
          description: "Obnovte stránku a zkuste znovu.",
        });
        return;
      }
      const payload: {
        drawingKey: string;
        fileId: string;
        folderId: string;
        fileName: string;
        status: ProductionDrawingStatusValue;
        materialPreparedAt?: ReturnType<typeof serverTimestamp>;
        materialPreparedBy?: string;
        materialPreparedByName?: string;
        issuedAt?: ReturnType<typeof serverTimestamp>;
        issuedBy?: string;
        issuedByName?: string;
      } = {
        drawingKey,
        fileId,
        folderId,
        fileName,
        status,
      };
      if (status === "material_ready") {
        payload.materialPreparedAt = serverTimestamp();
        payload.materialPreparedBy = user.uid;
        if (productionActorLabel) payload.materialPreparedByName = productionActorLabel;
      }
      if (status === "issued") {
        payload.issuedAt = serverTimestamp();
        payload.issuedBy = user.uid;
        if (productionActorLabel) payload.issuedByName = productionActorLabel;
      }
      try {
        await upsertProductionDrawingStatus(firestore, companyId, String(jobId), payload);
        toast({ title: "Uloženo", description: PRODUCTION_DRAWING_STATUS_LABELS[status] });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Stav se nepodařilo uložit",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      }
    },
    [
      firestore,
      companyId,
      jobId,
      user,
      pdfAttachmentByDrawingKey,
      productionPdfRows,
      toast,
      productionActorLabel,
    ]
  );

  const toggleBulkPick = useCallback((id: string) => {
    setBulkPickIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const addBulkPickedToQueue = useCallback(() => {
    if (bulkPickIds.size === 0) {
      toast({ variant: "destructive", title: "Vyberte položky zaškrtnutím." });
      return;
    }
    let added = 0;
    setIssueQueue((q) => {
      const next = [...q];
      for (const id of bulkPickIds) {
        const inv = inventoryById.get(id);
        if (!inv) continue;
        const isLen = String(inv.stockTrackingMode) === "length";
        const pl = inv.pieceLengthMm;
        const defaultQty =
          isLen && pl != null && Number.isFinite(Number(pl)) ? String(pl) : isLen ? "1000" : "1";
        next.push({
          key: newIssueQueueLineKey(),
          itemId: id,
          qtyStr: defaultQty,
          repeatCountStr: "1",
          note: "",
          batchNumber: "",
          inputLengthUnit: lengthUnitEditableForItem(inv) ? "mm" : null,
          productionDrawingKey: activeProductionDrawingKey,
        });
        added++;
      }
      return next;
    });
    setBulkPickIds(new Set());
    toast({
      title: "Položky byly přidány",
      description:
        added > 0
          ? `${added} ${added === 1 ? "položka" : added < 5 ? "položky" : "položek"} v seznamu „Materiál pro zakázku“ — zkontrolujte množství a řezy.`
          : "Nic nebylo přidáno.",
    });
  }, [bulkPickIds, inventoryById, toast, activeProductionDrawingKey]);

  const productionMaterialLinesForOrder = useMemo(() => {
    return issueQueue.map((ln) => {
      const inv = inventoryById.get(ln.itemId);
      const name = inv?.name ?? ln.itemId;
      const unit = inv?.unit || "ks";
      const total = inv ? issueLineTotalInStockUnits(inv, ln) : null;
      const qty =
        total != null && Number.isFinite(total)
          ? total
          : Number(String(ln.qtyStr).replace(",", ".")) || 0;
      let cutsText: string | undefined;
      if (inv && String(inv.stockTrackingMode) === "length") {
        const u = ln.inputLengthUnit || "mm";
        cutsText =
          ln.repeatCountStr && ln.repeatCountStr !== "1"
            ? `${ln.repeatCountStr}× ${ln.qtyStr} ${u}`
            : `${ln.qtyStr} ${u}`;
      }
      const noteParts = [ln.note?.trim(), ln.batchNumber ? `Šarže: ${ln.batchNumber}` : ""].filter(Boolean);
      return {
        key: ln.key,
        name,
        quantity: qty,
        unit,
        cutsText,
        note: noteParts.length ? noteParts.join(" · ") : undefined,
      };
    });
  }, [issueQueue, inventoryById]);

  const materialOrderJobRecord = useMemo(
    () =>
      jobView
        ? ({ ...(jobView as Record<string, unknown>) } as Record<string, unknown>)
        : ({} as Record<string, unknown>),
    [jobView]
  );
  const materialOrderCustomerName = useMemo(() => {
    if (!jobView) return "—";
    const j = jobView as Record<string, unknown>;
    return String(j.customerName || j.customerCompanyName || j.companyName || j.customerDisplayName || "—");
  }, [jobView]);
  const materialOrderCustomerAddress = useMemo(() => {
    if (!jobView) return "";
    const j = jobView as Record<string, unknown>;
    return String(j.address || j.customerAddress || j.installAddress || "").trim();
  }, [jobView]);
  const companyDisplayNameForOrders = useMemo(
    () =>
      String(
        (company as { name?: string; companyName?: string } | null)?.name ||
          (company as { companyName?: string } | null)?.companyName ||
          "Organizace"
      ),
    [company]
  );
  const companyDocForOrders = useMemo(
    () => (company ? ({ ...(company as Record<string, unknown>) } as Record<string, unknown>) : null),
    [company]
  );

  if (!user || !companyId || !jobId) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (firestore && userRef && profileLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessOk) {
    return (
      <Card className={CARD}>
        <CardContent className="py-10 text-center text-slate-700">
          Nemáte přístup.
          <div className="mt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/portal/dashboard")}>
              Zpět
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,1600px)] space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/portal/vyroba/zakazky" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Zakázky ve výrobě
          </Link>
        </Button>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/portal/vyroba">Výroba</Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !jobView ? (
        <Card className={CARD}>
          <CardContent className="py-10 space-y-4 text-center">
            <p className="text-slate-800 font-medium">
              {loadError || "Zakázka není k dispozici nebo k ní nemáte přístup ve výrobě."}
            </p>
            <p className="text-sm text-slate-600 max-w-lg mx-auto">
              Ujistěte se, že jste v nastavení zakázky zařazeni mezi členy výrobního týmu, a že máte u profilu
              zaměstnance zapnutý přístup k modulu Výroba. Vedení organizace vidí všechny zakázky.
            </p>
            <Button type="button" variant="outline" asChild>
              <Link href="/portal/vyroba/zakazky">Zpět na zakázky ve výrobě</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div>
            <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl text-slate-900">
              {String(jobView.displayLabel || jobView.name || jobId)}
            </h1>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {jobView.productionWorkflowStatusLabel ? (
                <Badge className="bg-slate-800 text-white hover:bg-slate-800">
                  {String(jobView.productionWorkflowStatusLabel)}
                </Badge>
              ) : null}
              {jobView.productionStatus ? (
                <Badge variant="secondary" className="border border-slate-200">
                  Stav výroby: {String(jobView.productionStatus)}
                </Badge>
              ) : null}
              {jobView.status ? (
                <Badge variant="outline" className="capitalize">
                  {String(jobView.status)}
                </Badge>
              ) : null}
            </div>
            <p className="portal-page-description text-slate-700 mt-2 text-sm">
              Zobrazení bez cen, faktur a obchodních dokladů.
            </p>
          </div>

          {canShowStartButton ? (
            <div className="rounded-xl border-2 border-amber-400/90 bg-gradient-to-br from-amber-50 to-orange-50/80 p-4 sm:p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-slate-900">Zahájit výrobu</p>
                  <p className="text-sm text-slate-700 max-w-xl">
                    Zakázka přejde do aktivního stavu výroby (<strong>ve výrobě</strong>), uloží se datum a čas a
                    kdo výrobu spustil; poté můžete vydávat materiál a sledovat spotřebu v sekcích níže.
                  </p>
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="shrink-0 gap-2 h-12 px-6 text-base font-semibold bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={startSaving}
                  onClick={() => void startProduction()}
                >
                  {startSaving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                  Zahájit výrobu
                </Button>
              </div>
            </div>
          ) : null}

          {productionRunning ? (
            <Card className={`${CARD} border-blue-200/80 bg-gradient-to-br from-slate-50 to-blue-50/40`}>
              <CardHeader className="border-b border-slate-100 pb-3">
                <CardTitle className="text-base text-slate-900">Stav výroby — akce</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Badge variant="secondary" className="w-fit text-sm py-1">
                  {String(jobView.productionWorkflowStatusLabel || workflowStatus)}
                </Badge>
                <div className="flex flex-wrap gap-2">
                  {(workflowStatus === "started" || workflowStatus === "in_progress") && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={workflowSaving}
                      onClick={() => void runWorkflow("pause")}
                    >
                      {workflowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CirclePause className="h-4 w-4" />}
                      Pozastavit
                    </Button>
                  )}
                  {workflowStatus === "paused" && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="gap-1"
                      disabled={workflowSaving}
                      onClick={() => void runWorkflow("resume")}
                    >
                      {workflowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CirclePlay className="h-4 w-4" />}
                      Obnovit výrobu
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1"
                    disabled={workflowSaving}
                    onClick={() => setCompleteOpen(true)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Dokončit výrobu…
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <Factory className="h-4 w-4" />
                Zahájení a stav výroby
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm text-slate-800">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{String(jobView.productionWorkflowStatusLabel || "—")}</Badge>
              </div>
              {jobView.productionStartedAt ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Zahájení výroby</p>
                  <p>
                    {formatIsoCs(jobView.productionStartedAt)}
                    {jobView.productionStartedByName ? (
                      <span className="text-slate-600">
                        {" "}
                        — <strong>{String(jobView.productionStartedByName)}</strong>
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : (
                <p className="text-slate-600">Výroba dosud nebyla zahájena tlačítkem výše.</p>
              )}
              {jobView.productionCompletedAt ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Dokončení výroby</p>
                  <p>
                    {formatIsoCs(jobView.productionCompletedAt)}
                    {jobView.productionCompletedByName ? (
                      <span className="text-slate-600">
                        {" "}
                        — <strong>{String(jobView.productionCompletedByName)}</strong>
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : null}
              {jobView.productionStatusNote ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Poznámka ke stavu (vedení)</p>
                  <p>{String(jobView.productionStatusNote)}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900">Údaje pro práci</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm text-slate-800">
              {jobView.description ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Popis</p>
                  <p className="whitespace-pre-wrap">{String(jobView.description)}</p>
                </div>
              ) : null}
              {jobView.measuring || jobView.measuringDetails ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Měření / technické</p>
                  <p className="whitespace-pre-wrap">{String(jobView.measuring || "")}</p>
                  {jobView.measuringDetails ? (
                    <p className="whitespace-pre-wrap mt-1 text-slate-700">
                      {String(jobView.measuringDetails)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {jobView.productionTeamNotes ? (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Výrobní poznámky</p>
                  <p className="whitespace-pre-wrap">{String(jobView.productionTeamNotes)}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <ProductionIssuePanelShell>
            <Card className={cn(CARD, "flex min-h-0 flex-1 flex-col overflow-hidden border-0 shadow-none")}>
              <CardHeader className="shrink-0 border-b border-slate-100">
                <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Výdej ve výrobě
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-6 text-sm sm:px-6 sm:pb-6">
                <div className="mb-6 max-w-3xl shrink-0 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Materiál přiřazený k výrobě
                  </p>
                  <p className="text-sm leading-relaxed text-slate-700">
                    Materiál nemusí být předem přiřazen — při každém výdeji ze skladu se automaticky zapíše spotřeba
                    na tuto zakázku. Volitelné rezervace řeší administrace skladu.
                  </p>
                </div>

                {productionPdfRows.length > 0 ? (
                  <div className="mb-4 shrink-0 space-y-2 rounded-lg border border-slate-200 bg-slate-50/90 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      PDF výkresy — připravenost materiálu
                    </p>
                    <div className="space-y-2">
                      {productionPdfRows.map((pdfRow) => {
                        const st = (drawingStatusByKey.get(pdfRow.id)?.status ||
                          "unprepared") as ProductionDrawingStatusValue;
                        const matCount = issueQueue.filter((l) => l.productionDrawingKey === pdfRow.id).length;
                        const active = productionPdfRows[productionPdfSelectedIndex]?.id === pdfRow.id;
                        return (
                          <div
                            key={pdfRow.id}
                            className={cn(
                              "flex flex-col gap-2 rounded-md border bg-white p-2 sm:flex-row sm:items-center sm:justify-between",
                              active ? "border-emerald-400 ring-1 ring-emerald-200" : "border-slate-200"
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="truncate text-left text-sm font-medium text-slate-900 hover:underline"
                                  onClick={() => {
                                    setPreviewTab("pdf");
                                    const idx = productionPdfRows.findIndex((r) => r.id === pdfRow.id);
                                    if (idx >= 0) setProductionPdfSelectedIndex(idx);
                                  }}
                                >
                                  {pdfRow.fileName}
                                </button>
                                <span
                                  className={cn(
                                    "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                    PRODUCTION_DRAWING_STATUS_BADGE_CLASS[st]
                                  )}
                                >
                                  {PRODUCTION_DRAWING_STATUS_LABELS[st]}
                                </span>
                                <span className="text-[11px] text-slate-500">Materiál: {matCount} řádků</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-8 px-2 text-[11px]"
                                disabled={st === "material_ready" || st === "issued" || st === "done"}
                                onClick={() => void setDrawingStatusFlow(pdfRow.id, "material_ready")}
                              >
                                Materiál připraven
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-[11px]"
                                disabled={st === "issued" || st === "done"}
                                onClick={() => void setDrawingStatusFlow(pdfRow.id, "issued")}
                              >
                                Vyskladněno
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                disabled={st === "done"}
                                onClick={() => void setDrawingStatusFlow(pdfRow.id, "done")}
                              >
                                Hotovo
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs"
                                onClick={() =>
                                  void runA4WorkListExport("download", "single", pdfRow.id, {
                                    includeUnassigned: a4IncludeUnassigned,
                                  })
                                }
                              >
                                Export A4
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <Checkbox
                        checked={a4IncludeUnassigned}
                        onCheckedChange={(c) => setA4IncludeUnassigned(c === true)}
                      />
                      Při exportu aktuálního PDF zahrnout nepřiřazený materiál
                    </label>
                  </div>
                ) : null}

                <ProductionWorkbenchSplit
                  storageKeyPrefix={`vyroba-wb-${String(jobId)}`}
                  fillContainerHeight
                  disableLocalStorage
                  controlledHeights={workbenchHeights}
                  onControlledHeightsChange={(patch) =>
                    setWorkbenchHeights((prev) => ({ ...prev, ...patch }))
                  }
                  className="min-h-0 w-full flex-1"
                leftPanel={
                  <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
                    <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/95 px-2 py-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Výkres / podklady
                      </span>
                    </div>
                    {productionPdfRows.length > 0 || firstImageAttachment ? (
                      <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-100 px-2 py-1.5">
                        {productionPdfRows.length > 0 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={previewTab === "pdf" ? "default" : "outline"}
                            className="min-h-9 text-sm"
                            onClick={() => setPreviewTab("pdf")}
                          >
                            PDF
                          </Button>
                        ) : null}
                        {firstImageAttachment ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={previewTab === "image" ? "default" : "outline"}
                            className="min-h-9 text-sm"
                            onClick={() => setPreviewTab("image")}
                          >
                            Obrázek
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {productionPdfRows.length > 0 && (previewTab === "pdf" || !firstImageAttachment) ? (
                        <JobProductionPdfDocumentationPanel
                          embedded
                          pdfFiles={productionPdfRows}
                          attachmentsLoading={attachmentsLoading}
                          selectedPdfIndex={productionPdfSelectedIndex}
                          onSelectedPdfIndexChange={setProductionPdfSelectedIndex}
                        />
                      ) : firstImageAttachment &&
                        (previewTab === "image" || productionPdfRows.length === 0) ? (
                        <div className="flex min-h-0 flex-1 overflow-auto items-center justify-center p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element -- blob/external URL; avoid next/image domain config */}
                          <img
                            src={firstImageAttachment.fileUrl}
                            alt={firstImageAttachment.fileName}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      ) : (
                        <p className="p-3 text-sm text-slate-500">Žádný PDF ani obrázek v podkladech.</p>
                      )}
                    </div>
                  </div>
                }
                rightPanel={
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="z-30 shrink-0 space-y-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3
                          id="issue-form-material"
                          className="text-sm font-semibold leading-tight text-slate-900"
                        >
                          Výběr materiálu
                        </h3>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-8 shrink-0 px-2 text-xs"
                          disabled={bulkPickIds.size === 0}
                          onClick={() => addBulkPickedToQueue()}
                        >
                          Vložit vybrané ({bulkPickIds.size})
                        </Button>
                      </div>
                {/* — Výběr materiálu — */}
                <section aria-labelledby="issue-form-material" className="space-y-2">
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700">Kategorie</Label>
                      <Select value={issueCategoryFilter} onValueChange={setIssueCategoryFilter}>
                        <SelectTrigger className="border-slate-300 bg-white">
                          <SelectValue placeholder="Všechny kategorie" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200">
                          <SelectItem value="__all__">Všechny kategorie</SelectItem>
                          <SelectItem value="__none__">Bez kategorie</SelectItem>
                          {stockCategories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Label htmlFor="issue-item-select" className="text-sm font-semibold text-slate-800">
                      Skladová položka
                    </Label>
                    <Select value={issueItemId || undefined} onValueChange={setIssueItemId}>
                      <SelectTrigger
                        id="issue-item-select"
                        className="min-h-[3.25rem] border-slate-300 bg-white py-2 pl-3 pr-2 text-sm shadow-sm h-auto !items-start"
                        aria-label={
                          selectedItem
                            ? `Vybraná položka: ${selectedItem.name}, dostupné ${availableQty} ${selectedItem.unit || "ks"}`
                            : "Vyberte skladovou položku nebo zbytek"
                        }
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2 py-0.5 text-left">
                          {selectedItem ? (
                            <>
                              <div className="shrink-0 self-start">
                                <InventoryItemThumbnail
                                  item={selectedItem}
                                  size={48}
                                  enableLightbox
                                  lightboxTitle={String(selectedItem.name ?? "Skladová položka")}
                                />
                              </div>
                              <div className="min-w-0 flex-1 overflow-hidden pr-1">
                                <p className="truncate text-left text-sm font-semibold leading-snug text-slate-900">
                                  {selectedItem.name}
                                  {selectedItem.isRemainder ? (
                                    <span className="font-medium text-slate-600"> · zbytek</span>
                                  ) : null}
                                </p>
                                <p className="mt-0.5 block text-left text-[11px] leading-snug text-slate-500">
                                  {selectedItem.sku ? (
                                    <span className="block truncate font-mono">{selectedItem.sku}</span>
                                  ) : null}
                                  <span className="mt-0.5 block truncate text-slate-600">
                                    <strong className="text-slate-800">{availableQty}</strong>{" "}
                                    {selectedItem.unit || "ks"}
                                    <span className="text-slate-400"> · </span>
                                    {stockModeShortLabel(selectedItem.stockTrackingMode)}
                                  </span>
                                </p>
                              </div>
                            </>
                          ) : (
                            <span className="py-1 text-sm text-slate-500">Vyberte materiál nebo zbytek</span>
                          )}
                        </div>
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 max-h-[min(26rem,72vh)] min-w-[min(calc(100vw-1.5rem),28rem)] w-[var(--radix-select-trigger-width)] max-w-[min(calc(100vw-1.5rem),28rem)] sm:w-auto sm:min-w-[var(--radix-select-trigger-width)]">
                        {issueableInventoryFiltered.length === 0 ? (
                          <div className="px-3 py-4 text-sm text-slate-500">
                            Žádná dostupná položka se zásobou.
                          </div>
                        ) : (
                          issueableInventoryFiltered.map((i) => {
                            const q = availableStockQtyForIssueForm(i);
                            return (
                              <SelectItem
                                key={i.id}
                                value={i.id}
                                textValue={`${i.name} ${i.sku || ""} ${i.unit || ""}`}
                                className="cursor-pointer items-start py-4 pl-9 pr-4"
                              >
                                <div className="flex w-full min-w-0 items-start gap-4 overflow-hidden">
                                  <div className="shrink-0 pt-0.5">
                                    <InventoryItemThumbnail
                                      item={i}
                                      size={100}
                                      enableLightbox
                                      lightboxTitle={String(i.name ?? "Skladová položka")}
                                    />
                                  </div>
                                  <div className="min-w-0 flex-1 overflow-hidden text-left">
                                    <p className="line-clamp-2 text-left text-sm font-semibold leading-snug text-slate-900 sm:text-base">
                                      {i.name}
                                      {i.isRemainder ? (
                                        <span className="font-medium text-slate-600"> (zbytek)</span>
                                      ) : null}
                                    </p>
                                    <div className="mt-2 space-y-1 text-xs leading-relaxed text-slate-500 sm:text-sm">
                                      {i.sku ? <p className="truncate">SKU: {i.sku}</p> : null}
                                      <p className="text-slate-600">
                                        Dostupné: <strong className="text-slate-800">{q}</strong> {i.unit || "ks"}
                                        <span className="text-slate-400"> · </span>
                                        {stockModeShortLabel(i.stockTrackingMode)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </SelectItem>
                            );
                          })
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </section>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 overscroll-contain">
                  {issueableInventoryFiltered.length > 0 ? (
                    <div className="mb-4 space-y-2">
                      <Label className="text-xs font-medium text-slate-700">Rychlý výběr</Label>
                      <div className="flex flex-col gap-2">
                        {issueableInventoryFiltered.slice(0, 80).map((i) => {
                          const q = availableStockQtyForIssueForm(i);
                          const active = issueItemId === i.id;
                          const spSum = stockPiecesSummaryByItem[i.id];
                          const compact =
                            String(i.stockTrackingMode) === "length"
                              ? compactLengthStockSummary(spSum)
                              : null;
                          const fullLabel = spSum && !spSum.loading ? spSum.label : "";
                          return (
                            <div
                              key={i.id}
                              className={cn(
                                "flex w-full min-w-0 items-stretch gap-2 overflow-hidden rounded-lg border shadow-sm transition-colors",
                                active
                                  ? "border-emerald-600 bg-emerald-600 text-white ring-1 ring-emerald-700/30"
                                  : "border-slate-200 bg-white"
                              )}
                            >
                              <div
                                className="flex shrink-0 items-center justify-center border-r border-slate-200/80 px-2 py-2"
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  checked={bulkPickIds.has(i.id)}
                                  onCheckedChange={() => toggleBulkPick(i.id)}
                                  aria-label={`Vybrat ${String(i.name ?? "položka")}`}
                                  className={cn(
                                    "border-slate-400 data-[state=checked]:border-emerald-700 data-[state=checked]:bg-emerald-700",
                                    active && "border-white/70 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-emerald-700"
                                  )}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => setIssueItemId(i.id)}
                                className={cn(
                                  "flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-2 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1",
                                  active ? "" : "hover:bg-slate-50/90 active:bg-slate-100"
                                )}
                              >
                                <div className="shrink-0">
                                  <InventoryItemThumbnail
                                    item={i}
                                    size={52}
                                    enableLightbox
                                    lightboxTitle={String(i.name ?? "Skladová položka")}
                                    className={cn(active && "border-white/40 ring-1 ring-white/20")}
                                  />
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden text-left">
                                  <p
                                    className={cn(
                                      "truncate text-sm font-semibold leading-tight",
                                      active ? "text-white" : "text-slate-900"
                                    )}
                                    title={String(i.name ?? "")}
                                  >
                                    {i.name}
                                    {i.isRemainder ? (
                                      <span
                                        className={cn(
                                          "font-normal",
                                          active ? "text-emerald-100" : "text-slate-600"
                                        )}
                                      >
                                        {" "}
                                        · zbytek
                                      </span>
                                    ) : null}
                                  </p>
                                  {i.sku ? (
                                    <p
                                      className={cn(
                                        "truncate text-[11px] tabular-nums",
                                        active ? "text-emerald-100/90" : "text-slate-500"
                                      )}
                                    >
                                      {i.sku}
                                    </p>
                                  ) : null}
                                  <p className={cn("truncate text-[11px]", active ? "text-emerald-50" : "text-slate-600")}>
                                    <strong className={active ? "text-white" : "text-slate-800"}>{q}</strong>{" "}
                                    {i.unit || "ks"}
                                    <span className={active ? "text-emerald-200/90" : "text-slate-400"}>
                                      {" "}
                                      · {stockModeShortLabel(i.stockTrackingMode)}
                                    </span>
                                  </p>
                                  {String(i.stockTrackingMode) === "length" && spSum ? (
                                    spSum.loading ? (
                                      <p className={cn("text-[10px]", active ? "text-emerald-100" : "text-slate-500")}>
                                        Načítám kusy…
                                      </p>
                                    ) : compact ? (
                                      fullLabel.length > compact.length + 8 ? (
                                        <details className={cn("text-[10px] leading-snug", active ? "text-emerald-100" : "text-slate-600")}>
                                          <summary className="cursor-pointer select-none hover:underline">
                                            {compact}
                                          </summary>
                                          <p className="mt-1 whitespace-pre-wrap break-words pl-1 text-[10px] opacity-90">
                                            {fullLabel}
                                          </p>
                                        </details>
                                      ) : (
                                        <p className={cn("text-[10px] leading-snug", active ? "text-emerald-100" : "text-slate-600")}>
                                          {compact}
                                        </p>
                                      )
                                    ) : null
                                  ) : null}
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {selectedItem ? (
                    <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-900/90">
                        Vybraná položka
                      </p>
                      <div className="flex items-start gap-2">
                        <InventoryItemThumbnail
                          item={selectedItem}
                          size={56}
                          enableLightbox
                          lightboxTitle={String(selectedItem.name ?? "Skladová položka")}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1 space-y-1 text-xs leading-snug text-slate-800">
                          <p className="truncate font-medium text-slate-900" title={String(selectedItem.name ?? "")}>
                            {selectedItem.name}
                          </p>
                          <p>
                            Dostupné:{" "}
                            <strong className="text-sm text-slate-900">
                              {availableQty} {selectedItem.unit || "ks"}
                            </strong>
                          </p>
                          {String(selectedItem.stockTrackingMode || "") === "length" ? (
                            <p className="line-clamp-2 text-[11px] text-slate-600">
                              Metráž: zůstatek zůstane na řádce skladu.
                            </p>
                          ) : null}
                          {issueQueue.some((l) => l.itemId === selectedItem.id) ? (
                            <p className="line-clamp-2 text-[11px] text-slate-600">
                              Po seznamu výdeje zbývá: <strong>{availableQty}</strong> {selectedItem.unit || "ks"}.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                {/* — Množství a řez — */}
                <section
                  aria-labelledby="issue-form-qty"
                  className="space-y-3 border-t border-slate-200 pt-4"
                >
                  <h3
                    id="issue-form-qty"
                    className="border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900"
                  >
                    Množství a řez
                  </h3>

                  {selectedItem &&
                  String(selectedItem.stockTrackingMode) === "length" &&
                  !lengthUnitEditable ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-relaxed text-amber-950">
                      Skladová jednotka není mm/cm/m — zadejte odebrané množství přímo ve stejné jednotce, v jaké je
                      položka vedena na skladě.
                    </div>
                  ) : null}

                  <div
                    className={`grid grid-cols-1 gap-3 sm:gap-4 ${
                      selectedItem &&
                      String(selectedItem.stockTrackingMode) === "length" &&
                      lengthUnitEditable
                        ? "lg:grid-cols-2"
                        : ""
                    }`}
                  >
                    {selectedItem &&
                    String(selectedItem.stockTrackingMode) === "length" &&
                    lengthUnitEditable ? (
                      <div className="space-y-3">
                        <Label htmlFor="issue-length-unit" className="text-sm font-semibold text-slate-800">
                          Jednotka zadání délky
                        </Label>
                        <Select
                          value={issueInputLengthUnit}
                          onValueChange={(v) => setIssueInputLengthUnit(v as "mm" | "cm" | "m")}
                        >
                          <SelectTrigger
                            id="issue-length-unit"
                            className="min-h-12 border-slate-300 bg-white px-4 text-base shadow-sm lg:max-w-md"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-slate-200">
                            <SelectItem value="mm" className="py-2.5 text-base">
                              mm
                            </SelectItem>
                            <SelectItem value="cm" className="py-2.5 text-base">
                              cm
                            </SelectItem>
                            <SelectItem value="m" className="py-2.5 text-base">
                              m
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <div
                      className={`space-y-3 ${
                        !(
                          selectedItem &&
                          String(selectedItem.stockTrackingMode) === "length" &&
                          lengthUnitEditable
                        )
                          ? "lg:col-span-2"
                          : ""
                      }`}
                    >
                      <Label htmlFor="issue-qty-input" className="text-sm font-semibold text-slate-800">
                        Odebrané množství
                      </Label>
                      <Input
                        id="issue-qty-input"
                        className="min-h-12 max-w-full border-slate-300 bg-white px-4 py-3 text-base shadow-sm sm:max-w-md lg:max-w-lg"
                        inputMode="decimal"
                        value={issueQty}
                        onChange={(e) => setIssueQty(e.target.value)}
                        placeholder={
                          selectedItem
                            ? lengthUnitEditable && String(selectedItem.stockTrackingMode) === "length"
                              ? `např. 5000 (${issueInputLengthUnit})`
                              : `max ${availableQty} ${selectedItem.unit || ""}`
                            : ""
                        }
                      />
                      {selectedItem && String(selectedItem.stockTrackingMode) === "length" ? (
                        <div className="mt-4 space-y-2">
                          <Label
                            htmlFor="issue-repeat-count"
                            className="text-sm font-semibold text-slate-800"
                          >
                            Počet stejných řezů
                          </Label>
                          <Input
                            id="issue-repeat-count"
                            className="min-h-12 max-w-full border-slate-300 bg-white px-4 py-3 text-base shadow-sm sm:max-w-[12rem]"
                            inputMode="numeric"
                            value={issueRepeatCount}
                            onChange={(e) => setIssueRepeatCount(e.target.value)}
                            placeholder="např. 3"
                          />
                          <p className="text-xs text-slate-600">
                            Celkem se odečte (počet × délka řezu). Sklad vybere nejdelší dostupný kus, při
                            potřebě další.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {selectedItem &&
                  (remainderPreview != null || String(selectedItem.stockTrackingMode) === "length") ? (
                    <div className="space-y-4 rounded-lg border border-sky-200/90 bg-sky-50/60 p-4 sm:p-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-950/80">
                        Přehled zbytku po výdeji
                      </p>
                      {remainderPreview != null ? (
                        <p className="text-sm leading-relaxed text-slate-800">
                          Po výdeji zbude na skladě (stejná jednotka jako zásoba):{" "}
                          <strong className="text-base text-slate-900">
                            {remainderPreview.toFixed(4).replace(/\.?0+$/, "")}
                          </strong>{" "}
                          {selectedItem.unit || ""}
                        </p>
                      ) : null}
                      {String(selectedItem.stockTrackingMode) === "length" ? (
                        <LengthCutSummary
                          item={selectedItem}
                          issueQtyStr={issueQty}
                          repeatCountStr={issueRepeatCount}
                          inputUnit={lengthUnitEditable ? issueInputLengthUnit : null}
                          availableInStockUnit={availableQty}
                        />
                      ) : null}
                    </div>
                  ) : null}

                    <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="issue-batch" className="text-xs font-semibold text-slate-700">
                          Šarže (volitelně)
                        </Label>
                        <Input
                          id="issue-batch"
                          className="min-h-10 border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                          value={issueBatch}
                          onChange={(e) => setIssueBatch(e.target.value)}
                          placeholder="Číslo šarže"
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor="issue-note" className="text-xs font-semibold text-slate-700">
                          Poznámka k výdeji
                        </Label>
                        <Textarea
                          id="issue-note"
                          className="min-h-[72px] resize-y border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                          value={issueNote}
                          onChange={(e) => setIssueNote(e.target.value)}
                          placeholder="Doplňující informace k výdeji…"
                        />
                      </div>
                    </div>
                </section>
                    </div>
                  </div>
                }
                bottomPanel={
                  <div className="space-y-4">
                {/* — Materiál pro zakázku — */}
                <section
                  aria-labelledby="issue-queue-heading"
                  className="space-y-4"
                >
                  <h3
                    id="issue-queue-heading"
                    className="border-b border-slate-200 pb-2 text-base font-semibold text-slate-900"
                  >
                    Materiál pro zakázku
                  </h3>
                  <p className="text-sm text-slate-600 max-w-3xl">
                    Přidejte řádky (více skladových položek i různé řezy). Hromadný výdej proběhne v jedné transakci;
                    při nedostatku skladu se nic neuloží.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-800">
                    <label className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={attachDrawingToExport}
                        onCheckedChange={(c) => setAttachDrawingToExport(c === true)}
                      />
                      <span>Přiložit výkres do PDF</span>
                    </label>
                    <span className="text-xs text-slate-500">
                      Aktuální náhled vlevo (PDF nebo obrázek).
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-10 gap-1"
                      disabled={!selectedItem}
                      onClick={() => addCurrentFormToIssueQueue()}
                    >
                      <Plus className="h-4 w-4" />
                      Přidat do seznamu
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 gap-1"
                      disabled={!issueItemId}
                      onClick={() => addSameStockLineAgain()}
                    >
                      Stejná položka znovu
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-10 gap-1 bg-emerald-700 text-white hover:bg-emerald-800"
                      disabled={bulkSaving || issueQueue.length === 0}
                      onClick={() => void submitBulkIssue()}
                    >
                      {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Odebrat vše ze skladu
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 gap-1"
                      onClick={() => void runProductionWorksheetPdf("download")}
                    >
                      <FileDown className="h-4 w-4" />
                      Exportovat výrobní podklad do PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 gap-1"
                      onClick={() => void runProductionWorksheetPdf("print")}
                    >
                      <Printer className="h-4 w-4" />
                      Vytisknout výrobní podklad
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 gap-1"
                      disabled={issueQueue.length === 0}
                      onClick={() =>
                        void runA4WorkListExport("download", "single", activeProductionDrawingKey, {
                          includeUnassigned: a4IncludeUnassigned,
                        })
                      }
                    >
                      <FileDown className="h-4 w-4" />
                      Export A4 výrobní list
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 gap-1"
                      disabled={issueQueue.length === 0}
                      onClick={() => void runA4WorkListExport("download", "all", null)}
                    >
                      Export A4 — všechna PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-10 gap-1"
                      disabled={issueQueue.length === 0}
                      onClick={() =>
                        void runA4WorkListExport("print", "single", activeProductionDrawingKey, {
                          includeUnassigned: a4IncludeUnassigned,
                        })
                      }
                    >
                      <Printer className="h-4 w-4" />
                      Vytisknout A4 výrobní list
                    </Button>
                  </div>
                  {issueQueue.length === 0 ? (
                    <p className="text-sm text-slate-500">Seznam je prázdný — použijte „Přidat do výdeje“.</p>
                  ) : (
                    <>
                      <div className="hidden max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white lg:block">
                        <table className="w-full min-w-[52rem] text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-600">
                              <th className="w-12 p-1.5 font-semibold" aria-label="Náhled" />
                              <th className="max-w-[10rem] p-1.5 font-semibold">Položka</th>
                              <th className="p-1.5 font-semibold whitespace-nowrap">Dostupné</th>
                              <th className="max-w-[11rem] p-1.5 font-semibold">Sklad / kusy</th>
                              <th className="p-1.5 font-semibold whitespace-nowrap">Řez / množství</th>
                              <th className="p-1.5 font-semibold whitespace-nowrap">Opak.</th>
                              <th className="p-1.5 font-semibold whitespace-nowrap">Jednotka</th>
                              <th className="max-w-[9rem] p-1.5 font-semibold">Výkres PDF</th>
                              <th className="max-w-[9rem] p-1.5 font-semibold">Poznámka</th>
                              <th className="p-1.5 font-semibold whitespace-nowrap">Stav</th>
                              <th className="w-36 p-1.5 font-semibold">Akce</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issueQueue.map((ln, rowIdx) => {
                              const inv = inventoryById.get(ln.itemId);
                              const prior = issueQueue.slice(0, rowIdx);
                              const rowAvail = inv ? projectedAvailableForItem(inv, prior) : 0;
                              const unitLabel = inv?.unit || "ks";
                              const lenEd = inv ? lengthUnitEditableForItem(inv) : false;
                              const spRow = stockPiecesSummaryByItem[ln.itemId];
                              const stockCell =
                                inv && String(inv.stockTrackingMode) === "length" && spRow
                                  ? spRow.loading
                                    ? "…"
                                    : spRow.label
                                  : "—";
                              return (
                                <tr key={ln.key} className="border-t border-slate-100 align-top">
                                  <td className="p-1.5">
                                    <InventoryItemThumbnail item={inv} size={40} />
                                  </td>
                                  <td className="max-w-[10rem] p-1.5">
                                    <p className="truncate font-medium text-slate-900" title={inv?.name ?? ln.itemId}>
                                      {inv?.name ?? ln.itemId}
                                    </p>
                                    <p className="truncate text-[10px] text-slate-500 font-mono" title={ln.itemId}>
                                      {ln.itemId}
                                    </p>
                                  </td>
                                  <td className="p-1.5 tabular-nums text-slate-800 whitespace-nowrap">
                                    {inv ? rowAvail : "—"} {unitLabel}
                                  </td>
                                  <td className="max-w-[11rem] p-1.5 text-xs text-slate-700">
                                    <p className="line-clamp-2 break-words" title={stockCell === "—" ? undefined : stockCell}>
                                      {stockCell}
                                    </p>
                                  </td>
                                  <td className="p-1.5 tabular-nums font-medium whitespace-nowrap">{ln.qtyStr}</td>
                                  <td className="p-1.5 tabular-nums text-slate-700 whitespace-nowrap">
                                    {inv && String(inv.stockTrackingMode) === "length"
                                      ? ln.repeatCountStr || "1"
                                      : "—"}
                                  </td>
                                  <td className="p-1.5 text-xs text-slate-600 whitespace-nowrap">
                                    {lenEd ? (ln.inputLengthUnit || "—") : unitLabel}
                                  </td>
                                  <td className="max-w-[9rem] p-1 align-top">
                                    <Select
                                      value={ln.productionDrawingKey || "__none__"}
                                      onValueChange={(v) =>
                                        setIssueQueue((q) =>
                                          q.map((x) =>
                                            x.key === ln.key
                                              ? { ...x, productionDrawingKey: v === "__none__" ? null : v }
                                              : x
                                          )
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-8 border-slate-300 bg-white text-[10px]">
                                        <SelectValue placeholder="—" />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white border-slate-200">
                                        <SelectItem value="__none__">Nepřiřazeno</SelectItem>
                                        {productionPdfRows.map((r) => (
                                          <SelectItem key={r.id} value={r.id} className="text-xs">
                                            {r.fileName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </td>
                                  <td className="max-w-[9rem] p-1.5 text-xs text-slate-700">
                                    <p className="line-clamp-2 break-words" title={ln.note || undefined}>
                                      {ln.note || "—"}
                                    </p>
                                    {ln.batchNumber ? (
                                      <span className="mt-0.5 block truncate text-[10px] text-slate-500" title={ln.batchNumber}>
                                        Šarže: {ln.batchNumber}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="p-1.5 text-xs font-medium text-amber-800 whitespace-nowrap">
                                    Připraveno
                                  </td>
                                  <td className="p-1.5">
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => openEditIssueQueueLine(ln)}
                                      >
                                        Upravit
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs text-red-700 hover:text-red-800"
                                        onClick={() => removeIssueQueueLine(ln.key)}
                                      >
                                        Odebrat
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="space-y-2 lg:hidden">
                        {issueQueue.map((ln, rowIdx) => {
                          const inv = inventoryById.get(ln.itemId);
                          const prior = issueQueue.slice(0, rowIdx);
                          const rowAvail = inv ? projectedAvailableForItem(inv, prior) : 0;
                          const unitLabel = inv?.unit || "ks";
                          const lenEd = inv ? lengthUnitEditableForItem(inv) : false;
                          const spRow = stockPiecesSummaryByItem[ln.itemId];
                          const stockCell =
                            inv && String(inv.stockTrackingMode) === "length" && spRow
                              ? spRow.loading
                                ? "…"
                                : spRow.label
                              : "—";
                          return (
                            <div
                              key={ln.key}
                              className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm"
                            >
                              <div className="flex gap-3">
                                <InventoryItemThumbnail item={inv} size={44} className="shrink-0" />
                                <div className="min-w-0 flex-1 space-y-1">
                                  <p className="font-medium leading-snug text-slate-900">{inv?.name ?? ln.itemId}</p>
                                  <p className="truncate text-[11px] text-slate-500 font-mono">{ln.itemId}</p>
                                  <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-700">
                                    <dt className="text-slate-500">Dostupné</dt>
                                    <dd className="tabular-nums text-right">
                                      {inv ? rowAvail : "—"} {unitLabel}
                                    </dd>
                                    <dt className="text-slate-500">Sklad / kusy</dt>
                                    <dd className="text-right text-[11px] leading-snug line-clamp-3">{stockCell}</dd>
                                    <dt className="text-slate-500">Řez / množství</dt>
                                    <dd className="tabular-nums text-right font-medium">{ln.qtyStr}</dd>
                                    <dt className="text-slate-500">Opakování</dt>
                                    <dd className="tabular-nums text-right">
                                      {inv && String(inv.stockTrackingMode) === "length"
                                        ? ln.repeatCountStr || "1"
                                        : "—"}
                                    </dd>
                                    <dt className="text-slate-500">Jednotka</dt>
                                    <dd className="text-right">{lenEd ? (ln.inputLengthUnit || "—") : unitLabel}</dd>
                                    <dt className="text-slate-500 col-span-2">Výkres PDF</dt>
                                    <dd className="col-span-2">
                                      <Select
                                        value={ln.productionDrawingKey || "__none__"}
                                        onValueChange={(v) =>
                                          setIssueQueue((q) =>
                                            q.map((x) =>
                                              x.key === ln.key
                                                ? { ...x, productionDrawingKey: v === "__none__" ? null : v }
                                                : x
                                            )
                                          )
                                        }
                                      >
                                        <SelectTrigger className="h-9 w-full border-slate-300 bg-white text-xs">
                                          <SelectValue placeholder="—" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border-slate-200">
                                          <SelectItem value="__none__">Nepřiřazeno</SelectItem>
                                          {productionPdfRows.map((r) => (
                                            <SelectItem key={r.id} value={r.id}>
                                              {r.fileName}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </dd>
                                    <dt className="text-slate-500">Poznámka</dt>
                                    <dd className="text-right text-[11px] line-clamp-3 break-words">{ln.note || "—"}</dd>
                                    {ln.batchNumber ? (
                                      <>
                                        <dt className="text-slate-500">Šarže</dt>
                                        <dd className="truncate text-right text-[11px]">{ln.batchNumber}</dd>
                                      </>
                                    ) : null}
                                    <dt className="text-slate-500">Stav</dt>
                                    <dd className="text-right font-medium text-amber-800">Připraveno</dd>
                                  </dl>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 flex-1 min-w-[8rem]"
                                  onClick={() => openEditIssueQueueLine(ln)}
                                >
                                  Upravit množství
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 flex-1 min-w-[8rem] text-red-700 hover:text-red-800"
                                  onClick={() => removeIssueQueueLine(ln.key)}
                                >
                                  Odebrat
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>

                <div className="border-t border-slate-200 pt-6 space-y-3">
                  <p className="text-xs text-slate-600 max-w-2xl">
                    Jednorázový výdej bez fronty: šarže a poznámku vyplňte vpravo v sekci nad tímto seznamem, pak
                    potvrďte zde.
                  </p>
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-12 w-full px-8 text-base sm:w-auto"
                    disabled={issueSaving || !selectedItem}
                    onClick={() => void submitIssue()}
                  >
                    {issueSaving ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      "Odebrat ze skladu a zapsat na zakázku (jeden řádek)"
                    )}
                  </Button>
                </div>
              </div>
            }
          />
            </CardContent>
          </Card>
          </ProductionIssuePanelShell>

          {companyId && jobId && jobView && user ? (
            <JobMaterialOrdersSection
              companyId={companyId}
              companyDisplayName={companyDisplayNameForOrders}
              jobId={String(jobId)}
              job={materialOrderJobRecord}
              customerName={materialOrderCustomerName}
              customerAddressLines={materialOrderCustomerAddress}
              userId={user.uid}
              canManage={accessOk}
              productionMaterialLines={productionMaterialLinesForOrder}
              companyDoc={companyDocForOrders}
            />
          ) : null}

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Spotřebovaný materiál
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-5 text-sm">
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-2">Souhrn podle položek</p>
                {consumptionSummary.length === 0 ? (
                  <p className="text-slate-600 text-xs">Zatím žádná spotřeba.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {consumptionSummary.map((row) => {
                      const inv = row.itemId ? inventoryById.get(row.itemId) : undefined;
                      return (
                        <li
                          key={`${row.name}-${row.unit}-${row.itemId || ""}`}
                          className="flex items-center gap-2 border-b border-slate-100 pb-2"
                        >
                          <InventoryItemThumbnail item={inv} size={48} />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900">{row.name}</p>
                            {inv?.sku ? (
                              <p className="text-[11px] text-slate-500">SKU: {inv.sku}</p>
                            ) : null}
                            {inv ? (
                              <p className="text-[11px] text-slate-500">
                                {stockModeShortLabel(inv.stockTrackingMode)}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 tabular-nums">
                            {row.qty} {row.unit}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-900 mb-2">Historie odběrů</p>
                {consumptions.length === 0 ? (
                  <p className="text-slate-600 text-xs">Zatím žádné výdeje.</p>
                ) : (
                  <div className="space-y-2">
                    {consumptions.map((c, idx) => {
                      const bulkIdRaw = (c as { bulkIssueGroupId?: unknown }).bulkIssueGroupId;
                      const bulkId =
                        typeof bulkIdRaw === "string" && bulkIdRaw.trim() ? bulkIdRaw.trim() : "";
                      if (bulkId) {
                        if (bulkRepresentativeIdx.get(bulkId) !== idx) return null;
                        const lines = consumptions
                          .filter(
                            (x) =>
                              typeof (x as { bulkIssueGroupId?: unknown }).bulkIssueGroupId === "string" &&
                              String((x as { bulkIssueGroupId: string }).bulkIssueGroupId).trim() === bulkId
                          )
                          .sort(
                            (a, b) =>
                              Number((a as { bulkIssueLineIndex?: unknown }).bulkIssueLineIndex ?? 0) -
                              Number((b as { bulkIssueLineIndex?: unknown }).bulkIssueLineIndex ?? 0)
                          );
                        const head = lines[0] ?? c;
                        const whoHead =
                          typeof head.createdByName === "string" && head.createdByName.trim()
                            ? head.createdByName.trim()
                            : typeof head.authUserId === "string"
                              ? head.authUserId
                              : typeof head.employeeId === "string"
                                ? `zaměstnanec ${head.employeeId}`
                                : "—";
                        const whenHead = formatConsumptionCreatedAt(head.createdAt);
                        return (
                          <div
                            key={`bulk-${bulkId}`}
                            className="rounded border-2 border-emerald-200/90 bg-emerald-50/30 p-3 text-slate-800"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <Badge className="bg-emerald-800 text-white hover:bg-emerald-800">
                                Hromadný výdej
                              </Badge>
                              <span className="text-[11px] text-slate-600">
                                {lines.length} položek
                                {whenHead ? <> · {whenHead}</> : null}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 mb-2">
                              Vydal: <strong>{whoHead}</strong>
                            </p>
                            <ul className="space-y-3 border-t border-emerald-100/80 pt-2">
                              {lines.map((line) => {
                                const row = line as Record<string, unknown>;
                                const lid = String(row.id ?? "");
                                const srcIdL =
                                  typeof row.sourceStockItemId === "string" && row.sourceStockItemId.trim()
                                    ? row.sourceStockItemId
                                    : typeof row.inventoryItemId === "string"
                                      ? row.inventoryItemId
                                      : "";
                                const invL =
                                  (typeof row.inventoryItemId === "string" && row.inventoryItemId.trim()
                                    ? inventoryById.get(row.inventoryItemId.trim())
                                    : undefined) ||
                                  (typeof row.sourceStockItemId === "string" && row.sourceStockItemId.trim()
                                    ? inventoryById.get(row.sourceStockItemId.trim())
                                    : undefined);
                                const whoLine =
                                  typeof row.createdByName === "string" && row.createdByName.trim()
                                    ? row.createdByName.trim()
                                    : typeof row.authUserId === "string"
                                      ? row.authUserId
                                      : typeof row.employeeId === "string"
                                        ? `zaměstnanec ${row.employeeId}`
                                        : "—";
                                const whenLine = formatConsumptionCreatedAt(row.createdAt);
                                return (
                                  <li
                                    key={lid || `ln-${bulkId}-${String(row.bulkIssueLineIndex ?? "")}`}
                                    className="rounded border border-white/80 bg-white/90 p-2 text-sm"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="flex min-w-0 flex-1 items-start gap-2">
                                        <InventoryItemThumbnail item={invL} size={40} />
                                        <span className="min-w-0 font-medium leading-snug">
                                          {String(row.itemName ?? "")}
                                        </span>
                                      </div>
                                      <span className="shrink-0 text-right text-sm">
                                        −<strong>{String(row.quantity ?? "")}</strong> {String(row.unit ?? "")}
                                        {row.inputLengthUnit ? (
                                          <span className="text-xs text-slate-500">
                                            {" "}
                                            (zadáno v {String(row.inputLengthUnit)})
                                          </span>
                                        ) : null}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-1 font-mono break-all">
                                      {srcIdL || "—"}
                                    </p>
                                    {row.note ? <p className="text-xs mt-1">{String(row.note)}</p> : null}
                                    {Array.isArray(row.stockPieceAllocations) &&
                                    (row.stockPieceAllocations as unknown[]).length > 0 ? (
                                      <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                                        Řezy ze skladu:{" "}
                                        {(row.stockPieceAllocations as Record<string, unknown>[])
                                          .map((a) => {
                                            const u = a.usedLengthMm;
                                            const r = a.remainingAfterMm;
                                            const pid = String(a.pieceId || "").slice(0, 8);
                                            return `kus ${pid}… −${Number(u).toFixed(1)} mm → zbývá ${Number(r).toFixed(1)} mm`;
                                          })
                                          .join("; ")}
                                      </p>
                                    ) : null}
                                    <p className="text-[11px] text-slate-500 mt-1">
                                      {whoLine}
                                      {whenLine ? <> · {whenLine}</> : null}
                                    </p>
                                    {isPrivilegedViewer ? (
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 gap-2 border-slate-300 bg-white text-slate-900"
                                          onClick={() => openEditConsumption(row)}
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                          Upravit
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
                                          onClick={() => setDeleteConsumptionTarget(row)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                          Smazat
                                        </Button>
                                      </div>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      }

                      const srcId =
                        typeof c.sourceStockItemId === "string" && c.sourceStockItemId.trim()
                          ? c.sourceStockItemId
                          : typeof c.inventoryItemId === "string"
                            ? c.inventoryItemId
                            : "";
                      const invForThumb =
                        (typeof c.inventoryItemId === "string" && c.inventoryItemId.trim()
                          ? inventoryById.get(c.inventoryItemId.trim())
                          : undefined) ||
                        (typeof c.sourceStockItemId === "string" && c.sourceStockItemId.trim()
                          ? inventoryById.get(c.sourceStockItemId.trim())
                          : undefined) ||
                        (typeof c.parentStockItemId === "string" && c.parentStockItemId.trim()
                          ? inventoryById.get(c.parentStockItemId.trim())
                          : undefined);
                      const who =
                        typeof c.createdByName === "string" && c.createdByName.trim()
                          ? c.createdByName.trim()
                          : typeof c.authUserId === "string"
                            ? c.authUserId
                            : typeof c.employeeId === "string"
                              ? `zaměstnanec ${c.employeeId}`
                              : "—";
                      const when = formatConsumptionCreatedAt(c.createdAt);
                      return (
                        <div
                          key={String(c.id ?? `c-${idx}`)}
                          className="rounded border border-slate-100 p-3 text-slate-800 bg-white"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-start gap-2">
                              <InventoryItemThumbnail item={invForThumb} size={48} />
                              <span className="min-w-0 font-medium leading-snug">
                                {String(c.itemName ?? "")}
                              </span>
                            </div>
                            <span className="shrink-0 text-right text-sm">
                              Odebráno: <strong>−{String(c.quantity ?? "")}</strong> {String(c.unit ?? "")}
                              {c.inputLengthUnit ? (
                                <span className="text-xs text-slate-500"> (zadáno v {String(c.inputLengthUnit)})</span>
                              ) : null}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">
                            Ze skladové položky:{" "}
                            <code className="text-[11px] bg-slate-100 px-1 rounded">{srcId || "—"}</code>
                            {typeof c.parentStockItemId === "string" && c.parentStockItemId.trim() ? (
                              <>
                                {" "}
                                · původní řádka:{" "}
                                <code className="text-[11px] bg-slate-100 px-1 rounded">
                                  {c.parentStockItemId}
                                </code>
                              </>
                            ) : null}
                          </p>
                          {typeof c.originalQuantity === "number" ||
                          typeof c.quantityBeforeOnHand === "number" ||
                          c.quantityRemainingOnStock != null ? (
                            <p className="text-xs text-slate-600 mt-1">
                              Před výdejem na řádce:{" "}
                              <strong>
                                {String(
                                  typeof c.originalQuantity === "number"
                                    ? c.originalQuantity
                                    : c.quantityBeforeOnHand ?? "—"
                                )}
                              </strong>{" "}
                              {String(c.unit ?? "")}
                              {typeof c.remainingQuantityAfterCut === "number" ? (
                                <>
                                  {" "}
                                  · zůstalo po řezu / na skladě:{" "}
                                  <strong>{String(c.remainingQuantityAfterCut)}</strong> {String(c.unit ?? "")}
                                </>
                              ) : c.quantityRemainingOnStock != null ? (
                                <>
                                  {" "}
                                  → na skladě zůstalo:{" "}
                                  <strong>{String(c.quantityRemainingOnStock)}</strong> {String(c.unit ?? "")}
                                </>
                              ) : null}
                            </p>
                          ) : null}
                          {typeof c.quantityUsed === "number" ? (
                            <p className="text-xs text-slate-700 mt-0.5">
                              Spotřeba (quantityUsed): <strong>{String(c.quantityUsed)}</strong>{" "}
                              {String(c.unit ?? "")}
                            </p>
                          ) : null}
                          {c.remainderCreated === true || c.remainderItemId || c.remainderId ? (
                            <p className="text-xs text-amber-800 mt-1">
                              Vznikl zbytek (nová skladová položka)
                              {typeof (c.remainderId || c.remainderItemId) === "string" ? (
                                <>
                                  :{" "}
                                  <code className="text-[11px]">
                                    {String(c.remainderId || c.remainderItemId)}
                                  </code>
                                </>
                              ) : null}
                            </p>
                          ) : null}
                          <p className="text-[11px] text-slate-500 mt-1.5">
                            Vzal: <strong>{who}</strong>
                            {when ? (
                              <>
                                {" "}
                                · {when}
                              </>
                            ) : null}
                          </p>
                          {c.note ? <p className="text-xs mt-1">{String(c.note)}</p> : null}
                          {isPrivilegedViewer ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2 border-slate-300 bg-white text-slate-900"
                                onClick={() => openEditConsumption(c)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Upravit
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
                                onClick={() => setDeleteConsumptionTarget(c)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Smazat
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Zbytky materiálu
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm text-slate-800">
              <p className="text-xs text-slate-600">
                U nových výdejů zůstává zbytek metráže na stejné řádce. Starší záznamy mohly vytvořit samostatný
                řádek „zbytek“ — ty znovu vyberete ve výběru materiálu výše.
              </p>
              {remainderInventoryRows.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-slate-600 text-sm">Zatím žádné zbytky vázané na tuto zakázku.</p>
                  {remainderRows.length > 0 ? (
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                      V historii výdejů jsou zmínky o zbytcích, ale položky se v načteném výřezu skladu neobjevily
                      (např. limit načtených položek). Zkuste znovu načíst stránku nebo ověřit záznam ve skladu.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="overflow-x-auto rounded border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs uppercase text-slate-600">
                        <th className="w-14 p-2 font-semibold" aria-label="Náhled" />
                        <th className="p-2 font-semibold">Materiál</th>
                        <th className="p-2 font-semibold">Původní položka</th>
                        <th className="p-2 font-semibold">Zbývá</th>
                        <th className="p-2 font-semibold">Jednotka</th>
                        <th className="p-2 font-semibold">Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {remainderInventoryRows.map((row) => {
                        const parentId = String(row.remainderOfItemId || row.parentStockItemId || "").trim();
                        const parent = parentId ? inventoryById.get(parentId) : undefined;
                        const parentLabel = parent
                          ? `${parent.name} (${parentId})`
                          : parentId || "—";
                        const mode = String(row.stockTrackingMode || "pieces");
                        const qtyLeft =
                          mode === "length" && row.currentLength != null && Number.isFinite(Number(row.currentLength))
                            ? Number(row.currentLength)
                            : Number(row.quantity ?? 0);
                        const used = row.remainderFullyConsumed === true;
                        const free = !used && row.remainderAvailable !== false;
                        const rs = String(row.remainderStatus || "").toLowerCase();
                        const statusLabel =
                          rs === "used" || used
                            ? "Použitý / uzavřený"
                            : rs === "reserved"
                              ? "Rezervovaný"
                              : free
                                ? "Volný"
                                : "Blokováno / ne k výdeji";
                        return (
                          <tr key={row.id} className="border-t border-slate-100 align-top">
                            <td className="p-2 align-middle">
                              <InventoryItemThumbnail item={remainderRowHeroThumb(row, parent)} size={48} />
                            </td>
                            <td className="p-2 font-medium">
                              <div className="flex items-center gap-2">
                                <span>{row.name}</span>
                              </div>
                              <p className="mt-0.5 text-[11px] font-normal text-slate-500">
                                {stockModeShortLabel(row.stockTrackingMode)}
                              </p>
                            </td>
                            <td className="p-2 text-xs text-slate-700 break-all">
                              <div className="flex items-start gap-2">
                                {parent ? (
                                  <InventoryItemThumbnail item={parent} size={40} className="mt-0.5" />
                                ) : null}
                                <span className="min-w-0 flex-1">{parentLabel}</span>
                              </div>
                            </td>
                            <td className="p-2 tabular-nums">{qtyLeft}</td>
                            <td className="p-2">{row.unit || "—"}</td>
                            <td className="p-2 text-xs">{statusLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-sky-600" />
                Výrobní podklady
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ProductionMediaGallery
                jobId={String(jobId)}
                files={attachmentFiles}
                loading={attachmentsLoading}
                noVisibleFolders={visibleFolders.length === 0}
                isPrivilegedViewer={isPrivilegedViewer}
                onOpenCsvMaterial={(src) => setCsvMaterialDialog(src)}
                omitPdfSection
              />
            </CardContent>
          </Card>

          <Dialog
            open={editConsumptionOpen}
            onOpenChange={(o) => {
              setEditConsumptionOpen(o);
              if (!o) {
                setEditConsumptionRow(null);
                setEditConsumptionQty("");
                setEditConsumptionNote("");
              }
            }}
          >
            <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-lg" data-portal-dialog>
              <DialogHeader>
                <DialogTitle>Upravit spotřebu materiálu</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label>Množství</Label>
                  <Input
                    className="bg-white"
                    value={editConsumptionQty}
                    onChange={(e) => setEditConsumptionQty(e.target.value)}
                    inputMode="decimal"
                    disabled={editConsumptionBusy}
                  />
                  <p className="text-xs text-slate-500">
                    Při navýšení se odečte rozdíl ze skladu, při snížení se rozdíl vrátí na sklad. U výdejů se
                    zbytkem se upravuje množství na řádce zbytku (admin).
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Poznámka</Label>
                  <Textarea
                    className="bg-white"
                    value={editConsumptionNote}
                    onChange={(e) => setEditConsumptionNote(e.target.value)}
                    disabled={editConsumptionBusy}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 bg-white"
                  disabled={editConsumptionBusy}
                  onClick={() => setEditConsumptionOpen(false)}
                >
                  Zrušit
                </Button>
                <Button type="button" disabled={editConsumptionBusy} onClick={() => void saveEditedConsumption()}>
                  {editConsumptionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={queueEditOpen}
            onOpenChange={(o) => {
              if (!o) {
                setQueueEditOpen(false);
                setQueueEditLine(null);
                setQueueEditRepeatStr("1");
                setQueueEditDrawingKey(null);
              }
            }}
          >
            <DialogContent className="bg-white border-slate-200 text-slate-900 sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Upravit množství ve výdeji</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Label htmlFor="queue-edit-qty">Množství</Label>
                <Input
                  id="queue-edit-qty"
                  className="bg-white"
                  value={queueEditQtyStr}
                  onChange={(e) => setQueueEditQtyStr(e.target.value)}
                  inputMode="decimal"
                />
                {queueEditLine &&
                inventoryById.get(queueEditLine.itemId) &&
                String(inventoryById.get(queueEditLine.itemId)!.stockTrackingMode) === "length" ? (
                  <div className="space-y-1">
                    <Label htmlFor="queue-edit-repeat">Počet stejných řezů</Label>
                    <Input
                      id="queue-edit-repeat"
                      className="bg-white"
                      value={queueEditRepeatStr}
                      onChange={(e) => setQueueEditRepeatStr(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label>Výkres PDF (řádek materiálu)</Label>
                  <Select
                    value={queueEditDrawingKey || "__none__"}
                    onValueChange={(v) => setQueueEditDrawingKey(v === "__none__" ? null : v)}
                  >
                    <SelectTrigger className="bg-white border-slate-300">
                      <SelectValue placeholder="Nepřiřazeno" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      <SelectItem value="__none__">Nepřiřazeno</SelectItem>
                      {productionPdfRows.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.fileName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-slate-500">
                  Jednotka zadání odpovídá řádku ve frontě (mm/cm/m u metráže, jinak přímo ve skladové jednotce).
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-300 bg-white"
                  onClick={() => {
                    setQueueEditOpen(false);
                    setQueueEditLine(null);
                    setQueueEditDrawingKey(null);
                  }}
                >
                  Zrušit
                </Button>
                <Button type="button" onClick={() => saveIssueQueueLineQty()}>
                  Uložit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={!!deleteConsumptionTarget}
            onOpenChange={(o) => {
              if (!o) setDeleteConsumptionTarget(null);
            }}
          >
            <AlertDialogContent className="bg-white border-slate-200 text-slate-900">
              <AlertDialogHeader>
                <AlertDialogTitle>Smazat záznam spotřeby?</AlertDialogTitle>
                <AlertDialogDescription>
                  Opravdu chcete smazat tento záznam? Materiál se obvykle vrátí na sklad; pokud už původní
                  skladová položka neexistuje, záznam se smaže bez vrácení a zobrazí se upozornění.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-slate-300 bg-white" disabled={editConsumptionBusy}>
                  Zrušit
                </AlertDialogCancel>
                <Button
                  type="button"
                  className="bg-red-600 text-white hover:bg-red-700"
                  disabled={editConsumptionBusy}
                  onClick={() => void confirmDeleteConsumption()}
                >
                  {editConsumptionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Smazat"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <CsvMaterialProposalDialog
            open={csvMaterialDialog != null}
            onOpenChange={(o) => {
              if (!o) setCsvMaterialDialog(null);
            }}
            source={csvMaterialDialog}
            inventoryItems={issueableInventoryFiltered}
            onIssued={() => void loadApi()}
          />

          <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Dokončit výrobu?</AlertDialogTitle>
                <AlertDialogDescription>
                  Zakázka se označí jako dokončená ve výrobě. Tuto akci obvykle provádí vedení po kontrole hotové
                  práce; stav lze později změnit jen úpravou zakázky ve správě.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={workflowSaving}>Zrušit</AlertDialogCancel>
                <AlertDialogAction onClick={() => void runWorkflow("complete")} disabled={workflowSaving}>
                  {workflowSaving ? "Ukládám…" : "Ano, dokončit"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function fileMetaLine(file: JobAttachmentFile): string {
  const parts: string[] = [];
  if (file.folderName) parts.push(`Složka: ${file.folderName}`);
  const when = formatConsumptionCreatedAt(file.createdAt);
  if (when) parts.push(when);
  if (file.uploadedByName) parts.push(`Nahrál: ${file.uploadedByName}`);
  else if (file.uploadedBy) parts.push(`Nahrál: ${file.uploadedBy}`);
  return parts.join(" · ");
}

function ProductionMediaGallery({
  jobId,
  files,
  loading,
  noVisibleFolders,
  isPrivilegedViewer,
  onOpenCsvMaterial,
  omitPdfSection,
}: {
  jobId: string;
  files: JobAttachmentFile[];
  loading: boolean;
  noVisibleFolders: boolean;
  isPrivilegedViewer: boolean;
  onOpenCsvMaterial: (src: CsvMaterialDialogSource) => void;
  /** PDF se zobrazuje velkým náhledem u výdeje materiálu — zde jen ostatní podklady. */
  omitPdfSection?: boolean;
}) {
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  const measurementFiles = useMemo(
    () => files.filter((f) => f.mediaSource === "measurement"),
    [files]
  );
  const filesWithoutMeasurement = useMemo(
    () => files.filter((f) => f.mediaSource !== "measurement"),
    [files]
  );

  const groups = useMemo(() => {
    const g: Record<AttachmentKind, JobAttachmentFile[]> = {
      drawing: [],
      pdf: [],
      photo: [],
      other: [],
      csv: [],
    };
    for (const f of filesWithoutMeasurement) {
      g[f.kind].push(f);
    }
    return g;
  }, [filesWithoutMeasurement]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4">
        <p className="text-sm font-medium text-slate-800">Zatím žádné podklady pro výrobu</p>
        <p className="text-xs text-slate-600">
          Nebyly nalezeny soubory ve viditelných složkách, ani fotky u zakázky ani fotodokumentace zaměření pro
          tuto zakázku.
        </p>
        {noVisibleFolders ? (
          <p className="text-xs text-slate-500">
            {isPrivilegedViewer
              ? "Jako vedení můžete u zakázky přidat složky (fotky / soubory), zapnout u nich „Výroba“ nebo viditelnost pro zaměstnance, a v sekci výrobního týmu vybrat složky pro výrobu."
              : "Požádejte administrátora, aby u příslušných složek zapnul viditelnost pro výrobu nebo pro zaměstnance, případně vás zařadil k zakázce ve výrobě."}
          </p>
        ) : null}
      </div>
    );
  }

  const Section = ({
    title,
    icon,
    items,
    empty,
    denseGrid,
  }: {
    title: string;
    icon: React.ReactNode;
    items: JobAttachmentFile[];
    empty: string;
    denseGrid?: boolean;
  }) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div
          className={
            denseGrid
              ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
          }
        >
          {items.map((im) => (
            <MediaTile
              key={`${im.folderId}-${im.id}`}
              jobId={jobId}
              file={im}
              onPhotoClick={setLightbox}
              onOpenCsvMaterial={onOpenCsvMaterial}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {noVisibleFolders && files.length > 0 ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
          K této zakázce nejsou vybrané žádné složky pro výrobu — zobrazují se ale fotky u zakázky, zaměření a
          případné soubory ze složek označených příznakem „Výroba“ / viditelností pro zaměstnance.
        </p>
      ) : null}
      <Dialog open={lightbox != null} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-[min(96vw,1100px)] border-slate-200 bg-white p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>{lightbox?.name || "Náhled"}</DialogTitle>
          </DialogHeader>
          {lightbox ? (
            <div className="relative max-h-[85vh] w-full bg-black/90">
              {/* eslint-disable-next-line @next/next/no-img-element -- lightbox origin URL z Storage */}
              <img
                src={lightbox.url}
                alt={lightbox.name}
                className="mx-auto max-h-[85vh] w-auto max-w-full object-contain"
              />
              <p className="absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-2 text-sm text-white truncate">
                {lightbox.name}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Section
        title="Fotodokumentace zaměření"
        icon={<ImageIcon className="h-5 w-5 text-emerald-600" />}
        items={measurementFiles}
        empty="Žádné fotky zaměření vázané na tuto zakázku."
        denseGrid
      />
      <Section
        title="Fotky a obrázky"
        icon={<ImageIcon className="h-5 w-5 text-sky-600" />}
        items={groups.photo}
        empty="Žádné další fotografie ani obrázky v podkladech."
        denseGrid
      />
      <Section
        title="CSV soubory"
        icon={<FileText className="h-5 w-5 text-emerald-600" />}
        items={groups.csv}
        empty="Žádné CSV — nahrajte soubor .csv do složky zakázky (Dokumenty / Soubory)."
      />
      {!omitPdfSection ? (
        <Section
          title="PDF dokumenty"
          icon={<FileText className="h-5 w-5 text-red-600" />}
          items={groups.pdf}
          empty="Žádná PDF."
        />
      ) : groups.pdf.length > 0 ? (
        <p className="text-xs text-slate-600 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
          PDF dokumenty ({groups.pdf.length}) jsou zobrazeny výše u výdeje materiálu — velký náhled a listování
          stránek.
        </p>
      ) : null}
      <Section
        title="Plánky / výkresy"
        icon={<Layers className="h-5 w-5 text-slate-600" />}
        items={groups.drawing}
        empty="Žádné plánky ani výkresy."
      />
      <Section
        title="Ostatní soubory"
        icon={<Factory className="h-5 w-5 text-slate-500" />}
        items={groups.other}
        empty="Žádné další soubory."
      />
    </div>
  );
}

function MediaTile({
  jobId,
  file,
  onPhotoClick,
  onOpenCsvMaterial,
}: {
  jobId: string;
  file: JobAttachmentFile;
  onPhotoClick: (p: { url: string; name: string }) => void;
  onOpenCsvMaterial: (src: CsvMaterialDialogSource) => void;
}) {
  const isImg = file.kind === "photo";
  const meta = fileMetaLine(file);

  if (isImg) {
    return (
      <button
        type="button"
        className="group flex flex-col overflow-hidden rounded-xl border-2 border-slate-200 bg-white text-left shadow-md transition hover:border-sky-400 hover:shadow-lg"
        onClick={() => onPhotoClick({ url: file.fileUrl, name: file.fileName })}
      >
        <div className="relative aspect-[4/3] min-h-[200px] w-full bg-slate-100">
          <Image
            src={file.fileUrl}
            alt={file.fileName}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 280px"
            unoptimized
          />
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
            <ZoomIn className="h-3 w-3" />
            Zvětšit
          </span>
        </div>
        <div className="space-y-1 p-3">
          <p className="line-clamp-2 text-sm font-medium text-slate-900" title={file.fileName}>
            {file.fileName}
          </p>
          <p className="line-clamp-2 text-[11px] text-slate-500">{meta}</p>
        </div>
      </button>
    );
  }

  if (file.kind === "pdf") {
    return (
      <div className="flex min-h-[260px] flex-col justify-between rounded-xl border-2 border-red-100 bg-gradient-to-br from-red-50/90 to-white p-5 shadow-md">
        <div>
          <FileText className="h-14 w-14 text-red-600" />
          <p className="mt-3 line-clamp-3 text-sm font-semibold text-slate-900" title={file.fileName}>
            {file.fileName}
          </p>
          <p className="mt-2 line-clamp-3 text-[11px] text-slate-600">{meta}</p>
        </div>
        <a
          href={file.fileUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-red-700 hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          Otevřít PDF
        </a>
      </div>
    );
  }

  if (file.kind === "csv") {
    const canCsv =
      file.mediaSource === "folder" && file.folderImageDocId && file.folderId && file.folderId !== "job-photos";
    return (
      <div className="flex min-h-[280px] flex-col justify-between gap-4 rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/90 to-white p-5 shadow-md">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            CSV
          </div>
          <p className="mt-3 line-clamp-3 text-sm font-semibold text-slate-900" title={file.fileName}>
            {file.fileName}
          </p>
          <p className="mt-2 line-clamp-3 text-[11px] text-slate-600">{meta}</p>
        </div>
        <div className="flex flex-col gap-2">
          <a
            href={file.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
          >
            <ExternalLink className="h-4 w-4" />
            Stáhnout / otevřít CSV
          </a>
          <Button
            type="button"
            className="w-full bg-emerald-700 text-white hover:bg-emerald-800 min-h-[44px]"
            disabled={!canCsv}
            onClick={() => {
              if (!canCsv || !file.folderImageDocId) return;
              onOpenCsvMaterial({
                jobId,
                folderId: file.folderId,
                jobFolderImageId: file.folderImageDocId,
                fileUrl: file.fileUrl,
                fileName: file.fileName,
              });
            }}
          >
            Otevřít CSV / Generovat materiál
          </Button>
          {!canCsv ? (
            <p className="text-[11px] text-amber-800">
              Návrh z CSV je k dispozici jen pro soubory ve složce zakázky (ne z legacy fotek).
            </p>
          ) : (
            <p className="text-[11px] text-slate-600">
              Materiál se odečte až po potvrzení v dialogu — nejdřív vznikne návrh.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <a
      href={file.fileUrl}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-[200px] flex-col justify-between rounded-xl border-2 border-slate-200 bg-white p-5 shadow-md transition hover:border-primary/40"
    >
      <div>
        <Package className="h-10 w-10 text-slate-400" />
        <p className="mt-2 line-clamp-3 text-sm font-medium text-slate-900">{file.fileName}</p>
        <p className="mt-2 line-clamp-3 text-[11px] text-slate-500">{meta}</p>
      </div>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
        <ExternalLink className="h-3.5 w-3.5" />
        Otevřít
      </span>
    </a>
  );
}
