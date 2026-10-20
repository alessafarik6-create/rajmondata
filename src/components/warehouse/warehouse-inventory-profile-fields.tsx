"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WarehouseInventoryProfileCount } from "@/lib/warehouse-inventory-types";
import { computeProfileTotalMm } from "@/lib/warehouse-inventory-diff";
import { Plus, Trash2 } from "lucide-react";

type Props = {
  value: WarehouseInventoryProfileCount;
  onChange: (next: WarehouseInventoryProfileCount) => void;
  unit: string;
};

export function WarehouseInventoryProfileFields({ value, onChange, unit }: Props) {
  const totalMm = computeProfileTotalMm(value);
  const partials = value.partialLengthsMm ?? [];

  function updatePartial(index: number, raw: string) {
    const n = Number(String(raw).replace(",", "."));
    const next = [...partials];
    next[index] = Number.isFinite(n) ? n : 0;
    onChange({ ...value, partialLengthsMm: next });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3 text-sm">
      <p className="font-medium text-slate-800">Profily — kusy a délky</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Počet celých tyčí</Label>
          <Input
            type="number"
            min={0}
            className="h-9 bg-white"
            value={value.fullBarCount}
            onChange={(e) =>
              onChange({
                ...value,
                fullBarCount: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
          />
        </div>
        <div>
          <Label className="text-xs">Délka tyče (mm)</Label>
          <Input
            type="number"
            min={0}
            className="h-9 bg-white"
            value={value.barLengthMm}
            onChange={(e) =>
              onChange({
                ...value,
                barLengthMm: Number(String(e.target.value).replace(",", ".")) || 0,
              })
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Načaté kusy / zbytky (délka mm)</Label>
        {partials.map((len, i) => (
          <div key={i} className="flex gap-2">
            <Input
              type="number"
              min={0}
              className="h-9 bg-white"
              value={len || ""}
              onChange={(e) => updatePartial(i, e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-red-600"
              onClick={() => {
                const next = partials.filter((_, j) => j !== i);
                onChange({ ...value, partialLengthsMm: next });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onChange({ ...value, partialLengthsMm: [...partials, 0] })}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Přidat délku zbytku
        </Button>
      </div>
      {String(unit).trim().toLowerCase() === "mm" ? (
        <p className="text-xs text-slate-600">
          Celková délka materiálu:{" "}
          <strong>{totalMm.toLocaleString("cs-CZ")} mm</strong> (přepočítá se do skutečného stavu)
        </p>
      ) : null}
    </div>
  );
}
