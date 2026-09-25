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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import {
  filterItemsByBillingScope,
  remainingToInvoice,
  workBudgetItemHasBillableRemainder,
  type WorkBudgetBillingScope,
} from "@/lib/work-budget-invoicing";
import { isApprovedExtraWorkItem, isNormalBudgetItem } from "@/lib/work-budget-types";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export type WorkBudgetInvoiceDialogConfirm = {
  selectedAdvanceIds: string[];
  billingScope: WorkBudgetBillingScope;
  selectedItemIds?: string[];
};

export function JobWorkBudgetInvoiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  busy: boolean;
  onConfirm: (payload: WorkBudgetInvoiceDialogConfirm) => void;
}) {
  const { open, onOpenChange, items, advances, busy, onConfirm } = props;
  const available = useMemo(
    () => advances.filter(isAdvanceAvailableForDeduction),
    [advances]
  );

  const [billingScope, setBillingScope] = useState<WorkBudgetBillingScope>("base_and_extra");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [manualPick, setManualPick] = useState<Record<string, boolean>>({});

  const billablePool = useMemo(
    () => items.filter((row) => workBudgetItemHasBillableRemainder(row, null)),
    [items]
  );

  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const adv of available) {
      next[adv.id] = defaultIncludeAdvanceInFinalInvoice(adv);
    }
    setSelected(next);
    setBillingScope("base_and_extra");
    const manual: Record<string, boolean> = {};
    for (const row of billablePool) {
      manual[row.id] = true;
    }
    setManualPick(manual);
  }, [open, available, billablePool]);

  const selectedAdvanceIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );

  const manualSelectedIds = useMemo(
    () => Object.entries(manualPick).filter(([, v]) => v).map(([id]) => id),
    [manualPick]
  );

  const selectedItemIds = billingScope === "manual" ? manualSelectedIds : undefined;

  let preview: WorkBudgetInvoicePreview | null = null;
  let previewError: string | null = null;
  try {
    preview = buildWorkBudgetInvoicePreview({
      items,
      advances,
      selectedAdvanceIds: billingScope === "extra_only" ? [] : selectedAdvanceIds,
      billingScope,
      selectedItemIds,
    });
  } catch (e) {
    previewError = e instanceof Error ? e.message : "Nelze spočítat náhled faktury.";
  }

  const manualRows = useMemo(() => {
    const scoped = filterItemsByBillingScope(billablePool, "base_and_extra");
    return scoped.map((row) => ({
      row,
      remainingNet: remainingToInvoice(row).net,
    }));
  }, [billablePool]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle>Vytvořit fakturu</DialogTitle>
          <DialogDescription>Co chcete fakturovat?</DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={billingScope}
          onValueChange={(v) => setBillingScope(v as WorkBudgetBillingScope)}
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="base" id="wb-scope-base" />
            <Label htmlFor="wb-scope-base">Základní rozpočet</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="extra_only" id="wb-scope-extra" />
            <Label htmlFor="wb-scope-extra">Pouze vícepráce</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="base_and_extra" id="wb-scope-both" />
            <Label htmlFor="wb-scope-both">Základní rozpočet + vícepráce</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="manual" id="wb-scope-manual" />
            <Label htmlFor="wb-scope-manual">Vybrat položky ručně</Label>
          </div>
        </RadioGroup>

        {billingScope === "manual" ? (
          <div className="space-y-2 rounded-md border p-2 max-h-48 overflow-y-auto">
            {manualRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Žádné nevyfakturované položky.</p>
            ) : (
              manualRows.map(({ row, remainingNet }) => (
                <label key={row.id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={manualPick[row.id] === true}
                    onCheckedChange={(v) =>
                      setManualPick((p) => ({ ...p, [row.id]: v === true }))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    {isApprovedExtraWorkItem(row) ? (
                      <span className="text-orange-700 font-medium">Vícepráce · </span>
                    ) : isNormalBudgetItem(row) ? null : null}
                    {row.title}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      {formatKc(remainingNet)} bez DPH
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        ) : null}

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
              {billingScope !== "extra_only" && preview.deductionGross > 0 ? (
                <div className="flex justify-between gap-2 text-orange-800">
                  <span>Započtené zálohy</span>
                  <span className="tabular-nums">-{formatKc(preview.deductionGross)}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-2 text-base font-bold border-t pt-1">
                <span>K úhradě s DPH</span>
                <span className="tabular-nums">{formatKc(preview.amountGross)}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Bez DPH: {formatKc(preview.subtotalNet)} · DPH: {formatKc(preview.subtotalVat)}
              </p>
            </div>
            {billingScope !== "extra_only" && available.length > 0 ? (
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
            ) : billingScope !== "extra_only" ? (
              <p className="text-xs text-gray-600">Žádné zálohy k započtení.</p>
            ) : (
              <p className="text-xs text-gray-600">
                Samostatná faktura za vícepráce — zálohy se nezapočítávají automaticky.
              </p>
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
            onClick={() =>
              onConfirm({
                selectedAdvanceIds: billingScope === "extra_only" ? [] : selectedAdvanceIds,
                billingScope,
                selectedItemIds,
              })
            }
          >
            Vytvořit fakturu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
