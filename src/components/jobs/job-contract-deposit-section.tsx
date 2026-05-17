"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentReference } from "firebase/firestore";
import { serverTimestamp, updateDoc } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { JD } from "@/lib/job-detail-page-styles";
import { useIsBelowLg } from "@/hooks/use-mobile";
import {
  createManualDepositPaymentId,
  formatMoneyInputDisplay,
  formatContractManualDateLabel,
  JOB_CONTRACT_MANUAL_FIELD,
  normalizeContractedAtToIso,
  parseContractedAtInput,
  parseJobContractManual,
  parseMoneyInput,
  serializeJobContractManualForFirestore,
  type JobContractManualData,
  type ManualDepositPayment,
} from "@/lib/job-contract-manual";
import {
  calculateJobPaymentSummary,
  formatMoneyKc,
  paymentStatusLabelCs,
} from "@/lib/job-payment-summary";
import type { JobIncomeForDeposit, JobInvoiceForDeposit } from "@/lib/job-deposit-summary";
import type { WorkContractDoc } from "@/lib/work-contract-print-html-build";

type Props = {
  jobRef: DocumentReference | null;
  job: Record<string, unknown> | null | undefined;
  /** Pouze vlastník / admin organizace */
  canEdit: boolean;
  /** Zaměstnanec s přístupem — jen náhled */
  canView: boolean;
  /** Výchozí celková cena z rozpočtu zakázky (Kč s DPH) */
  defaultTotalPriceGross?: number | null;
  workContractsForJob?: WorkContractDoc[];
  jobInvoices?: JobInvoiceForDeposit[];
  jobIncomes?: JobIncomeForDeposit[];
};

type ManualPaymentRowState = {
  id: string;
  paidAtIso: string;
  paidAtText: string;
  amountInput: string;
  note: string;
};

function manualFingerprint(job: unknown): string {
  const m = parseJobContractManual(job);
  return JSON.stringify(m);
}

function paymentsToRowState(payments: ManualDepositPayment[]): ManualPaymentRowState[] {
  return payments.map((p) => ({
    id: p.id,
    paidAtIso: p.paidAt ?? "",
    paidAtText: p.paidAt ? formatContractManualDateLabel(p.paidAt) : "",
    amountInput: formatMoneyInputDisplay(p.amountGross),
    note: p.note ?? "",
  }));
}

function rowStateToPayments(rows: ManualPaymentRowState[]): ManualDepositPayment[] {
  return rows.map((r) => ({
    id: r.id,
    paidAt:
      normalizeContractedAtToIso(r.paidAtIso) ||
      parseContractedAtInput(r.paidAtText),
    amountGross: parseMoneyInput(r.amountInput) ?? 0,
    note: r.note.trim() || null,
  }));
}

