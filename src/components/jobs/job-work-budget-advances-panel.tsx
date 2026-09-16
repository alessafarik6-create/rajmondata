"use client";

import React, { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { LIGHT_FORM_CONTROL_CLASS, LIGHT_SELECT_CONTENT_CLASS, LIGHT_SELECT_TRIGGER_CLASS } from "@/lib/light-form-control-classes";
import { Plus } from "lucide-react";
import {
  WORK_BUDGET_ADVANCES_COLLECTION,
  defaultIncludeAdvanceInFinalInvoice,
  filterAdvanceInvoiceCandidates,
  parseWorkBudgetAdvanceFromFirestore,
  sumAdvancesGross,
  WORK_BUDGET_ADVANCE_PAYMENT_STATUS,
  WORK_BUDGET_ADVANCE_SOURCE,
  type JobWorkBudgetAdvanceDoc,
} from "@/lib/work-budget-advances";
import { computeExpenseAmountsFromInput, normalizeVatRate, VAT_RATE_OPTIONS, type VatRatePercent } from "@/lib/vat-calculations";
import { roundMoney2 } from "@/lib/vat-calculations";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

const paymentLabel: Record<string, string> = {
  unpaid: "Nezaplacená",
  partial: "Částečně",
  paid: "Zaplacená",
};

export function JobWorkBudgetAdvancesPanel(props: {
  companyId: string;
  jobId: string;
  user: User;
  canManage: boolean;
}) {
  const { companyId, jobId, user, canManage } = props;
  const firestore = useFirestore();
  const { toast } = useToast();

  const advancesCol = useMemoFirebase(
    () => collection(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ADVANCES_COLLECTION),
    [firestore, companyId, jobId]
  );
  const { data: rawAdvances } = useCollection<Record<string, unknown>>(advancesCol);

  const invoicesCol = useMemoFirebase(
    () => collection(firestore, "companies", companyId, "invoices"),
    [firestore, companyId]
  );
  const { data: rawInvoices } = useCollection<Record<string, unknown>>(invoicesCol);

  const advances = useMemo(
    () =>
      (rawAdvances ?? []).map((row, i) =>
        parseWorkBudgetAdvanceFromFirestore(
          row as Record<string, unknown>,
          String((row as { id?: string }).id ?? `adv-${i}`)
        )
      ),
    [rawAdvances]
  );

  const jobInvoices = useMemo(() => {
    const list = (rawInvoices ?? []).filter(
      (inv) => String((inv as { jobId?: string }).jobId ?? "") === jobId
    );
    return list as Array<Record<string, unknown> & { id: string }>;
  }, [rawInvoices, jobId]);

  const linkedInvoiceIds = useMemo(
    () => new Set(advances.map((a) => a.invoiceId).filter(Boolean) as string[]),
    [advances]
  );

  const invoiceCandidates = useMemo(
    () => filterAdvanceInvoiceCandidates({ invoices: jobInvoices, linkedInvoiceIds }),
    [jobInvoices, linkedInvoiceIds]
  );

  const totalAdvances = sumAdvancesGross(advances);
  const paidForFinal = sumAdvancesGross(advances, (a) =>
    defaultIncludeAdvanceInFinalInvoice(a)
  );

  const [pickInvoiceOpen, setPickInvoiceOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLabel, setManualLabel] = useState("Ruční záloha");
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualAmount, setManualAmount] = useState("");
  const [manualVat, setManualVat] = useState<VatRatePercent>(21);
  const [manualVs, setManualVs] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualInclude, setManualInclude] = useState(true);
  const [manualPaid, setManualPaid] = useState(true);
  const [busy, setBusy] = useState(false);

  const addFromInvoice = async (candidateId: string) => {
    const c = invoiceCandidates.find((x) => x.id === candidateId);
    if (!c || !firestore) return;
    setBusy(true);
    try {
      await addDoc(advancesCol!, {
        companyId,
        jobId,
        sourceType: WORK_BUDGET_ADVANCE_SOURCE.INVOICE,
        invoiceId: c.id,
        label: `Zálohová faktura ${c.invoiceNumber}`,
        documentNumber: c.invoiceNumber,
        issueDate: c.issueDate,
        amountNet: c.amountNet,
        vatAmount: c.vatAmount,
        amountGross: c.amountGross,
        paymentStatus:
          c.paymentStatus === "paid" || c.paidGross >= c.amountGross - 0.01
            ? WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PAID
            : c.paidGross > 0
              ? WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PARTIAL
              : WORK_BUDGET_ADVANCE_PAYMENT_STATUS.UNPAID,
        includeInFinalInvoice: true,
        appliedToInvoiceId: null,
        note: null,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Zálohová faktura přidána" });
      setPickInvoiceOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nepodařilo se přidat zálohu",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    const gross = roundMoney2(Number(manualAmount.replace(",", ".")) || 0);
    if (gross <= 0) {
      toast({ variant: "destructive", title: "Zadejte kladnou částku" });
      return;
    }
    const vatRate = normalizeVatRate(manualVat);
    const split = computeExpenseAmountsFromInput({
      amountInput: gross,
      amountType: "gross",
      vatRate,
    });
    setBusy(true);
    try {
      await addDoc(advancesCol!, {
        companyId,
        jobId,
        sourceType: WORK_BUDGET_ADVANCE_SOURCE.MANUAL,
        invoiceId: null,
        label: manualLabel.trim() || "Ruční záloha",
        documentNumber: manualVs.trim() || null,
        variableSymbol: manualVs.trim() || null,
        issueDate: manualDate || null,
        amountNet: split.amountNet,
        vatAmount: split.vatAmount,
        amountGross: split.amountGross,
        paymentStatus: manualPaid
          ? WORK_BUDGET_ADVANCE_PAYMENT_STATUS.PAID
          : WORK_BUDGET_ADVANCE_PAYMENT_STATUS.UNPAID,
        includeInFinalInvoice: manualInclude,
        appliedToInvoiceId: null,
        note: manualNote.trim() || null,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Ruční záloha uložena" });
      setManualOpen(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleInclude = async (row: JobWorkBudgetAdvanceDoc, checked: boolean) => {
    if (!canManage || row.appliedToInvoiceId) return;
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ADVANCES_COLLECTION, row.id),
        { includeInFinalInvoice: checked, updatedAt: serverTimestamp() }
      );
    } catch {
      toast({ variant: "destructive", title: "Změna se nezdařila" });
    }
  };

  const removeAdvance = async (row: JobWorkBudgetAdvanceDoc) => {
    if (!canManage || row.appliedToInvoiceId) return;
    if (!window.confirm(`Odebrat zálohu „${row.label}"?`)) return;
    try {
      await deleteDoc(
        doc(firestore, "companies", companyId, "jobs", jobId, WORK_BUDGET_ADVANCES_COLLECTION, row.id)
      );
    } catch {
      toast({ variant: "destructive", title: "Smazání se nezdařilo" });
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-orange-200/70 bg-orange-50/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-950">Zálohy zakázky</h3>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setPickInvoiceOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Přidat zálohovou fakturu
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setManualOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Přidat ruční zálohu
            </Button>
          </div>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 text-sm">
        <div>
          <p className="text-xs text-gray-600">Zálohy celkem s DPH</p>
          <p className="font-bold tabular-nums">{formatKc(totalAdvances)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">K započtení (výchozí)</p>
          <p className="font-bold tabular-nums">{formatKc(paidForFinal)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Počet záznamů</p>
          <p className="font-bold">{advances.length}</p>
        </div>
      </div>
      {advances.length === 0 ? (
        <p className="text-sm text-gray-700">Zatím žádné zálohy v rozpočtu zakázky.</p>
      ) : (
        <ul className="space-y-2">
          {advances.map((row) => (
            <li
              key={row.id}
              className={cn(
                "rounded-lg border bg-white px-3 py-2 text-sm",
                row.appliedToInvoiceId && "opacity-75"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{row.label}</p>
                  <p className="text-xs text-gray-600">
                    {formatKc(row.amountGross)} s DPH · {paymentLabel[row.paymentStatus] ?? row.paymentStatus}
                    {row.issueDate ? ` · ${row.issueDate}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.sourceType === WORK_BUDGET_ADVANCE_SOURCE.MANUAL ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Ruční záloha
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Z faktury
                      </Badge>
                    )}
                    {row.appliedToInvoiceId ? (
                      <Badge className="text-[10px]">Započteno ve faktuře</Badge>
                    ) : null}
                  </div>
                </div>
                {canManage && !row.appliedToInvoiceId ? (
                  <div className="flex flex-col items-end gap-1">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={row.includeInFinalInvoice}
                        onCheckedChange={(v) => void toggleInclude(row, v === true)}
                      />
                      Započítat do konečné faktury
                    </label>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-red-700" onClick={() => void removeAdvance(row)}>
                      Odebrat
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pickInvoiceOpen} onOpenChange={setPickInvoiceOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Přidat zálohovou fakturu</DialogTitle>
          </DialogHeader>
          {invoiceCandidates.length === 0 ? (
            <p className="text-sm text-gray-700">Žádné nepřiřazené zálohové faktury k této zakázce.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {invoiceCandidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border px-3 py-2 text-left hover:bg-slate-50"
                    disabled={busy}
                    onClick={() => void addFromInvoice(c.id)}
                  >
                    <p className="font-medium">{c.invoiceNumber}</p>
                    <p className="text-xs text-gray-600">
                      {formatKc(c.amountGross)} · {c.issueDate ?? "—"} · {c.paymentStatus}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Ruční záloha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Název / poznámka</Label>
              <Input className={LIGHT_FORM_CONTROL_CLASS} value={manualLabel} onChange={(e) => setManualLabel(e.target.value)} />
            </div>
            <div>
              <Label>Datum</Label>
              <Input type="date" className={LIGHT_FORM_CONTROL_CLASS} value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Částka s DPH</Label>
                <Input className={LIGHT_FORM_CONTROL_CLASS} value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} />
              </div>
              <div>
                <Label>DPH</Label>
                <Select value={String(manualVat)} onValueChange={(v) => setManualVat(normalizeVatRate(Number(v)))}>
                  <SelectTrigger className={LIGHT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                    {VAT_RATE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>VS / číslo dokladu</Label>
              <Input className={LIGHT_FORM_CONTROL_CLASS} value={manualVs} onChange={(e) => setManualVs(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={manualPaid} onCheckedChange={(v) => setManualPaid(v === true)} />
              Zaplacená
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={manualInclude} onCheckedChange={(v) => setManualInclude(v === true)} />
              Započítat do konečné faktury
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={busy} onClick={() => void saveManual()}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
