"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MoneyPeriodPreset } from "@/lib/employee-money-period";
import {
  formatMoneyPeriodCaption,
  MONEY_PERIOD_PRESET_LABEL,
} from "@/lib/employee-money-period";
import type { PeriodRange } from "@/lib/attendance-overview-compute";
import { formatKc } from "@/lib/employee-money";

export function EmployeeMoneyPeriodPicker(props: {
  preset: MoneyPeriodPreset;
  onPresetChange: (p: MoneyPeriodPreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  range: PeriodRange;
  className?: string;
}) {
  const caption = formatMoneyPeriodCaption(props.range);
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white px-3 py-2.5 space-y-2",
        props.className
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-700">Období přehledu</p>
          <p className="text-[11px] text-slate-500">{caption}</p>
        </div>
        <Select
          value={props.preset}
          onValueChange={(v) => props.onPresetChange(v as MoneyPeriodPreset)}
        >
          <SelectTrigger className="h-9 w-full sm:w-[180px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MONEY_PERIOD_PRESET_LABEL) as MoneyPeriodPreset[]).map((k) => (
              <SelectItem key={k} value={k}>
                {MONEY_PERIOD_PRESET_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {props.preset === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Od</Label>
            <Input
              type="date"
              value={props.customFrom}
              onChange={(e) => props.onCustomFromChange(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Do</Label>
            <Input
              type="date"
              value={props.customTo}
              onChange={(e) => props.onCustomToChange(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EmployeeMoneySummaryCard(props: {
  title: string;
  value: React.ReactNode;
  periodLabel?: string;
  allTimeHint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5",
        props.className
      )}
    >
      <p className="text-xs font-semibold text-slate-700">{props.title}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{props.value}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-600">
        {props.allTimeHint ? (
          <span className="font-medium text-slate-700">{props.allTimeHint}</span>
        ) : props.periodLabel ? (
          <>Období: {props.periodLabel}</>
        ) : null}
      </p>
    </div>
  );
}

export function EmployeeMoneyExpandableBlock(props: {
  title: string;
  collapsedSummary: React.ReactNode;
  expandLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={props.className}>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full min-h-[44px] items-start gap-2 px-3 py-2.5 text-left sm:px-4 sm:py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{props.title}</span>
              {!open ? (
                <span className="mt-1 block text-xs text-slate-600">{props.collapsedSummary}</span>
              ) : null}
            </span>
            <ChevronDown
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0 text-orange-600 transition-transform",
                open && "rotate-180"
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        {!open ? (
          <div className="border-t border-slate-100 px-3 pb-2 sm:px-4">
            <span className="text-xs font-medium text-orange-700">
              {props.expandLabel ?? "Zobrazit detail"}
            </span>
          </div>
        ) : null}
        <CollapsibleContent className="border-t border-slate-200 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
          {props.children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function formatAdvancePeriodSummary(totalKc: number, count: number): React.ReactNode {
  return (
    <>
      Celková částka: <strong className="tabular-nums">{formatKc(totalKc)}</strong>
      {" · "}
      Počet záznamů: <strong>{count}</strong>
    </>
  );
}
