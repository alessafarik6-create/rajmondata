"use client";

import React, { useCallback, useEffect, useState } from "react";
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
import { FileText, Loader2 } from "lucide-react";
import { JD } from "@/lib/job-detail-page-styles";
import { useIsBelowLg } from "@/hooks/use-mobile";
import {
  formatMoneyInputDisplay,
  formatContractManualDateLabel,
  JOB_CONTRACT_MANUAL_FIELD,
  parseJobContractManual,
  parseMoneyInput,
  serializeJobContractManualForFirestore,
  type JobContractManualData,
} from "@/lib/job-contract-manual";
import { formatMoneyKc } from "@/lib/contracted-jobs-export";

type Props = {
  jobRef: DocumentReference | null;
  job: Record<string, unknown> | null | undefined;
  /** Pouze vlastník / admin organizace */
  canEdit: boolean;
  /** Zaměstnanec s přístupem — jen náhled */
  canView: boolean;
  /** Výchozí celková cena z rozpočtu zakázky (Kč s DPH) */
  defaultTotalPriceGross?: number | null;
};

function manualFingerprint(job: unknown): string {
  const m = parseJobContractManual(job);
  return JSON.stringify(m);
}

export function JobContractDepositSection({
  jobRef,
  job,
  canEdit,
  canView,
  defaultTotalPriceGross,
}: Props) {
  const belowLg = useIsBelowLg();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [isContracted, setIsContracted] = useState(false);
  const [contractedAt, setContractedAt] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [totalPriceInput, setTotalPriceInput] = useState("");
  const [requiredDepositInput, setRequiredDepositInput] = useState("");
  const [paidDepositInput, setPaidDepositInput] = useState("");
  const [depositNote, setDepositNote] = useState("");

  const fp = manualFingerprint(job);

  useEffect(() => {
    const m = parseJobContractManual(job);
    setIsContracted(m.isContracted === true);
    setContractedAt(m.contractedAt ?? "");
    setContractNumber(m.contractNumber ?? "");
    setTotalPriceInput(
      formatMoneyInputDisplay(
        m.totalPriceGross ??
          (defaultTotalPriceGross != null ? defaultTotalPriceGross : null)
      )
    );
    setRequiredDepositInput(formatMoneyInputDisplay(m.requiredDepositGross));
    setPaidDepositInput(formatMoneyInputDisplay(m.paidDepositGross));
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

  const handleSave = () => {
    void persist({
      isContracted,
      contractedAt: contractedAt.trim() || null,
      contractNumber: contractNumber.trim() || null,
      totalPriceGross: parseMoneyInput(totalPriceInput),
      requiredDepositGross: parseMoneyInput(requiredDepositInput),
      paidDepositGross: parseMoneyInput(paidDepositInput),
      depositNote: depositNote.trim() || null,
    });
  };

  if (!canView) return null;

  const fieldClass = cn("w-full min-w-0", belowLg && "text-base");
  const gridClass = cn(
    "grid gap-4",
    belowLg ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
  );

  const previewManual = parseMoneyInput(paidDepositInput);
  const previewRequired = parseMoneyInput(requiredDepositInput);

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
            <Input
              id="contract-manual-date"
              type="date"
              className={fieldClass}
              value={contractedAt}
              onChange={(e) => setContractedAt(e.target.value)}
              disabled={!canEdit || saving}
            />
            {contractedAt ? (
              <p className="text-xs text-gray-600">
                {formatContractManualDateLabel(contractedAt)}
              </p>
            ) : null}
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
              Lze zadat i bez zálohové faktury v portálu. Do exportu se přičte k platbám z
              dokladů (bez dvojího započtení stejné částky).
            </p>
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

        {(previewManual != null && previewManual > 0) ||
        (previewRequired != null && previewRequired > 0) ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 space-y-1">
            {previewRequired != null && previewRequired > 0 ? (
              <p>
                Požadovaná záloha: <strong>{formatMoneyKc(previewRequired)}</strong>
              </p>
            ) : null}
            {previewManual != null && previewManual > 0 ? (
              <p>
                Ručně zadaná zaplacená záloha: <strong>{formatMoneyKc(previewManual)}</strong>
              </p>
            ) : null}
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
