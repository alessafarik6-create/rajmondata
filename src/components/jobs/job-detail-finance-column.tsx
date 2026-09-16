"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";
import type { WorkBudgetSummary } from "@/lib/work-budget-types";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

function KpiBlock(props: {
  label: string;
  net: number | null;
  gross?: number | null;
  compact?: boolean;
}) {
  const { label, net, gross, compact } = props;
  const showGross = gross != null && gross !== net;
  return (
    <div className={cn(JD.financeDashBlock, "min-w-0", compact && "py-1.5 max-md:px-2 max-md:py-1.5")}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{label}</p>
      {net != null ? (
        <p className="mt-0.5 break-words text-sm font-bold tabular-nums text-gray-950 max-md:text-[13px]">
          {formatKc(net)}
        </p>
      ) : (
        <p className="mt-0.5 text-sm font-bold text-gray-400">—</p>
      )}
      {showGross ? (
        <p className="text-[11px] tabular-nums text-gray-700">{formatKc(gross!)} s DPH</p>
      ) : null}
    </div>
  );
}

export function JobDetailFinanceColumn(props: {
  summary: WorkBudgetSummary | null;
  itemCount: number;
  advancesTotalGross?: number;
  advancesForDeductionGross?: number;
  remainingToInvoiceGross?: number;
  onOpenBudget?: () => void;
  onOpenInvoices?: () => void;
  onOpenExpenses?: () => void;
  onOpenDeposits?: () => void;
  onOpenFinancial?: () => void;
}) {
  const {
    summary,
    itemCount,
    advancesTotalGross = 0,
    advancesForDeductionGross = 0,
    remainingToInvoiceGross,
    onOpenBudget,
    onOpenInvoices,
    onOpenExpenses,
    onOpenDeposits,
    onOpenFinancial,
  } = props;

  const hasSummary =
    summary &&
    (summary.totalGross > 0 ||
      summary.contractBaseGross > 0 ||
      summary.doneGross > 0 ||
      itemCount > 0);

  const remainingInv =
    remainingToInvoiceGross ??
    (summary
      ? Math.max(0, summary.totalGross - advancesForDeductionGross)
      : null);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className={JD.columnLabel}>Finance</p>
      <div className={cn(JD.financeSection, "space-y-2 p-3 sm:p-3.5")}>
        {hasSummary ? (
          <div className="grid min-w-0 grid-cols-2 gap-1.5 max-[380px]:grid-cols-1 md:grid-cols-1">
            <KpiBlock
              label="Původní rozpočet"
              net={summary!.contractBaseNet}
              gross={summary!.contractBaseGross}
              compact
            />
            {summary!.extraWorkApprovedNet > 0 || summary!.extraWorkApprovedGross > 0 ? (
              <KpiBlock
                label="Vícepráce"
                net={summary!.extraWorkApprovedNet}
                gross={summary!.extraWorkApprovedGross}
                compact
              />
            ) : null}
            <KpiBlock
              label="Aktuální cena"
              net={summary!.totalNet}
              gross={summary!.totalGross}
              compact
            />
            <KpiBlock
              label="Provedeno"
              net={summary!.doneNet}
              gross={summary!.doneGross}
              compact
            />
            {advancesTotalGross > 0 ? (
              <KpiBlock label="Zálohy" net={advancesTotalGross} compact />
            ) : null}
            {remainingInv != null ? (
              <KpiBlock label="Zbývá k fakturaci" net={remainingInv} compact />
            ) : (
              <KpiBlock
                label="Zbývá"
                net={summary!.remainingNet}
                gross={summary!.remainingGross}
                compact
              />
            )}
          </div>
        ) : (
          <p className="text-[13px] text-gray-700">Položkový rozpočet zatím není vyplněn.</p>
        )}
        <div className="flex flex-col gap-1 border-t border-orange-200/60 pt-2">
          <button
            type="button"
            className="text-left text-xs font-semibold text-primary hover:underline"
            onClick={onOpenBudget}
          >
            Položkový rozpočet{itemCount > 0 ? ` · ${itemCount} položek` : ""}
          </button>
          {onOpenInvoices ? (
            <button
              type="button"
              className="text-left text-xs font-semibold text-primary hover:underline"
              onClick={onOpenInvoices}
            >
              Faktury
            </button>
          ) : null}
          {onOpenExpenses ? (
            <button
              type="button"
              className="text-left text-xs font-semibold text-primary hover:underline"
              onClick={onOpenExpenses}
            >
              Náklady zakázky
            </button>
          ) : null}
          {onOpenDeposits ? (
            <button
              type="button"
              className="text-left text-xs font-semibold text-primary hover:underline"
              onClick={onOpenDeposits}
            >
              Zálohy / smlouva
            </button>
          ) : null}
          {onOpenFinancial ? (
            <button
              type="button"
              className="text-left text-xs font-semibold text-primary hover:underline"
              onClick={onOpenFinancial}
            >
              Finanční přehled
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
