"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Trash2, Package } from "lucide-react";
import type { PortalManualFormItem } from "@/lib/portal-manual-invoice";
import {
  computePortalManualInvoiceTotals,
  formatPortalInvoiceMoney,
} from "@/lib/portal-manual-invoice";
import { VAT_RATE_OPTIONS } from "@/lib/vat-calculations";
import type { InventoryItemRow } from "@/lib/inventory-types";

export type PortalInvoiceInventoryPick = Pick<
  InventoryItemRow,
  "id" | "name" | "unit" | "unitPrice" | "vatRate" | "imageUrl"
>;

type Props = {
  item: PortalManualFormItem;
  inventoryItems: PortalInvoiceInventoryPick[];
  onChange: (patch: Partial<PortalManualFormItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
};

export function PortalManualInvoiceLineCard({
  item,
  inventoryItems,
  onChange,
  onRemove,
  canRemove,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const lineTotals = useMemo(() => {
    const t = computePortalManualInvoiceTotals([item]);
    return t.rows[0] ?? null;
  }, [item]);

  const applyInventory = (inv: PortalInvoiceInventoryPick) => {
    const price = Number(inv.unitPrice) || 0;
    onChange({
      description: inv.name?.trim() || item.description,
      unitPrice: price > 0 ? price : item.unitPrice,
      unit: inv.unit?.trim() || "ks",
      vatRate:
        inv.vatRate === 0 || inv.vatRate === 12 || inv.vatRate === 21
          ? inv.vatRate
          : item.vatRate,
      inventoryItemId: inv.id,
      imageUrl: inv.imageUrl?.trim() || null,
      priceType: "net",
    });
    setPickerOpen(false);
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        {item.imageUrl ? (
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            <Image src={item.imageUrl} alt="" fill className="object-cover" unoptimized />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          <Label className="text-xs text-muted-foreground">Popis</Label>
          <Input
            placeholder="Popis služby / zboží"
            value={item.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
        {canRemove ? (
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Množství</Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Jednotka</Label>
          <Input value={item.unit} onChange={(e) => onChange({ unit: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Typ ceny</Label>
          <Select
            value={item.priceType}
            onValueChange={(v) => onChange({ priceType: v as "net" | "gross" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="net">Bez DPH</SelectItem>
              <SelectItem value="gross">Včetně DPH</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sazba DPH</Label>
          <Select
            value={String(item.vatRate)}
            onValueChange={(v) =>
              onChange({ vatRate: Number(v) as (typeof VAT_RATE_OPTIONS)[number] })
            }
          >
            <SelectTrigger>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">
            Jednotková cena ({item.priceType === "net" ? "bez DPH" : "vč. DPH"})
          </Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={item.unitPrice}
            onChange={(e) => onChange({ unitPrice: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-end">
          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="w-full gap-2">
                <Package className="h-4 w-4" />
                Vybrat ze skladu
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Skladová položka</DialogTitle>
              </DialogHeader>
              {inventoryItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ve skladu nejsou žádné položky.</p>
              ) : (
                <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                  {inventoryItems.map((inv) => (
                    <li key={inv.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-md border border-border p-2 text-left hover:bg-accent"
                        onClick={() => applyInventory(inv)}
                      >
                        {inv.imageUrl ? (
                          <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded border">
                            <Image src={inv.imageUrl} alt="" fill className="object-cover" unoptimized />
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-sm">{inv.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {inv.unitPrice != null ? `${inv.unitPrice} Kč / ${inv.unit}` : inv.unit}
                            {inv.vatRate != null ? ` · DPH ${inv.vatRate} %` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {lineTotals ? (
        <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 text-xs sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Základ bez DPH</span>
            <p className="font-medium">{formatPortalInvoiceMoney(lineTotals.lineNet)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">DPH {lineTotals.vatRate} %</span>
            <p className="font-medium">{formatPortalInvoiceMoney(lineTotals.lineVat)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Cena s DPH</span>
            <p className="font-medium">{formatPortalInvoiceMoney(lineTotals.lineGross)}</p>
          </div>
        </div>
      ) : null}

      {item.inventoryItemId ? (
        <p className="text-[11px] text-muted-foreground">Vazba na sklad: {item.inventoryItemId}</p>
      ) : null}
    </div>
  );
}