export function JobContractDepositSection({
  jobRef,
  job,
  canEdit,
  canView,
  defaultTotalPriceGross,
  workContractsForJob = [],
  jobInvoices = [],
  jobIncomes = [],
}: Props) {
  const belowLg = useIsBelowLg();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [isContracted, setIsContracted] = useState(false);
  /** ISO YYYY-MM-DD pro date picker a uložení. */
  const [contractedAtIso, setContractedAtIso] = useState("");
  /** Ruční vstup dd.mm.yyyy (synchronizace při blur). */
  const [contractedAtText, setContractedAtText] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [totalPriceInput, setTotalPriceInput] = useState("");
  const [requiredDepositInput, setRequiredDepositInput] = useState("");
  const [paidDepositInput, setPaidDepositInput] = useState("");
  const [manualPaymentRows, setManualPaymentRows] = useState<ManualPaymentRowState[]>(
    []
  );
  const [depositNote, setDepositNote] = useState("");

  const fp = manualFingerprint(job);

  useEffect(() => {
    const m = parseJobContractManual(job);
    setIsContracted(m.isContracted === true);
    const iso = normalizeContractedAtToIso(m.contractedAt) ?? "";
    setContractedAtIso(iso);
    setContractedAtText(iso ? formatContractManualDateLabel(iso) : "");
    setContractNumber(m.contractNumber ?? "");
    setTotalPriceInput(
      formatMoneyInputDisplay(
        m.totalPriceGross ??
          (defaultTotalPriceGross != null ? defaultTotalPriceGross : null)
      )
    );
    setRequiredDepositInput(formatMoneyInputDisplay(m.requiredDepositGross));
    setPaidDepositInput(formatMoneyInputDisplay(m.paidDepositGross));
    setManualPaymentRows(
      m.manualDepositPayments?.length
        ? paymentsToRowState(m.manualDepositPayments)
        : []
    );
    setDepositNote(m.depositNote ?? "");
  }, [fp, defaultTotalPriceGross, job]);

  const persist = useCallback(
    async (payload: JobContractManualData) => {
      if (!jobRef || !canEdit) return;
      setSaving(true);
      try {
        await updateDoc(jobRef, {
          [JOB_CONTRACT_MANUAL_FIELD]: serializeJobContractManualForFirestore(payload),
          updatedAt: serverTimestamp(),
        });
        toast({
          title: "Uloženo",
          description: "Údaje smlouvy a zálohy byly uloženy.",
        });
      } catch (e) {
        console.error(e);
        toast({
          variant: "destructive",
          title: "Uložení se nezdařilo",
          description: e instanceof Error ? e.message : "Zkuste to znovu.",
        });
      } finally {
        setSaving(false);
      }
    },
    [jobRef, canEdit, toast]
  );

  const resolveContractedAtForSave = useCallback((): string | null => {
    return (
      normalizeContractedAtToIso(contractedAtIso) ||
      parseContractedAtInput(contractedAtText) ||
      null
    );
  }, [contractedAtIso, contractedAtText]);

  const handleContractedAtTextBlur = () => {
    const trimmed = contractedAtText.trim();
    if (!trimmed) {
      setContractedAtIso("");
      setContractedAtText("");
      return;
    }
    const iso = parseContractedAtInput(trimmed);
    if (!iso) {
      toast({
        variant: "destructive",
        title: "Neplatné datum",
        description: "Zadejte datum ve formátu dd.mm.yyyy (např. 15.03.2024).",
      });
      setContractedAtText(
        contractedAtIso ? formatContractManualDateLabel(contractedAtIso) : ""
      );
      return;
    }
    setContractedAtIso(iso);
    setContractedAtText(formatContractManualDateLabel(iso));
  };

  const buildManualDataPayload = useCallback((): JobContractManualData => {
    const manualDepositPayments = rowStateToPayments(manualPaymentRows);
    return {
      isContracted,
      contractedAt: resolveContractedAtForSave(),
      contractNumber: contractNumber.trim() || null,
      totalPriceGross: parseMoneyInput(totalPriceInput),
      requiredDepositGross: parseMoneyInput(requiredDepositInput),
      paidDepositGross:
        manualDepositPayments.length > 0
          ? null
          : parseMoneyInput(paidDepositInput),
      manualDepositPayments,
      depositNote: depositNote.trim() || null,
    };
  }, [
    manualPaymentRows,
    isContracted,
    resolveContractedAtForSave,
    contractNumber,
    totalPriceInput,
    requiredDepositInput,
    paidDepositInput,
    depositNote,
  ]);

  const handleSave = () => {
    void persist(buildManualDataPayload());
  };

  const addManualPaymentRow = () => {
    setManualPaymentRows((rows) => [
      ...rows,
      {
        id: createManualDepositPaymentId(),
        paidAtIso: "",
        paidAtText: "",
        amountInput: "",
        note: "",
      },
    ]);
  };

  const updateManualPaymentRow = (
    id: string,
    patch: Partial<Omit<ManualPaymentRowState, "id">>
  ) => {
    setManualPaymentRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const removeManualPaymentRow = (id: string) => {
    setManualPaymentRows((rows) => rows.filter((r) => r.id !== id));
  };

  const handleManualPaymentDateBlur = (id: string) => {
    const row = manualPaymentRows.find((r) => r.id === id);
    if (!row) return;
    const trimmed = row.paidAtText.trim();
    if (!trimmed) {
      updateManualPaymentRow(id, { paidAtIso: "", paidAtText: "" });
      return;
    }
    const iso = parseContractedAtInput(trimmed);
    if (!iso) {
      toast({
        variant: "destructive",
        title: "Neplatné datum platby",
        description: "Zadejte datum ve formátu dd.mm.yyyy.",
      });
      updateManualPaymentRow(id, {
        paidAtText: row.paidAtIso
          ? formatContractManualDateLabel(row.paidAtIso)
          : "",
      });
      return;
    }
    updateManualPaymentRow(id, {
      paidAtIso: iso,
      paidAtText: formatContractManualDateLabel(iso),
    });
  };

  const fieldClass = cn("w-full min-w-0", belowLg && "text-base");
  const gridClass = cn(
    "grid gap-4",
    belowLg ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
  );

  const paymentPreview = useMemo(() => {
    if (!job) return null;
    const draftJob: Record<string, unknown> = {
      ...job,
      contractManual: serializeJobContractManualForFirestore(buildManualDataPayload()),
    };
    return calculateJobPaymentSummary({
      job: draftJob,
      invoices: jobInvoices,
      workContracts: workContractsForJob,
      jobIncomes,
    });
  }, [
    job,
    buildManualDataPayload,
    jobInvoices,
    workContractsForJob,
    jobIncomes,
  ]);

  if (!canView) return null;

  return (
    <Card className={cn(JD.card)}>
      <CardHeader className={belowLg ? "px-4 pb-2" : undefined}>
        <CardTitle className={JD.cardTitle}>
          <FileText aria-hidden />
          Smlouva a záloha
        </CardTitle>
        <CardDescription className="text-sm text-gray-700">
          Ruční záznam pro zakázky mimo portálovou smlouvu nebo zálohovou fakturu. Používá se
          v exportu zesmluvněných zakázek.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-4", belowLg && "px-4")}>
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-3",
            belowLg && "flex-col items-stretch"
          )}
        >
          <div className="min-w-0">
            <Label htmlFor="contract-manual-flag" className="text-sm font-medium text-gray-900">
              Zakázka je zesmluvněná
            </Label>
            <p className="mt-0.5 text-xs text-gray-600">
              Ano = zakázka se počítá mezi zesmluvněné (export, přehledy).
            </p>
          </div>
          <Switch
            id="contract-manual-flag"
            checked={isContracted}
            onCheckedChange={setIsContracted}
            disabled={!canEdit || saving}
            className="data-[state=checked]:bg-orange-600 shrink-0"
          />
        </div>

        <div className={gridClass}>
          <div className="space-y-1.5">
            <Label htmlFor="contract-manual-date">Datum zesmluvnění</Label>
            {canEdit ? (
              <>
                <Input
                  id="contract-manual-date"
                  type="date"
                  className={cn(fieldClass, belowLg && "min-h-[44px]")}
                  value={contractedAtIso}
                  onChange={(e) => {
                    const iso = e.target.value;
                    setContractedAtIso(iso);
                    setContractedAtText(iso ? formatContractManualDateLabel(iso) : "");
                  }}
                  disabled={saving}
                />
                <Input
                  id="contract-manual-date-text"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className={fieldClass}
                  value={contractedAtText}
                  onChange={(e) => setContractedAtText(e.target.value)}
                  onBlur={handleContractedAtTextBlur}
                  disabled={saving}
                  placeholder="dd.mm.yyyy"
                  aria-label="Datum zesmluvnění ve formátu dd.mm.yyyy"
                />
                <p className="text-xs text-gray-600">
                  Datum podpisu smlouvy (nezávislé na datu vytvoření zakázky). Formát v
                  exportu: dd.mm.yyyy.
                </p>
              </>
            ) : (
              <p className="text-sm font-medium text-gray-900 tabular-nums">
                {contractedAtIso
                  ? formatContractManualDateLabel(contractedAtIso)
                  : "—"}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract-manual-number">Číslo smlouvy / SOD</Label>
            <Input
              id="contract-manual-number"
              className={fieldClass}
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="např. SOD-2025-0042"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract-manual-total">Celková cena zakázky (Kč s DPH)</Label>
            <Input
              id="contract-manual-total"
              inputMode="decimal"
              className={fieldClass}
              value={totalPriceInput}
              onChange={(e) => setTotalPriceInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder={
                defaultTotalPriceGross != null
                  ? String(Math.round(defaultTotalPriceGross))
                  : "0"
              }
            />
            {defaultTotalPriceGross != null && !totalPriceInput.trim() ? (
              <p className="text-xs text-gray-600">
                Z rozpočtu zakázky: {formatMoneyKc(defaultTotalPriceGross)}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract-manual-required">Požadovaná záloha (Kč s DPH)</Label>
            <Input
              id="contract-manual-required"
              inputMode="decimal"
              className={fieldClass}
              value={requiredDepositInput}
              onChange={(e) => setRequiredDepositInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="contract-manual-paid">Ručně zadaná zaplacená záloha (Kč s DPH)</Label>
            <Input
              id="contract-manual-paid"
              inputMode="decimal"
              className={fieldClass}
              value={paidDepositInput}
              onChange={(e) => setPaidDepositInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="0"
            />
            <p className="text-xs text-gray-600">
              Použije se jen pokud nemáte zadané ruční platby zálohy níže.
            </p>
          </div>

          <div className="space-y-3 sm:col-span-2 rounded-lg border border-orange-200/90 bg-white/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">Ruční platby zálohy</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Pro starší smlouvy mimo portál — datum, částka a poznámka ke každé platbě.
                </p>
              </div>
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  disabled={saving}
                  onClick={addManualPaymentRow}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Přidat platbu
                </Button>
              ) : null}
            </div>

            {manualPaymentRows.length === 0 ? (
              <p className="text-xs text-gray-600">
                {canEdit
                  ? "Zatím žádná ruční platba. Klikněte na „Přidat platbu“."
                  : "Žádné ruční platby zálohy."}
              </p>
            ) : (
              <div className="space-y-3">
                {manualPaymentRows.map((row, index) => (
                  <div
                    key={row.id}
                    className="rounded-md border border-gray-200 bg-gray-50/80 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700">
                        Platba {index + 1}
                      </span>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          disabled={saving}
                          onClick={() => removeManualPaymentRow(row.id)}
                          aria-label="Smazat platbu"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className={gridClass}>
                      <div className="space-y-1.5">
                        <Label htmlFor={`manual-pay-date-${row.id}`}>Datum platby</Label>
                        {canEdit ? (
                          <>
                            <Input
                              id={`manual-pay-date-${row.id}`}
                              type="date"
                              className={cn(fieldClass, belowLg && "min-h-[44px]")}
                              value={row.paidAtIso}
                              disabled={saving}
                              onChange={(e) => {
                                const iso = e.target.value;
                                updateManualPaymentRow(row.id, {
                                  paidAtIso: iso,
                                  paidAtText: iso
                                    ? formatContractManualDateLabel(iso)
                                    : "",
                                });
                              }}
                            />
                            <Input
                              type="text"
                              inputMode="numeric"
                              className={fieldClass}
                              value={row.paidAtText}
                              disabled={saving}
                              placeholder="dd.mm.yyyy"
                              onChange={(e) =>
                                updateManualPaymentRow(row.id, {
                                  paidAtText: e.target.value,
                                })
                              }
                              onBlur={() => handleManualPaymentDateBlur(row.id)}
                            />
                          </>
                        ) : (
                          <p className="text-sm font-medium tabular-nums">
                            {row.paidAtIso
                              ? formatContractManualDateLabel(row.paidAtIso)
                              : "—"}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`manual-pay-amount-${row.id}`}>Částka (Kč s DPH)</Label>
                        <Input
                          id={`manual-pay-amount-${row.id}`}
                          inputMode="decimal"
                          className={fieldClass}
                          value={row.amountInput}
                          disabled={!canEdit || saving}
                          onChange={(e) =>
                            updateManualPaymentRow(row.id, {
                              amountInput: e.target.value,
                            })
                          }
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor={`manual-pay-note-${row.id}`}>Poznámka</Label>
                        <Input
                          id={`manual-pay-note-${row.id}`}
                          className={fieldClass}
                          value={row.note}
                          disabled={!canEdit || saving}
                          onChange={(e) =>
                            updateManualPaymentRow(row.id, { note: e.target.value })
                          }
                          placeholder="Volitelně…"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="contract-manual-note">Poznámka k záloze</Label>
            <Textarea
              id="contract-manual-note"
              className={cn(fieldClass, "min-h-[72px]")}
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Volitelná poznámka…"
            />
          </div>
        </div>

        {!canEdit ? (
          <p className="text-xs text-gray-600 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            Údaje může upravovat pouze administrátor organizace. Máte režim pouze pro čtení.
          </p>
        ) : null}

        {paymentPreview ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2 text-sm text-gray-900 space-y-1">
            <p className="font-medium text-gray-900">Souhrn (stejná logika jako export PDF)</p>
            <p>
              Cena zakázky: <strong>{formatMoneyKc(paymentPreview.totalPriceGross)}</strong>
            </p>
            <p>
              Požadovaná záloha:{" "}
              <strong>{formatMoneyKc(paymentPreview.requiredDepositGross)}</strong>
            </p>
            <p>
              Ručně zadaná zaplacená:{" "}
              <strong>{formatMoneyKc(paymentPreview.manualDepositGross)}</strong>
            </p>
            <p>
              Z plateb: <strong>{formatMoneyKc(paymentPreview.paymentsDepositGross)}</strong>
            </p>
            <p>
              Celkem zaplaceno: <strong>{formatMoneyKc(paymentPreview.totalPaidGross)}</strong>
            </p>
            <p>
              Zbývá doplatit: <strong>{formatMoneyKc(paymentPreview.remainingToPayGross)}</strong>
            </p>
            <p>
              Stav zálohy: <strong>{paymentStatusLabelCs(paymentPreview.depositStatus)}</strong>
              {" · "}
              Stav zakázky: <strong>{paymentStatusLabelCs(paymentPreview.jobPaymentStatus)}</strong>
            </p>
          </div>
        ) : null}

        {canEdit ? (
          <Button
            type="button"
            className={cn(
              "w-full sm:w-auto gap-2 bg-orange-600 hover:bg-orange-700 text-white border-0 shadow-md shadow-orange-600/20",
              belowLg && "min-h-[44px]"
            )}
            disabled={saving || !jobRef}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uložit smlouvu a zálohu
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
