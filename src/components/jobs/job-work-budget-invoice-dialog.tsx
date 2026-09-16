"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildWorkBudgetInvoicePreview,
  type WorkBudgetInvoicePreview,
} from "@/lib/work-budget-invoice";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import {
  defaultIncludeAdvanceInFinalInvoice,
  isAdvanceAvailableForDeduction,
  type JobWorkBudgetAdvanceDoc,
} from "@/lib/work-budget-advances";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export function JobWorkBudgetInvoiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  busy: boolean;
  onConfirm: (selectedAdvanceIds: string[]) => void;
}) {
  const { open, onOpenChange, items, advances, busy, onConfirm } = props;
  const available = useMemo(
    () => advances.filter(isAdvanceAvailableForDeduction),
    [advances]
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const adv of available) {
      next[adv.id] = defaultIncludeAdvanceInFinalInvoice(adv);
    }
    setSelected(next);
  }, [open, available]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );

  let preview: WorkBudgetInvoicePreview | null = null;
  let previewError: string | null = null;
  try {
    preview = buildWorkBudgetInvoicePreview({
      items,
      advances,
      selectedAdvanceIds: selectedIds,
    });
  } catch (e) {
    previewError = e instanceof Error ? e.message : "Nelze spočítat náhled faktury.";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle>Faktura z hotových položek</DialogTitle>
          <DialogDescription>
            Ověřte souhrn před vytvořením faktury. Zálohy lze započítat jen jednou.
          </DialogDescription>
        </DialogHeader>
        {previewError ? (
          <p className="text-sm text-destructive">{previewError}</p>
        ) : preview ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-slate-50 px-3 py-2 space-y-1">
              <div className="flex justify-between gap-2">
                <span>Fakturované položky (běžné)</span>
                <span className="font-semibold tabular-nums">{formatKc(preview.linesNormalGross)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Vícepráce</span>
                <span className="font-semibold tabular-nums">{formatKc(preview.linesExtraGross)}</span>
              </div>
              <div className="flex justify-between gap-2 border-t pt-1 font-medium">
                <span>Mezisoučet s DPH</span>
                <span className="tabular-nums">{formatKc(preview.subtotalGross)}</span>
              </div>
              <div className="flex justify-between gap-2 text-orange-800">
                <span>Započtené zálohy</span>
                <span className="tabular-nums">-{formatKc(preview.deductionGross)}</span>
              </div>
              <div className="flex justify-between gap-2 text-base font-bold border-t pt-1">
                <span>K úhradě s DPH</span>
                <span className="tabular-nums">{formatKc(preview.amountGross)}</span>
              </div>
            </div>
            {available.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-gray-600">Zálohy k započtení</p>
                {available.map((adv) => (
                  <label key={adv.id} className="flex items-start gap-2 rounded border px-2 py-1.5">
                    <Checkbox
                      checked={selected[adv.id] === true}
                      onCheckedChange={(v) =>
                        setSelected((p) => ({ ...p, [adv.id]: v === true }))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{adv.label}</span>
                      <span className="block text-xs text-gray-600 tabular-nums">
                        {formatKc(adv.amountGross)} s DPH
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600">Žádné zálohy k započtení.</p>
            )}
            <p className="text-xs text-gray-600">
              Položek k fakturaci: {preview.billableItems.length}
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            disabled={busy || !!previewError || !preview || preview.billableItems.length === 0}
            onClick={() => onConfirm(selectedIds)}
          >
            Vytvořit fakturu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
