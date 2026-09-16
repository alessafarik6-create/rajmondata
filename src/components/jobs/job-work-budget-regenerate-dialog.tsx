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
  assessWorkBudgetInvoiceRegeneration,
  buildWorkBudgetInvoicePreview,
} from "@/lib/work-budget-invoice";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import {
  defaultIncludeAdvanceInFinalInvoice,
  isAdvanceAvailableForInvoice,
  type JobWorkBudgetAdvanceDoc,
} from "@/lib/work-budget-advances";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

export function JobWorkBudgetRegenerateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: (Record<string, unknown> & { id: string }) | null;
  items: JobWorkBudgetItemDoc[];
  advances: JobWorkBudgetAdvanceDoc[];
  busy: boolean;
  onConfirm: (selectedAdvanceIds: string[]) => void;
}) {
  const { open, onOpenChange, invoice, items, advances, busy, onConfirm } = props;
  const invoiceId = invoice?.id ?? "";

  const assessment = useMemo(
    () => (invoice ? assessWorkBudgetInvoiceRegeneration(invoice) : { allowed: false }),
    [invoice]
  );

  const available = useMemo(
    () => advances.filter((a) => isAdvanceAvailableForInvoice(a, invoiceId)),
    [advances, invoiceId]
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open || !invoice) return;
    const presetIds = Array.isArray(invoice.workBudgetAdvanceIds)
      ? (invoice.workBudgetAdvanceIds as string[])
      : [];
    const next: Record<string, boolean> = {};
    for (const adv of available) {
      next[adv.id] =
        presetIds.includes(adv.id) || defaultIncludeAdvanceInFinalInvoice(adv);
    }
    setSelected(next);
  }, [open, invoice, available]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );

  let previewError: string | null = null;
  let preview = null as ReturnType<typeof buildWorkBudgetInvoicePreview> | null;
  try {
    if (invoiceId && assessment.allowed) {
      preview = buildWorkBudgetInvoicePreview({
        items,
        advances,
        selectedAdvanceIds: selectedIds,
        regenerateInvoiceId: invoiceId,
      });
    }
  } catch (e) {
    previewError = e instanceof Error ? e.message : "Nelze spočítat náhled.";
  }

  const oldSubtotal = roundMoney(invoice?.workBudgetSubtotalGross ?? invoice?.amountGross);
  const oldPay = roundMoney(invoice?.amountGross);
  const newSubtotal = preview?.subtotalGross ?? 0;
  const newPay = preview?.amountGross ?? 0;
  const diff = roundMoney(newPay - oldPay);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white text-slate-900 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Přegenerovat fakturu podle rozpočtu</DialogTitle>
          <DialogDescription>
            Faktura{" "}
            <strong>{String(invoice?.invoiceNumber ?? "—")}</strong> bude aktualizována podle
            aktuálního položkového rozpočtu. Číslo faktury zůstane stejné.
          </DialogDescription>
        </DialogHeader>

        {!assessment.allowed ? (
          <p className="text-sm text-destructive">
            {assessment.blockedReason ?? "Fakturu nelze přegenerovat."}
          </p>
        ) : (
          <>
            {assessment.manualEditWarning ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Tato faktura obsahuje ručně upravené položky. Přegenerováním se položky nahradí
                aktuálním stavem rozpočtu.
              </p>
            ) : null}
            {previewError ? (
              <p className="text-sm text-destructive">{previewError}</p>
            ) : preview ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border bg-slate-50 px-3 py-2 space-y-1">
                  <div className="flex justify-between gap-2">
                    <span>Původní faktura (k úhradě s DPH)</span>
                    <span className="font-semibold tabular-nums">{formatKc(oldPay)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Aktuální rozpočet (mezisoučet s DPH)</span>
                    <span className="font-semibold tabular-nums">{formatKc(newSubtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Vícepráce (s DPH)</span>
                    <span className="tabular-nums">{formatKc(preview.linesExtraGross)}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-t pt-1">
                    <span>Rozdíl k úhradě</span>
                    <span className="tabular-nums font-medium">
                      {diff >= 0 ? "+" : ""}
                      {formatKc(diff)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 text-orange-800">
                    <span>Zálohy</span>
                    <span className="tabular-nums">-{formatKc(preview.deductionGross)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-base font-bold border-t pt-1">
                    <span>Nová částka k úhradě</span>
                    <span className="tabular-nums">{formatKc(newPay)}</span>
                  </div>
                </div>
                {available.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-gray-600">Zálohy k započtení</p>
                    {available.map((adv) => (
                      <label
                        key={adv.id}
                        className="flex items-start gap-2 rounded border px-2 py-1.5"
                      >
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
                ) : null}
                <p className="text-xs text-gray-600">
                  Položek ve faktuře: {preview.billableItems.length}
                </p>
              </div>
            ) : null}
          </>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={busy || !assessment.allowed || !!previewError || !preview}
            onClick={() => onConfirm(selectedIds)}
          >
            Přegenerovat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function roundMoney(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
