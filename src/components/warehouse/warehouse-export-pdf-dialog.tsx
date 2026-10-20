"use client";

import { useState } from "react";
import { Loader2, FileDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { WarehousePdfExportKind } from "@/lib/warehouse-inventory-types";
import { downloadWarehouseInventoryPdf } from "@/lib/warehouse-inventory-client";

export type WarehouseExportScope = "filtered" | "all" | "selected";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getToken: () => Promise<string>;
  resolveItemIds: (scope: WarehouseExportScope) => string[];
  filteredCount: number;
  allCount: number;
  selectedCount: number;
};

export function WarehouseExportPdfDialog(props: Props) {
  const { open, onOpenChange, getToken, resolveItemIds, filteredCount, allCount, selectedCount } =
    props;
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<WarehouseExportScope>("filtered");
  const [warehouseName, setWarehouseName] = useState("Hlavní sklad");
  const [hideSystem, setHideSystem] = useState(false);
  const [showPrices, setShowPrices] = useState(false);

  async function run(kind: WarehousePdfExportKind) {
    setBusy(true);
    try {
      const token = await getToken();
      const itemIds = resolveItemIds(scope);
      if (!itemIds.length) {
        toast({ variant: "destructive", title: "Export", description: "Žádné položky ve vybraném rozsahu." });
        return;
      }
      const res = await downloadWarehouseInventoryPdf({
        token,
        kind,
        itemIds,
        warehouseName: warehouseName.trim() || "Hlavní sklad",
        hideSystemQuantity: kind === "count_sheet" ? hideSystem : undefined,
        showPrices: kind === "valued_list" ? true : showPrices,
      });
      if (!res.ok) throw new Error(res.error);
      toast({ title: "PDF připraveno", description: "Soubor byl stažen." });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Export PDF",
        description: e instanceof Error ? e.message : "Export selhal.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>Inventura / Export PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <Label>Rozsah položek</Label>
            <div className="space-y-2">
              {(
                [
                  ["filtered", `Filtrované položky (${filteredCount})`],
                  ["all", `Všechny položky (${allCount})`],
                  ["selected", `Vybrané checkboxem (${selectedCount})`],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-name">Název skladu</Label>
            <Input
              id="wh-name"
              value={warehouseName}
              onChange={(e) => setWarehouseName(e.target.value)}
              className="bg-white"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <Checkbox checked={hideSystem} onCheckedChange={(v) => setHideSystem(v === true)} />
              Inventura naslepo (skrýt stav v systému v listu)
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={showPrices} onCheckedChange={(v) => setShowPrices(v === true)} />
              Zobrazit ceny ve standardním exportu
            </label>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            className="w-full bg-orange-500 hover:bg-orange-600 text-black"
            disabled={busy}
            onClick={() => void run("stock_list")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
            Export položek (PDF)
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void run("count_sheet")}>
            Inventurní list k tisku (A4 na šířku)
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void run("valued_list")}>
            Oceněný skladový soupis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
