"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CalendarDays, PieChart, ArrowRight, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function DashboardSummaryCards(props: {
  companyLabel: string;
  todayLabel: string;
  /** Např. "125 340 Kč" */
  todayCostsLabel?: string;
  /** Např. "150 000 Kč" */
  planLabel?: string;
  /** 0–100 */
  planPct?: number;
  overduePlatformInvoices?: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(props.planPct) || 0)));
  const overdue = Number(props.overduePlatformInvoices) || 0;

  return (
    <section aria-label="Souhrn" className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
      <div
        className={cn(
          "rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Náklady dnes</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">
              {props.todayCostsLabel || "—"}
            </p>
            <p className="mt-1 text-xs text-slate-400">{props.todayLabel}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-orange-500/20 to-transparent">
            <PieChart className="h-5 w-5 text-orange-300" />
          </div>
        </div>

        {props.planLabel ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Plán: {props.planLabel}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}

        {overdue > 0 ? (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-300" />
              <span className="text-xs font-medium text-rose-100">Neuhrazené faktury</span>
            </div>
            <Badge className="bg-rose-500 text-white">{overdue}</Badge>
          </div>
        ) : null}
      </div>

      <Link
        href="/portal/meeting-records"
        className={cn(
          "rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur",
          "active:scale-[0.99] transition-transform"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Kalendář</p>
            <p className="mt-1 text-base font-semibold text-white">{props.companyLabel}</p>
            <p className="mt-1 text-xs text-slate-400">Dnešní události a plánování</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-orange-500/20 to-transparent">
            <CalendarDays className="h-5 w-5 text-orange-300" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 text-xs font-semibold text-orange-300">
          Otevřít <ArrowRight className="h-4 w-4" />
        </div>
      </Link>
    </section>
  );
}

