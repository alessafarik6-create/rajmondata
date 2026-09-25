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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { Firestore } from "firebase/firestore";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import type { JobWorkBudgetAdvanceDoc } from "@/lib/work-budget-advances";
import {
  buildWorkBudgetSplitPreview,
  canSplitWorkBudgetInvoice,
  classifyWorkBudgetInvoiceLines,
  invoiceHasBaseAndExtraForSplit,
  parseInvoiceLinesFromDoc,
  splitWorkBudgetCombinedInvoice,
  type WorkBudgetSplitLineBucket,
} from "@/lib/work-budget-invoice-split";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

function newSplitOperationId(): string {
  return `split-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function JobWorkBudgetSplitInvoiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firestore: Firestore;
  companyId: string;
  jobId: string;
  jobDisplayName: string;
  invoice: (Record<string, unknown> & { id: string }) | null;
  budgetCatalog: JobWorkBudgetItemDoc[];
  orgBankAccounts: OrgBankAccountRow[];
  companyDoc: Record<string, unknown> | null | undefined;
  advances: JobWorkBudgetAdvanceDoc[];
  userId: string;
  profileDisplayName?: string;
  onSuccess: (result: {
    baseInvoiceId: string;
    extrasInvoiceId: string;
    baseInvoiceNumber: string;
    extrasInvoiceNumber: string;
  }) => void;
}) {
  const {
    open,
    onOpenChange,
    firestore,
    companyId,
    jobId,
    jobDisplayName,
    invoice,
    budgetCatalog,
    orgBankAccounts,
    companyDoc,
    advances,
    userId,
    profileDisplayName,
    onSuccess,
  } = props;

  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Record<string, WorkBudgetSplitLineBucket>>({});
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setManual({});
      setBusy(false);
    }
  }, [open]);

  const gate = useMemo(
    () => (invoice ? canSplitWorkBudgetInvoice(invoice) : { allowed: false }),
    [invoice]
  );

  const lines = useMemo(
    () => (invoice ? parseInvoiceLinesFromDoc(invoice) : []),
    [invoice]
  );

  const classification = useMemo(() => {
    if (!invoice) return null;
    return classifyWorkBudgetInvoiceLines({
      lines,
      budgetCatalog,
      manualAssignments: manual,
    });
  }, [invoice, lines, budgetCatalog, manual]);

  let preview: ReturnType<typeof buildWorkBudgetSplitPreview> | null = null;
  let previewError: string | null = null;
  if (invoice && gate.allowed && classification && classification.ambiguousLines.length === 0) {
    try {
      preview = buildWorkBudgetSplitPreview({
        inv: invoice,
        budgetCatalog,
        manualAssignments: manual,
      });
    } catch (e) {
      previewError = e instanceof Error ? e.message : "Nelze spočítat rozdělení.";
    }
  }

  const canConfirm =
    gate.allowed &&
    invoice &&
    invoiceHasBaseAndExtraForSplit(invoice, budgetCatalog, manual) &&
    preview != null &&
    !busy;

  const confirm = async () => {
    if (!invoice || !canConfirm) return;
    setBusy(true);
    try {
      const result = await splitWorkBudgetCombinedInvoice({
        firestore,
        companyId,
        jobId,
        invoiceId: invoice.id,
        jobDisplayName,
        companyDoc,
        orgBankAccounts,
        budgetCatalog,
        advances,
        splitOperationId: newSplitOperationId(),
        manualAssignments: manual,
        userId,
        profileDisplayName,
      });
      onSuccess(result);
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Rozdělení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  const invNum = String(invoice?.invoiceNumber ?? "—");

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle>Rozdělit fakturu</DialogTitle>
          <DialogDescription>
            Vytvoří dvě faktury — základní práce a vícepráce. Původní koncept bude nahrazen v
            historii.
          </DialogDescription>
        </DialogHeader>

        {!gate.allowed ? (
          <p className="text-sm text-red-700">{gate.reason ?? "Nelze rozdělit."}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <p>
                Původní faktura: <strong>{invNum}</strong>
              </p>
              {preview ? (
                <>
                  <p>
                    Základní práce:{" "}
                    <strong>{formatKc(preview.baseGross)} s DPH</strong>
                    {preview.advanceDeductionGross > 0 ? (
                      <>
                        {" "}
                        (k úhradě {formatKc(preview.baseDueGross)} po zálohách)
                      </>
                    ) : null}
                  </p>
                  <p>
                    Vícepráce: <strong>{formatKc(preview.extraGross)} s DPH</strong>
                  </p>
                  {preview.advanceDeductionGross > 0 ? (
                    <p className="text-orange-900">
                      Započtené zálohy ({formatKc(preview.advanceDeductionGross)}) zůstanou u
                      faktury základních prací.
                    </p>
                  ) : null}
                </>
              ) : previewError ? (
                <p className="text-red-700">{previewError}</p>
              ) : null}
            </div>

            {classification && classification.ambiguousLines.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="font-semibold text-amber-950">Nutno zařadit</p>
                <ul className="mt-2 space-y-2">
                  {classification.ambiguousLines.map((line) => (
                    <li key={line.id} className="flex flex-col gap-1">
                      <span>{line.description || line.id}</span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={manual[line.id] === "base" ? "default" : "outline"}
                          onClick={() => setManual((m) => ({ ...m, [line.id]: "base" }))}
                        >
                          Základní práce
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={manual[line.id] === "extra" ? "default" : "outline"}
                          onClick={() => setManual((m) => ({ ...m, [line.id]: "extra" }))}
                        >
                          Vícepráce
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview && classification ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs uppercase text-gray-600">Základní práce</Label>
                  <ul className="mt-1 list-inside list-disc text-xs text-gray-800">
                    {classification.baseLines.map((l) => (
                      <li key={l.id}>{l.description}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <Label className="text-xs uppercase text-gray-600">Vícepráce</Label>
                  <ul className="mt-1 list-inside list-disc text-xs text-gray-800">
                    {classification.extraLines.map((l) => (
                      <li key={l.id}>{l.description}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <p className="text-xs text-gray-600">
              Budou vytvořeny: Faktura 1 – základní práce (č. {invNum}), Faktura 2 – vícepráce (nové
              číslo řady FA).
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={() => void confirm()}>
            {busy ? "Rozděluji fakturu…" : "Rozdělit fakturu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
