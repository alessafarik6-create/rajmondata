"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { Loader2, Plus, ClipboardList, ArrowLeft } from "lucide-react";
import { useUser, useFirebase, useCompany, useCollection, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { InventoryItemRow } from "@/lib/inventory-types";
import { isActiveInventoryItem } from "@/lib/inventory-helpers";
import {
  inventoryLineFromItem,
  recomputeInventoryStats,
} from "@/lib/warehouse-inventory-diff";
import {
  WAREHOUSE_INVENTORY_STATUS_LABELS,
  type WarehouseInventoryDoc,
} from "@/lib/warehouse-inventory-types";
import { nextInventoryNumber } from "@/lib/warehouse-inventory-client";

const CARD = "border-slate-200 bg-white text-slate-900";

export default function SkladInventuryPage() {
  const { user } = useUser();
  const { firestore, areServicesAvailable } = useFirebase();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [workerName, setWorkerName] = useState("");
  const [warehouseName, setWarehouseName] = useState("Hlavní sklad");
  const [busy, setBusy] = useState(false);

  const itemsQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "inventoryItems"),
      orderBy("name"),
      limit(500)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const invQuery = useMemoFirebase(() => {
    if (!areServicesAvailable || !firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "warehouseInventories"),
      limit(100)
    );
  }, [areServicesAvailable, firestore, companyId]);

  const { data: itemsRaw = [], isLoading: itemsLoading } = useCollection(itemsQuery);
  const { data: invRaw = [], isLoading: invLoading } = useCollection(invQuery);

  const activeItems = useMemo(
    () =>
      (Array.isArray(itemsRaw) ? itemsRaw : [])
        .map((r) => r as InventoryItemRow)
        .filter((r) => isActiveInventoryItem(r)),
    [itemsRaw]
  );

  const inventories = useMemo(() => {
    const list = (Array.isArray(invRaw) ? invRaw : []).map((r) => ({
      ...(r as WarehouseInventoryDoc),
      id: String((r as { id?: string }).id ?? ""),
    }));
    return list.sort((a, b) => {
      const ta = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
      const tb = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [invRaw]);

  async function createInventory(allItems: boolean) {
    if (!user || !firestore || !companyId) return;
    setBusy(true);
    try {
      const lines = activeItems.map((row) => inventoryLineFromItem(row));
      const stats = recomputeInventoryStats(lines);
      const number = nextInventoryNumber(inventories);
      const ref = await addDoc(
        collection(firestore, "companies", companyId, "warehouseInventories"),
        {
          companyId,
          inventoryNumber: number,
          status: "draft",
          warehouseName: warehouseName.trim() || "Hlavní sklad",
          scopeLabel: allItems ? "Celý sklad" : "Celý sklad",
          assignedWorkerName: workerName.trim() || null,
          notes: null,
          lines,
          stats,
          statusHistory: [
            {
              at: new Date().toISOString(),
              by: user.uid,
              from: "draft",
              to: "draft",
              note: "Založení inventury",
            },
          ],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user.uid,
        }
      );
      toast({ title: "Inventura založena", description: number });
      setCreateOpen(false);
      router.push(`/portal/sklad/inventury/${ref.id}`);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Nepodařilo se založit inventuru.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!user || !companyId) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button variant="link" className="px-0 h-auto text-slate-600" asChild>
            <Link href="/portal/sklad">
              <ArrowLeft className="h-4 w-4 mr-1" /> Sklad
            </Link>
          </Button>
          <h1 className="portal-page-title text-2xl text-slate-900">Inventury</h1>
          <p className="text-sm text-slate-600 mt-1">
            Elektronická inventura, rozdíly a bezpečné uzavření se skladovými pohyby.
          </p>
        </div>
        <Button
          type="button"
          className="bg-orange-500 hover:bg-orange-600 text-black gap-2"
          disabled={itemsLoading || !activeItems.length}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" /> Nová inventura
        </Button>
      </div>

      <Card className={CARD}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> Historie inventur
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : inventories.length === 0 ? (
            <p className="text-sm text-slate-600">Zatím žádná inventura.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {inventories.map((inv) => (
                <li key={inv.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <Link
                      href={`/portal/sklad/inventury/${inv.id}`}
                      className="font-semibold text-slate-900 hover:text-orange-600"
                    >
                      {inv.inventoryNumber}
                    </Link>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {inv.warehouseName} · {inv.scopeLabel} ·{" "}
                      {inv.stats?.linesTotal ?? inv.lines?.length ?? 0} položek
                    </p>
                  </div>
                  <Badge variant="outline">{WAREHOUSE_INVENTORY_STATUS_LABELS[inv.status] ?? inv.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>Nová inventura</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>Načte se aktuální stav všech aktivních položek ({activeItems.length}).</p>
            <div>
              <Label>Sklad</Label>
              <Input value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} className="bg-white" />
            </div>
            <div>
              <Label>Odpovědný pracovník</Label>
              <Input value={workerName} onChange={(e) => setWorkerName(e.target.value)} className="bg-white" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              className="bg-orange-500 hover:bg-orange-600 text-black"
              disabled={busy}
              onClick={() => void createInventory(true)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Založit a pokračovat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
