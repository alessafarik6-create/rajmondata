"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { JD } from "@/lib/job-detail-page-styles";
import type { WorkBudgetSummary } from "@/lib/work-budget-types";

function formatKc(n: number): string {
  return `${n.toLocaleString("cs-CZ")} Kč`;
}

function KpiBlock(props: { label: string; net: number | null; gross: number | null }) {
  const { label, net, gross } = props;
  return (
    <div className={JD.financeDashBlock}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">{label}</p>
      {net != null ? (
        <p className="mt-1 text-base font-bold tabular-nums text-gray-950">{formatKc(net)}</p>
      ) : (
        <p className="mt-1 text-base font-bold text-gray-400">—</p>
      )}
      {gross != null ? (
        <p className="text-xs tabular-nums text-gray-700">{formatKc(gross)} s DPH</p>
      ) : null}
    </div>
  );
}

export function JobDetailFinanceColumn(props: {
  summary: WorkBudgetSummary | null;
  itemCount: number;
  onOpenBudget?: () => void;
  onOpenInvoices?: () => void;
  onOpenExpenses?: () => void;
  onOpenDeposits?: () => void;
  onOpenFinancial?: () => void;
}) {
  const {
    summary,
    itemCount,
    onOpenBudget,
    onOpenInvoices,
    onOpenExpenses,
    onOpenDeposits,
    onOpenFinancial,
  } = props;

  const hasSummary = summary && (summary.totalGross > 0 || summary.doneGross > 0 || itemCount > 0);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className={JD.columnLabel}>Finance</p>
      <div className={cn(JD.financeSection, "space-y-2.5 p-3.5 sm:p-4")}>
        {hasSummary ? (
          <div className="space-y-2">
            <KpiBlock label="Rozpočet" net={summary!.totalNet} gross={summary!.totalGross} />
            <KpiBlock label="Provedeno" net={summary!.doneNet} gross={summary!.doneGross} />
            <KpiBlock label="Zbývá" net={summary!.remainingNet} gross={summary!.remainingGross} />
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
