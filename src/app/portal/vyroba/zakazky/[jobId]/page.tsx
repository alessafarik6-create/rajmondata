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
  Play,
  ZoomIn,
  CheckCircle2,
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
  isJobImageVisibleInProductionView,
  resolveJobFolderImageDownloadUrl,
  type ProductionFolderRow,
} from "@/lib/job-production-media";
import {
  isMeasurementPhotoUnassignedForJob,
  isMeasurementPhotoVisibleInProduction,
} from "@/lib/measurement-photos";

const CARD = "border-slate-200 bg-white text-slate-900";

/** Legacy jobs/.../photos — bez nadřazené složky; po job-level legacyPhotosEmployeeVisible řídí viditelnost souboru. */
const LEGACY_JOB_PHOTOS_FOLDER_STUB: ProductionFolderRow = {
  id: "job-photos",
  employeeVisible: true,
  name: "Fotodokumentace u zakázky",
};

type AttachmentKind = "drawing" | "pdf" | "photo" | "other";

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
};

function attachmentKindFromName(name: string): AttachmentKind {
  const n = String(name || "").toLowerCase();
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
  inputUnit,
  availableInStockUnit,
}: {
  item: InventoryItemRow;
  issueQtyStr: string;
  inputUnit: "mm" | "cm" | "m" | null;
  availableInStockUnit: number;
}) {
  const u = String(item.unit || "").trim() || "—";
  const q = Number(String(issueQtyStr).replace(",", "."));
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
  const conv = quantityInStockUnits(item, q, inputUnit);
  const rem =
    conv != null && Number.isFinite(conv) ? Math.max(0, availableInStockUnit - conv) : null;
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50/70 p-3 text-xs text-slate-800 space-y-1.5">
      <p className="font-semibold text-blue-950">Metráž — řez</p>
      <p>
        Zásoba před výdejem: <strong>{availableInStockUnit}</strong> {u}
      </p>
      <p>
        Odebírá se na zakázku:{" "}
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

  const [jobView, setJobView] = useState<SafeJobView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibleFolderPick, setVisibleFolderPick] = useState<Set<string>>(new Set());
  const [consumptions, setConsumptions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [issueItemId, setIssueItemId] = useState<string>("");
  const [issueQty, setIssueQty] = useState<string>("");
  const [issueNote, setIssueNote] = useState<string>("");
  const [issueBatch, setIssueBatch] = useState<string>("");
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueInputLengthUnit, setIssueInputLengthUnit] = useState<"mm" | "cm" | "m">("mm");
  const [attachmentFiles, setAttachmentFiles] = useState<JobAttachmentFile[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [startSaving, setStartSaving] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

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

  useEffect(() => {
    if (!issueItemId) return;
    if (!issueableInventory.some((i) => i.id === issueItemId)) {
      setIssueItemId("");
    }
  }, [issueableInventory, issueItemId]);

  const selectedItem = useMemo(
    () =>
      issueableInventory.find((i) => i.id === issueItemId) ??
      inventoryItems.find((i) => i.id === issueItemId) ??
      null,
    [issueableInventory, inventoryItems, issueItemId]
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
            const url = resolveJobFolderImageDownloadUrl(row);
            const name = String(row.fileName || row.name || "soubor");
            if (!url) return;
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
              kind: attachmentKindFromName(name),
              createdAt: row.createdAt,
              uploadedBy: rowCreatedBy,
              uploadedByName: rowCreatedByName,
              mediaSource: "folder",
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
          const byKind = { photo: 0, pdf: 0, drawing: 0, other: 0 };
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

  const availableQty = useMemo(() => {
    if (!selectedItem) return 0;
    const mode = String(selectedItem.stockTrackingMode || "pieces");
    if (mode === "length") {
      const cur = selectedItem.currentLength;
      if (cur != null && Number.isFinite(Number(cur))) return Number(cur);
    }
    return Number(selectedItem.quantity ?? 0);
  }, [selectedItem]);

  const lengthUnitEditable = useMemo(() => {
    if (!selectedItem || String(selectedItem.stockTrackingMode) !== "length") return false;
    const stockU = String(selectedItem.lengthStockUnit || selectedItem.unit || "mm")
      .trim()
      .toLowerCase();
    return stockU === "mm" || stockU === "cm" || stockU === "m";
  }, [selectedItem]);

  const remainderPreview = useMemo(() => {
    const q = Number(String(issueQty).replace(",", "."));
    if (!selectedItem || !Number.isFinite(q) || q <= 0) return null;
    const inputUnit = lengthUnitEditable ? issueInputLengthUnit : null;
    const conv = quantityInStockUnits(selectedItem, q, inputUnit);
    if (conv == null || !Number.isFinite(conv)) return null;
    return Math.max(0, availableQty - conv);
  }, [selectedItem, issueQty, availableQty, issueInputLengthUnit, lengthUnitEditable]);

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
    if (conv > availableQty + 1e-9) {
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
          note: issueNote.trim() || null,
          batchNumber: issueBatch.trim() || null,
          inputLengthUnit: inputUnitForApi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Výdej se nezdařil.");
      }
      toast({ title: "Materiál vydán", description: "Zápis byl uložen na zakázku a do skladu." });
      setIssueQty("");
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
    <div className="mx-auto w-full max-w-6xl space-y-6">
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

          <Card className={CARD}>
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-base text-slate-900 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Výdej ve výrobě
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-10 pt-6 text-sm sm:px-6">
              <div className="mb-8 max-w-3xl space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Materiál přiřazený k výrobě
                </p>
                <p className="text-sm leading-relaxed text-slate-700">
                  Materiál nemusí být předem přiřazen — při každém výdeji ze skladu se automaticky zapíše spotřeba
                  na tuto zakázku. Volitelné rezervace řeší administrace skladu.
                </p>
              </div>

              <div className="space-y-10 rounded-xl border border-slate-200 bg-slate-50/80 p-5 shadow-sm sm:p-8 sm:pb-10">
                {/* — Výběr materiálu — */}
                <section aria-labelledby="issue-form-material" className="space-y-8 pb-4">
                  <h3
                    id="issue-form-material"
                    className="border-b border-slate-200 pb-3 text-base font-semibold text-slate-900"
                  >
                    Výběr materiálu
                  </h3>

                  <div className="space-y-3">
                    <Label htmlFor="issue-item-select" className="text-sm font-semibold text-slate-800">
                      Skladová položka
                    </Label>
                    <Select value={issueItemId || undefined} onValueChange={setIssueItemId}>
                      <SelectTrigger
                        id="issue-item-select"
                        className="min-h-[4.5rem] border-slate-300 bg-white py-3 pl-4 pr-3 text-base shadow-sm h-auto !items-start"
                        aria-label={
                          selectedItem
                            ? `Vybraná položka: ${selectedItem.name}, dostupné ${availableQty} ${selectedItem.unit || "ks"}`
                            : "Vyberte skladovou položku nebo zbytek"
                        }
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-4 py-0.5 text-left">
                          {selectedItem ? (
                            <>
                              <div className="shrink-0 self-start">
                                <InventoryItemThumbnail item={selectedItem} size={52} />
                              </div>
                              <div className="min-w-0 flex-1 overflow-hidden pr-1">
                                <p className="line-clamp-2 text-left text-sm font-semibold leading-snug text-slate-900 sm:text-base">
                                  {selectedItem.name}
                                  {selectedItem.isRemainder ? (
                                    <span className="font-medium text-slate-600"> · zbytek</span>
                                  ) : null}
                                </p>
                                <p className="mt-2 block text-left text-xs leading-relaxed text-slate-500 sm:text-sm">
                                  {selectedItem.sku ? (
                                    <span className="block truncate">SKU {selectedItem.sku}</span>
                                  ) : null}
                                  <span className="mt-0.5 block text-slate-600">
                                    Dostupné: <strong className="text-slate-800">{availableQty}</strong>{" "}
                                    {selectedItem.unit || "ks"}
                                    <span className="text-slate-400"> · </span>
                                    {stockModeShortLabel(selectedItem.stockTrackingMode)}
                                  </span>
                                </p>
                              </div>
                            </>
                          ) : (
                            <span className="py-2 text-base text-slate-500">Vyberte materiál nebo zbytek</span>
                          )}
                        </div>
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 max-h-[min(26rem,72vh)] min-w-[min(calc(100vw-1.5rem),28rem)] w-[var(--radix-select-trigger-width)] max-w-[min(calc(100vw-1.5rem),28rem)] sm:w-auto sm:min-w-[var(--radix-select-trigger-width)]">
                        {issueableInventory.length === 0 ? (
                          <div className="px-3 py-4 text-sm text-slate-500">
                            Žádná dostupná položka se zásobou.
                          </div>
                        ) : (
                          issueableInventory.map((i) => {
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
                                    <InventoryItemThumbnail item={i} size={52} />
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

                  {issueableInventory.length > 0 ? (
                    <div className="space-y-5">
                      <Label className="text-sm font-semibold text-slate-800">
                        Rychlý výběr — klikněte na skladovou položku
                      </Label>
                      <div className="grid max-h-[min(30rem,65vh)] auto-rows-min grid-cols-1 gap-5 overflow-x-hidden overflow-y-auto px-0.5 pb-2 sm:grid-cols-2 sm:gap-6">
                        {issueableInventory.slice(0, 48).map((i) => {
                          const q = availableStockQtyForIssueForm(i);
                          const active = issueItemId === i.id;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => setIssueItemId(i.id)}
                              className={cn(
                                "flex w-full min-w-0 min-h-[7.75rem] shrink-0 items-start gap-4 overflow-hidden rounded-xl border-2 px-4 py-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:min-h-[8.25rem] sm:px-5 sm:py-5",
                                active
                                  ? "border-emerald-600 bg-emerald-600 text-white ring-1 ring-emerald-700/30"
                                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/90 active:bg-slate-100"
                              )}
                            >
                              <div className="shrink-0 self-start">
                                <InventoryItemThumbnail
                                  item={i}
                                  size={52}
                                  className={cn(active && "border-white/40 ring-1 ring-white/20")}
                                />
                              </div>
                              <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch justify-start gap-0 overflow-hidden text-left">
                                <p
                                  className={cn(
                                    "line-clamp-2 min-h-[2.5rem] text-base font-semibold leading-snug tracking-tight sm:min-h-[2.75rem]",
                                    active ? "text-white" : "text-slate-900"
                                  )}
                                >
                                  {i.name}
                                  {i.isRemainder ? (
                                    <span
                                      className={cn(
                                        "font-medium",
                                        active ? "text-emerald-100" : "text-slate-600"
                                      )}
                                    >
                                      {" "}
                                      · zbytek
                                    </span>
                                  ) : null}
                                </p>
                                <div
                                  className={cn(
                                    "mt-auto space-y-1 border-t pt-2 text-xs leading-relaxed sm:text-sm",
                                    active ? "border-white/25 text-emerald-50" : "border-slate-100 text-slate-500"
                                  )}
                                >
                                  {i.sku ? (
                                    <p className={cn("truncate", active ? "text-emerald-100/95" : "")}>
                                      SKU {i.sku}
                                    </p>
                                  ) : null}
                                  <p className={active ? "text-emerald-50" : "text-slate-600"}>
                                    <span className={active ? "text-emerald-100" : "text-slate-500"}>
                                      Zásoba:{" "}
                                    </span>
                                    <strong className={active ? "text-white" : "text-slate-800"}>{q}</strong>{" "}
                                    {i.unit || "ks"}
                                    <span className={active ? "text-emerald-200/90" : "text-slate-400"}>
                                      {" "}
                                      · {stockModeShortLabel(i.stockTrackingMode)}
                                    </span>
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {selectedItem ? (
                    <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 p-4 sm:p-5">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/90">
                        Dostupné množství
                      </p>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <InventoryItemThumbnail item={selectedItem} size={56} className="shrink-0" />
                        <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed text-slate-800">
                          <p>
                            Na skladě je k dispozici:{" "}
                            <strong className="text-base text-slate-900">
                              {availableQty} {selectedItem.unit || "ks"}
                            </strong>
                          </p>
                          {String(selectedItem.stockTrackingMode || "") === "length" ? (
                            <p className="text-sm text-slate-700">
                              U metráže lze odebrat jen část — zbytek vznikne jako nová skladová řádka.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                {/* — Množství a řez — */}
                <section
                  aria-labelledby="issue-form-qty"
                  className="space-y-8 border-t-2 border-slate-200/90 pt-12 sm:pt-14"
                >
                  <h3
                    id="issue-form-qty"
                    className="border-b border-slate-200 pb-3 text-base font-semibold text-slate-900"
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
                    className={`grid grid-cols-1 gap-8 lg:gap-10 ${
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
                          inputUnit={lengthUnitEditable ? issueInputLengthUnit : null}
                          availableInStockUnit={availableQty}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </section>

                {/* — Poznámka a potvrzení — */}
                <section aria-labelledby="issue-form-note" className="space-y-6 border-t border-slate-200 pt-10">
                  <h3
                    id="issue-form-note"
                    className="border-b border-slate-200 pb-3 text-base font-semibold text-slate-900"
                  >
                    Poznámka a potvrzení
                  </h3>

                  <div className="max-w-4xl space-y-8">
                    <div className="max-w-md space-y-3">
                      <Label htmlFor="issue-batch" className="text-sm font-semibold text-slate-800">
                        Šarže <span className="font-normal text-slate-500">(volitelné)</span>
                      </Label>
                      <Input
                        id="issue-batch"
                        className="min-h-12 border-slate-300 bg-white px-4 py-3 text-base shadow-sm"
                        value={issueBatch}
                        onChange={(e) => setIssueBatch(e.target.value)}
                        placeholder="Číslo šarže"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label htmlFor="issue-note" className="text-sm font-semibold text-slate-800">
                        Poznámka k výdeji <span className="font-normal text-slate-500">(volitelné)</span>
                      </Label>
                      <Textarea
                        id="issue-note"
                        className="min-h-[120px] resize-y border-slate-300 bg-white px-4 py-3 text-base leading-relaxed shadow-sm"
                        value={issueNote}
                        onChange={(e) => setIssueNote(e.target.value)}
                        placeholder="Doplňující informace k výdeji…"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-200/80 pt-8">
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
                        "Odebrat ze skladu a zapsat na zakázku"
                      )}
                    </Button>
                  </div>
                </section>
              </div>
            </CardContent>
          </Card>

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
                Zbytky po částečném výdeji délkového materiálu jsou nové skladové řádky; znovu je vyberete ve
                výběru materiálu výše.
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
                files={attachmentFiles}
                loading={attachmentsLoading}
                noVisibleFolders={visibleFolders.length === 0}
                isPrivilegedViewer={isPrivilegedViewer}
              />
            </CardContent>
          </Card>

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
  files,
  loading,
  noVisibleFolders,
  isPrivilegedViewer,
}: {
  files: JobAttachmentFile[];
  loading: boolean;
  noVisibleFolders: boolean;
  isPrivilegedViewer: boolean;
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
            <MediaTile key={`${im.folderId}-${im.id}`} file={im} onPhotoClick={setLightbox} />
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
        title="PDF dokumenty"
        icon={<FileText className="h-5 w-5 text-red-600" />}
        items={groups.pdf}
        empty="Žádná PDF."
      />
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
  file,
  onPhotoClick,
}: {
  file: JobAttachmentFile;
  onPhotoClick: (p: { url: string; name: string }) => void;
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
