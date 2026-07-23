"use client";

import React from "react";
import {
  AlertCircle,
  CalendarOff,
  CheckCircle2,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JOB_LIST_SORT_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
  type JobDeadlineFilterKey,
  type JobListSortKey,
  type JobStatusFilterKey,
} from "@/lib/job-status";
import type { JobListSummary } from "@/lib/job-list-filters";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { Label } from "@/components/ui/label";

type JobsListControlsProps = {
  summary: JobListSummary;
  statusFilter: JobStatusFilterKey;
  sortKey: JobListSortKey;
  deadlineFilter: JobDeadlineFilterKey | null;
  statusCounts: Record<JobStatusFilterKey, number>;
  onStatusFilterChange: (key: JobStatusFilterKey) => void;
  onSortChange: (key: JobListSortKey) => void;
  onSummaryClick: (opts: {
    status: JobStatusFilterKey;
    deadline: JobDeadlineFilterKey | null;
  }) => void;
  dark?: boolean;
};

function SummaryCard({
  label,
  count,
  icon: Icon,
  active,
  onClick,
  dark,
  accentClass,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  active?: boolean;
  onClick: () => void;
  dark?: boolean;
  accentClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-lg border px-3 py-2.5 text-left transition-colors",
        dark
          ? cn(
              "border-white/10 bg-slate-900/80 hover:bg-slate-800/90",
              active && "border-orange-500/60 ring-1 ring-orange-500/40"
            )
          : cn(
              "border-slate-200 bg-white hover:bg-slate-50",
              active && "border-primary/40 ring-1 ring-primary/20 bg-primary/5"
            )
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide opacity-80">
        <Icon
          className={cn("h-3.5 w-3.5 shrink-0", accentClass)}
          aria-hidden
        />
        {label}
      </span>
      <span
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums leading-none",
          dark ? "text-white" : "text-slate-900"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function StatusFilterChip({
  label,
  count,
  active,
  onClick,
  dark,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        dark
          ? active
            ? "border-orange-500/70 bg-orange-500/20 text-orange-100 ring-1 ring-orange-500/40"
            : "border-white/15 bg-slate-900/70 text-slate-200 hover:border-white/30 hover:bg-slate-800"
          : active
            ? "border-primary bg-primary text-primary-foreground shadow-sm"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
          dark
            ? active
              ? "bg-orange-950/40 text-orange-100"
              : "bg-slate-950/60 text-slate-300"
            : active
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-slate-100 text-slate-600"
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function JobsListControls({
  summary,
  statusFilter,
  sortKey,
  deadlineFilter,
  statusCounts,
  onStatusFilterChange,
  onSortChange,
  onSummaryClick,
  dark = false,
}: JobsListControlsProps) {
  const summaryActive = {
    active:
      statusFilter === "active" &&
      !deadlineFilter,
    overdue:
      statusFilter === "active" && deadlineFilter === "overdue",
    completedMonth:
      statusFilter === "completed" && deadlineFilter === "completed_month",
    noDeadline:
      statusFilter === "active" && deadlineFilter === "none",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard
          label="Aktivní zakázky"
          count={summary.activeCount}
          icon={Briefcase}
          active={summaryActive.active}
          dark={dark}
          accentClass={dark ? "text-orange-400" : "text-primary"}
          onClick={() =>
            onSummaryClick({ status: "active", deadline: null })
          }
        />
        <SummaryCard
          label="Po termínu"
          count={summary.overdueCount}
          icon={AlertCircle}
          active={summaryActive.overdue}
          dark={dark}
          accentClass="text-destructive"
          onClick={() =>
            onSummaryClick({ status: "active", deadline: "overdue" })
          }
        />
        <SummaryCard
          label="Dokončené tento měsíc"
          count={summary.completedThisMonthCount}
          icon={CheckCircle2}
          active={summaryActive.completedMonth}
          dark={dark}
          accentClass="text-emerald-500"
          onClick={() =>
            onSummaryClick({
              status: "completed",
              deadline: "completed_month",
            })
          }
        />
        <SummaryCard
          label="Bez termínu"
          count={summary.noDeadlineCount}
          icon={CalendarOff}
          active={summaryActive.noDeadline}
          dark={dark}
          accentClass={dark ? "text-slate-300" : "text-slate-500"}
          onClick={() =>
            onSummaryClick({ status: "active", deadline: "none" })
          }
        />
      </div>

      <div className="space-y-2">
        <Label
          className={cn(
            "text-xs",
            dark ? "text-slate-300" : "text-slate-800"
          )}
        >
          Stav zakázky
        </Label>
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {JOB_STATUS_FILTER_OPTIONS.map((opt) => (
            <StatusFilterChip
              key={opt.key}
              label={opt.label}
              count={statusCounts[opt.key] ?? 0}
              active={statusFilter === opt.key && !deadlineFilter}
              dark={dark}
              onClick={() => onStatusFilterChange(opt.key)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label
          htmlFor="jobs-sort"
          className={cn(
            "text-xs",
            dark ? "text-slate-300" : "text-slate-800"
          )}
        >
          Řazení
        </Label>
        <select
          id="jobs-sort"
          aria-label="Řazení zakázek"
          className={cn(
            NATIVE_SELECT_CLASS,
            dark &&
              "border-white/35 !bg-slate-950 !text-white [color-scheme:dark]"
          )}
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as JobListSortKey)}
        >
          {JOB_LIST_SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
