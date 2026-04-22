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
  ExternalLink,
  Factory,
  FileText,
  ImageIcon,
  Layers,
  Loader2,
  Package,
  Play,
  ZoomIn,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { canAccessCompanyModule } from "@/lib/platform-access";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { userCanAccessProductionPortal } from "@/lib/warehouse-production-access";
import { isCompanyPrivileged, normalizeCompanyRole } from "@/lib/company-privilege";
import type { InventoryItemRow } from "@/lib/inventory-types";
import Image from "next/image";
import {
  lengthToMillimeters,
  millimetersToUnit,
} from "@/lib/job-production-settings";
import {
  canStartProductionWorkflow,
  parseProductionWorkflowStatus,
} from "@/lib/production-job-workflow";

const CARD = "border-slate-200 bg-white text-slate-900";

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
};

function attachmentKindFromName(name: string): AttachmentKind {
  const n = String(name || "").toLowerCase();
  if (/\.(pdf)(\?|$)/i.test(n)) return "pdf";
  if (/\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(n)) return "photo";
  if (/\.(dwg|dxf|step|stp|stl|iges|igs|plt)(\?|$)/i.test(n)) return "drawing";
  return "other";
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
   * Modul výroba + buď klasický přístup (příznak zaměstnance / vedení),
   * nebo jakýkoli přihlášený účet s rolí employee — konkrétní zakázku stejně povolí API (přiřazení týmu).
   */
  const accessOk =
    company &&
    canAccessCompanyModule(company, "vyroba", platformCatalog) &&
    (userCanAccessProductionPortal({
      role,
      globalRoles: profile?.globalRoles,
      employeeRow: employeeRow as { canAccessProduction?: boolean } | null,
    }) ||
      normalizeCompanyRole(role) === "employee");

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
        ? query(collection(firestore, "companies", companyId, "inventoryItems"), limit(500))
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

  const loadApi = useCallback(async () => {
    if (!user || !jobId) return;
    setLoading(true);
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
        throw new Error(typeof vJson.error === "string" ? vJson.error : "Zakázku nelze zobrazit.");
      }
      if (!cRes.ok) {
        throw new Error(typeof cJson.error === "string" ? cJson.error : "Historii nelze načíst.");
      }
      setJobView((vJson.job as SafeJobView) || null);
      const folderIdsRaw = (vJson.settings as { productionVisibleFolderIds?: unknown } | null | undefined)
        ?.productionVisibleFolderIds;
      const folderIds = Array.isArray(folderIdsRaw)
        ? folderIdsRaw.map((x) => String(x)).filter(Boolean)
        : [];
      setVisibleFolderPick(new Set(folderIds));
      setConsumptions(Array.isArray(cJson.consumptions) ? cJson.consumptions : []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
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
   * Firestore pravidla by ideálně vracela jen složky, které smí výrobní tým vidět.
   * Pro jistotu ale filtrujeme i na klientu podle `productionVisibleFolderIds` / `productionTeamVisible`.
   */
  const visibleFolders = useMemo(() => {
    const list = Array.isArray(foldersRaw) ? foldersRaw : [];
    return list
      .filter(
        (f): f is { id: string; name?: string; type?: string; productionTeamVisible?: boolean } =>
          !!f && typeof (f as { id?: string }).id === "string"
      )
      .filter((f) => f.type !== "documents")
      .filter((f) => {
        if (visibleFolderPick.size > 0) return visibleFolderPick.has(f.id);
        if (f.productionTeamVisible === true) return true;
        if (isPrivilegedViewer) return true;
        return false;
      })
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "cs"));
  }, [foldersRaw, visibleFolderPick, isPrivilegedViewer]);

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
    if (visibleFolders.length === 0) {
      setAttachmentFiles([]);
      setAttachmentsLoading(false);
      return;
    }
    let cancelled = false;
    setAttachmentsLoading(true);
    (async () => {
      const all: JobAttachmentFile[] = [];
      try {
        for (const f of visibleFolders) {
          const q = query(
            collection(
              firestore,
              "companies",
              companyId,
              "jobs",
              String(jobId),
              "folders",
              f.id,
              "images"
            ),
            orderBy("createdAt", "desc"),
            limit(40)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const row = d.data() as Record<string, unknown>;
            const url = String(row.fileUrl || "");
            const name = String(row.fileName || "soubor");
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
              id: d.id,
              folderId: f.id,
              folderName: f.name || f.id,
              fileUrl: url,
              fileName: name,
              kind: attachmentKindFromName(name),
              createdAt: row.createdAt,
              uploadedBy: rowCreatedBy,
              uploadedByName: rowCreatedByName,
            });
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
  }, [firestore, companyId, jobId, accessOk, visibleFolderIdsKey]);

  const workflowStatus = useMemo(
    () => parseProductionWorkflowStatus(jobView as Record<string, unknown> | null),
    [jobView]
  );
  const canShowStartButton = jobView != null && canStartProductionWorkflow(workflowStatus);

  const consumptionSummary = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; qty: number }>();
    consumptions.forEach((c, idx) => {
      const key =
        (typeof c.inventoryItemId === "string" && c.inventoryItemId.trim()) ||
        `name:${String(c.itemName || "")}:${idx}`;
      const name = String(c.itemName || "");
      const unit = String(c.unit || "");
      const qty = Number(c.quantity ?? 0);
      const prev = m.get(key);
      if (prev) prev.qty += qty;
      else m.set(key, { name, unit, qty });
    });
    return Array.from(m.values());
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
        description: "Stav zakázky byl nastaven na Zahájeno a zapsal se čas zahájení.",
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
          <CardContent className="py-10 text-center">Zakázka není k dispozici.</CardContent>
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
                    Zakázka přejde do stavu <strong>Zahájeno</strong>, uloží se datum a čas, kdo výrobu spustil,
                    a zakázka se objeví mezi aktivní výrobou v přehledech.
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
                Vzít materiál ze skladu
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Materiál přiřazený k výrobě</p>
                <p className="text-slate-700">
                  Materiál nemusí být předem přiřazen — při každém výdeji ze skladu se automaticky zapíše spotřeba
                  na tuto zakázku. Volitelné rezervace řeší administrace skladu.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 sm:p-5 space-y-3 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">Formulář výdeje</p>
                <div className="space-y-2">
                  <Label>Skladová položka</Label>
                  <Select value={issueItemId || undefined} onValueChange={setIssueItemId}>
                    <SelectTrigger className="bg-white border-slate-200">
                      <SelectValue placeholder="Vyberte materiál nebo zbytek" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 max-h-60">
                      {issueableInventory.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-slate-500">Žádná dostupná položka se zásobou.</div>
                      ) : (
                        issueableInventory.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                            {i.isRemainder ? " (zbytek)" : ""} — {i.unit || "ks"}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {issueableInventory.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-600">Rychlý výběr — klikněte na skladovou položku</Label>
                    <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto p-0.5">
                      {issueableInventory.slice(0, 48).map((i) => (
                        <Button
                          key={i.id}
                          type="button"
                          variant={issueItemId === i.id ? "default" : "outline"}
                          size="sm"
                          className="text-xs h-auto py-1.5 px-2 whitespace-normal text-left max-w-[240px] justify-start"
                          onClick={() => setIssueItemId(i.id)}
                        >
                          <span className="line-clamp-2 text-left">
                            {i.name}
                            {i.isRemainder ? " · zbytek" : ""}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedItem ? (
                  <p className="text-xs text-slate-600">
                    Dostupné:{" "}
                    <strong>
                      {availableQty} {selectedItem.unit || "ks"}
                    </strong>
                    {String(selectedItem.stockTrackingMode || "") === "length"
                      ? " — u délek lze odebrat část; zbytek vznikne jako nová skladová řádka."
                      : null}
                  </p>
                ) : null}
                {selectedItem && String(selectedItem.stockTrackingMode) === "length" && lengthUnitEditable ? (
                  <div className="space-y-2">
                    <Label>Jednotka zadání délky</Label>
                    <Select
                      value={issueInputLengthUnit}
                      onValueChange={(v) => setIssueInputLengthUnit(v as "mm" | "cm" | "m")}
                    >
                      <SelectTrigger className="bg-white border-slate-200 max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="mm">mm</SelectItem>
                        <SelectItem value="cm">cm</SelectItem>
                        <SelectItem value="m">m</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {selectedItem &&
                String(selectedItem.stockTrackingMode) === "length" &&
                !lengthUnitEditable ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                    Skladová jednotka není mm/cm/m — zadejte délku přímo ve stejné jednotce, v jaké je položka
                    vedena na skladě.
                  </p>
                ) : null}
                <div className="space-y-2">
                  <Label>Odebrané množství</Label>
                  <Input
                    className="bg-white border-slate-200 max-w-md"
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
                  {remainderPreview != null && selectedItem ? (
                    <p className="text-xs text-slate-600">
                      Po výdeji zbude na skladě (stejná jednotka jako zásoba):{" "}
                      <strong>{remainderPreview.toFixed(4).replace(/\.?0+$/, "")}</strong>{" "}
                      {selectedItem.unit || ""}
                    </p>
                  ) : null}
                  {selectedItem && String(selectedItem.stockTrackingMode) === "length" ? (
                    <LengthCutSummary
                      item={selectedItem}
                      issueQtyStr={issueQty}
                      inputUnit={lengthUnitEditable ? issueInputLengthUnit : null}
                      availableInStockUnit={availableQty}
                    />
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Šarže / poznámka (volitelné)</Label>
                  <Input
                    className="bg-white border-slate-200"
                    value={issueBatch}
                    onChange={(e) => setIssueBatch(e.target.value)}
                    placeholder="Šarže"
                  />
                  <Textarea
                    className="bg-white border-slate-200 min-h-[64px]"
                    value={issueNote}
                    onChange={(e) => setIssueNote(e.target.value)}
                    placeholder="Poznámka k výdeji"
                  />
                </div>
                <Button type="button" disabled={issueSaving || !selectedItem} onClick={() => void submitIssue()}>
                  {issueSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potvrdit výdej na zakázku"}
                </Button>
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
                  <ul className="space-y-1 text-sm">
                    {consumptionSummary.map((row) => (
                      <li key={`${row.name}-${row.unit}`} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                        <span>{row.name}</span>
                        <span className="shrink-0">
                          {row.qty} {row.unit}
                        </span>
                      </li>
                    ))}
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
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">{String(c.itemName ?? "")}</span>
                            <span>
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
                            <td className="p-2 font-medium">{row.name}</td>
                            <td className="p-2 text-xs text-slate-700 break-all">{parentLabel}</td>
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
              {visibleFolders.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {isPrivilegedViewer
                    ? "U této zakázky zatím nejsou žádné složky s podklady (kromě typu „dokumenty“). Nahrajte plánky nebo fotky do složky zakázky."
                    : "Žádné složky označené pro výrobní tým. Administrátor může u složky zapnout „viditelné pro výrobu“ nebo vybrat složky v nastavení zakázky."}
                </p>
              ) : (
                <ProductionMediaGallery files={attachmentFiles} loading={attachmentsLoading} />
              )}
            </CardContent>
          </Card>
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
}: {
  files: JobAttachmentFile[];
  loading: boolean;
}) {
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const groups = useMemo(() => {
    const g: Record<AttachmentKind, JobAttachmentFile[]> = {
      drawing: [],
      pdf: [],
      photo: [],
      other: [],
    };
    for (const f of files) {
      g[f.kind].push(f);
    }
    return g;
  }, [files]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 sm:p-5 space-y-4">
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
              ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
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
        title="Fotky a obrázky"
        icon={<ImageIcon className="h-5 w-5 text-sky-600" />}
        items={groups.photo}
        empty="Žádné fotografie v označených složkách."
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
        className="group flex flex-col overflow-hidden rounded-xl border-2 border-slate-200 bg-white text-left shadow-sm transition hover:border-sky-400 hover:shadow-md"
        onClick={() => onPhotoClick({ url: file.fileUrl, name: file.fileName })}
      >
        <div className="relative aspect-[4/3] w-full bg-slate-100">
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
      <div className="flex min-h-[200px] flex-col justify-between rounded-xl border-2 border-red-100 bg-gradient-to-br from-red-50/90 to-white p-4 shadow-sm">
        <div>
          <FileText className="h-12 w-12 text-red-600" />
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
      className="flex min-h-[160px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-primary/40"
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
