"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoneyKc } from "@/lib/job-payment-summary";
import type { LeadSummaryByStatusRow, LeadSummaryByTypeRow } from "@/lib/leads/lead-summary";

export type LeadsSummaryPanelData = {
  count: number;
  estimatedValue: number;
  averageValue: number | null;
  withoutValue: number;
  byType: LeadSummaryByTypeRow[];
  byStatus: LeadSummaryByStatusRow[];
};

type Props = {
  data: LeadsSummaryPanelData | null;
  loading?: boolean;
  activeTypeFilter?: string;
  onSelectType?: (type: string) => void;
  className?: string;
};

function KpiCard({
  value,
  label,
  className,
}: {
  value: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm min-w-0",
        className
      )}
    >
      <p className="text-lg sm:text-xl font-semibold tabular-nums text-slate-900 truncate">
        {value}
      </p>
      <p className="text-xs text-slate-600 mt-0.5">{label}</p>
    </div>
  );
}

export function LeadsSummaryPanel(props: Props) {
  const d = props.data;
  const loading = props.loading && !d;

  return (
    <div className={cn("space-y-4", props.className)}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {loading ? (
          <div className="col-span-full flex items-center justify-center gap-2 py-6 text-sm text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Počítám souhrn…
          </div>
        ) : d ? (
          <>
            <KpiCard value={d.count} label="Poptávek" />
            <KpiCard
              value={formatMoneyKc(d.estimatedValue)}
              label="Hodnota poptávek"
            />
            <KpiCard
              value={d.averageValue != null ? formatMoneyKc(d.averageValue) : "—"}
              label="Průměrná hodnota"
            />
            <KpiCard value={d.withoutValue} label="Bez hodnoty" />
          </>
        ) : null}
      </div>

      {d && d.byType.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-700">
            Podle typu poptávky
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {d.byType.map((row) => {
              const active = props.activeTypeFilter === row.type;
              return (
                <li key={row.type}>
                  <button
                    type="button"
                    className={cn(
                      "w-full text-left rounded-md border px-2.5 py-2 text-sm transition-colors min-h-[44px] sm:min-h-0",
                      active
                        ? "border-orange-400 bg-orange-50 text-orange-950"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    )}
                    onClick={() => props.onSelectType?.(row.type)}
                  >
                    <span className="font-medium block truncate">{row.type}</span>
                    <span className="text-xs text-slate-600 tabular-nums">
                      {row.count}{" "}
                      {row.count === 1 ? "poptávka" : row.count <= 4 ? "poptávky" : "poptávek"}
                      {row.value > 0 ? ` · ${formatMoneyKc(row.value)}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {d && d.byStatus.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-700 mb-2">
            Podle stavu
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-800">
            {d.byStatus.map((row) => (
              <span key={row.status} className="tabular-nums">
                <span className="font-medium">{row.label}</span>{" "}
                <span className="text-slate-600">{row.count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
