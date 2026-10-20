"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { Loader2, ArrowLeft, Save, FileDown, CheckCircle2 } from "lucide-react";
import { useUser, useFirebase, useCompany } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
import { InventoryItemThumbnail } from "@/components/warehouse/inventory-item-thumbnail";
import { WarehouseInventoryProfileFields } from "@/components/warehouse/warehouse-inventory-profile-fields";
import { computeLineDiff, diffStatusClass, recomputeInventoryStats } from "@/lib/warehouse-inventory-diff";
import {
  WAREHOUSE_INVENTORY_STATUS_LABELS,
  type WarehouseInventoryDoc,
  type WarehouseInventoryLine,
  type WarehouseInventoryStatus,
} from "@/lib/warehouse-inventory-types";
import { downloadWarehouseInventoryPdf } from "@/lib/warehouse-inventory-client";
const CARD = "border-slate-200 bg-white text-slate-900";

function syncLineProfile(line: WarehouseInventoryLine): WarehouseInventoryLine {
  if (!line.countedProfile) return line;
  const full = Math.max(0, Math.floor(Number(line.countedProfile.fullBarCount) || 0));
  const barLen = Number(line.countedProfile.barLengthMm);
  const partials = (line.countedProfile.partialLengthsMm ?? [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0);
  const totalMm =
    (Number.isFinite(barLen) && barLen > 0 ? full * barLen : 0) +
    partials.reduce((a, b) => a + b, 0);
  if (String(line.unit).trim().toLowerCase() === "mm" && (full > 0 || partials.length > 0)) {
    return { ...line, countedQuantity: totalMm };
  }
  return line;
}

export default function SkladInventuraDetailPage() {
  const params = useParams();
  const inventoryId = String(params.inventoryId ?? "");
  const { user } = useUser();
  const { firestore, areServicesAvailable } = useFirebase();
  const { companyId } = useCompany();
  const { toast } = useToast();

  const [inv, setInv] = useState<WarehouseInventoryDoc | null>(null);
  const [lines, setLines] = useState<WarehouseInventoryLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [applyMovements, setApplyMovements] = useState(true);
  const closeInFlight = useRef(false);

  useEffect(() => {
    if (!areServicesAvailable || !firestore || !companyId || !inventoryId) return;
    const ref = doc(firestore, "companies", companyId, "warehouseInventories", inventoryId);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setInv(null);
        setLines([]);
        setLoading(false);
        return;
      }
      const data = snap.data() as WarehouseInventoryDoc;
      setInv({ ...data, id: snap.id });
      setLines(Array.isArray(data.lines) ? [...data.lines] : []);
      setLoading(false);
    });
    return () => unsub();
  }, [areServicesAvailable, firestore, companyId, inventoryId]);

  const stats = useMemo(() => recomputeInventoryStats(lines), [lines]);

  const filteredLines = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        String(l.sku ?? "").toLowerCase().includes(q)
    );
  }, [lines, filter]);

  const readOnly = inv?.status === "closed";

  const saveDraft = useCallback(async () => {
    if (!user || !firestore || !companyId || !inv || readOnly) return;
    setSaving(true);
    try {
      const nextStats = recomputeInventoryStats(lines);
      await updateDoc(doc(firestore, "companies", companyId, "warehouseInventories", inventoryId), {
        lines,
        stats: nextStats,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Uloženo", description: "Rozpracovaná inventura byla uložena." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setSaving(false);
    }
  }, [user, firestore, companyId, inv, readOnly, lines, inventoryId, toast]);

  async function setStatus(next: WarehouseInventoryStatus) {
    if (!user || !firestore || !companyId || !inv || readOnly) return;
    const history = Array.isArray(inv.statusHistory) ? [...inv.statusHistory] : [];
    history.push({
      at: new Date().toISOString(),
      by: user.uid,
      from: inv.status,
      to: next,
      note: null,
    });
    await updateDoc(doc(firestore, "companies", companyId, "warehouseInventories", inventoryId), {
      status: next,
      statusHistory: history,
      updatedAt: serverTimestamp(),
    });
    toast({ title: "Stav aktualizován", description: WAREHOUSE_INVENTORY_STATUS_LABELS[next] });
  }

  async function exportPdf() {
    if (!user) return;
    const token = await user.getIdToken();
    const res = await downloadWarehouseInventoryPdf({
      token,
      kind: "inventory_report",
      itemIds: [],
      inventoryId,
    });
    if (!res.ok) {
      toast({ variant: "destructive", title: "PDF", description: res.error });
    }
  }

  async function confirmClose() {
    if (!user || closeInFlight.current) return;
    closeInFlight.current = true;
    try {
      await saveDraft();
      const token = await user.getIdToken();
      const idempotencyKey = `close-${inventoryId}-${Date.now()}`;
      const res = await fetch("/api/company/warehouse/inventory/close", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inventoryId,
          applyMovements,
          confirm: applyMovements,
          idempotencyKey,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        warnings?: string[];
        movementsCreated?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Uzavření selhalo");
      toast({
        title: "Inventura uzavřena",
        description: applyMovements
          ? `Vytvořeno pohybů: ${data.movementsCreated ?? 0}`
          : "Bez skladových pohybů",
      });
      if (data.warnings?.length) {
        console.warn("[inventura]", data.warnings);
      }
      setCloseOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uzavření",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      closeInFlight.current = false;
    }
  }

  function updateLine(index: number, patch: Partial<WarehouseInventoryLine>) {
    setLines((prev) => {
      const next = [...prev];
      let line = { ...next[index], ...patch };
      if (line.countedProfile) line = syncLineProfile(line);
      next[index] = line;
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="p-6 text-center text-slate-600">
        Inventura nenalezena.{" "}
        <Link href="/portal/sklad/inventury" className="text-orange-600 underline">
          Zpět
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-1 pb-16 sm:px-0">
      <Button variant="link" className="px-0 h-auto text-slate-600" asChild>
        <Link href="/portal/sklad/inventury">
          <ArrowLeft className="h-4 w-4 mr-1" /> Inventury
        </Link>
      </Button>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{inv.inventoryNumber}</h1>
          <p className="text-sm text-slate-600">
            {inv.warehouseName} · {WAREHOUSE_INVENTORY_STATUS_LABELS[inv.status]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly ? (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void saveDraft()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Uložit
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void exportPdf()}>
            <FileDown className="h-4 w-4 mr-1" /> PDF
          </Button>
          {!readOnly && inv.status === "draft" ? (
            <Button type="button" variant="outline" onClick={() => void setStatus("ready_for_review")}>
              Připravit ke kontrole
            </Button>
          ) : null}
          {!readOnly && inv.status === "ready_for_review" ? (
            <Button
              type="button"
              className="bg-orange-500 hover:bg-orange-600 text-black"
              onClick={() => void setStatus("approved")}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Schválit
            </Button>
          ) : null}
          {!readOnly && (inv.status === "approved" || inv.status === "ready_for_review") ? (
            <Button type="button" className="bg-orange-500 hover:bg-orange-600 text-black" onClick={() => setCloseOpen(true)}>
              Uzavřít inventuru
            </Button>
          ) : null}
        </div>
      </div>

      <Card className={CARD}>
        <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-slate-500 text-xs">Položek</p>
            <p className="font-semibold">{stats.linesTotal}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Spočítáno</p>
            <p className="font-semibold">{stats.counted}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Manka / přebytky</p>
            <p className="font-semibold text-red-700">{stats.shortages}</p>
            <p className="font-semibold text-orange-700">{stats.surpluses}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Hodnota rozdílů</p>
            <p className="font-semibold">{stats.diffValueCzk.toLocaleString("cs-CZ")} Kč</p>
          </div>
        </CardContent>
      </Card>

      <Input
        placeholder="Hledat v inventuře…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="bg-white max-w-md"
      />

      <div className="space-y-3">
        {filteredLines.map((line) => {
          const globalIndex = lines.findIndex((l) => l.itemId === line.itemId);
          const { diff, status } = computeLineDiff(line.systemQuantity, line.countedQuantity);
          const isProfile =
            line.countedProfile != null ||
            (line.stockTrackingMode === "length" && String(line.unit).toLowerCase() === "mm");
          return (
            <Card key={line.itemId} className={CARD}>
              <CardHeader className="pb-2 flex flex-row gap-3 items-start">
                <InventoryItemThumbnail
                  item={{ name: line.name, imageUrl: line.imageUrl }}
                  size={56}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">{line.name}</CardTitle>
                  <p className="text-xs text-slate-500">
                    SKU: {line.sku ?? "—"} · MJ: {line.unit}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">Systém: {line.systemDisplay ?? line.systemQuantity}</p>
                </div>
                <Badge className={diffStatusClass(status)}>
                  {status === "unset"
                    ? "Nespočítáno"
                    : status === "match"
                      ? "Souhlasí"
                      : status === "shortage"
                        ? `Manko ${diff}`
                        : `Přebytek +${diff}`}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Skutečný stav ({line.unit})</Label>
                    <Input
                      type="number"
                      disabled={readOnly}
                      className="bg-white"
                      placeholder="—"
                      value={line.countedQuantity ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        updateLine(globalIndex, {
                          countedQuantity: raw === "" ? null : Number(raw.replace(",", ".")),
                        });
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Poznámka</Label>
                    <Textarea
                      disabled={readOnly}
                      className="bg-white min-h-[40px]"
                      value={line.note ?? ""}
                      onChange={(e) => updateLine(globalIndex, { note: e.target.value })}
                    />
                  </div>
                </div>
                {isProfile && line.countedProfile && !readOnly ? (
                  <WarehouseInventoryProfileFields
                    unit={line.unit}
                    value={line.countedProfile}
                    onChange={(countedProfile) => updateLine(globalIndex, { countedProfile })}
                  />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uzavřít inventuru?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                Skladové množství se <strong>nezmění</strong> automaticky při zadávání — úpravy proběhnou až zde.
              </span>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={applyMovements}
                  onChange={(e) => setApplyMovements(e.target.checked)}
                />
                Vytvořit inventurní skladové pohyby (manka a přebytky)
              </label>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-500 hover:bg-orange-600 text-black"
              onClick={(e) => {
                e.preventDefault();
                void confirmClose();
              }}
            >
              Potvrdit uzavření
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
