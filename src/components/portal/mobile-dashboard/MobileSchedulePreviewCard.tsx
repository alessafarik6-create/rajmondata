"use client";

import React, { useMemo } from "react";
import { format, startOfMonth } from "date-fns";
import { cs } from "date-fns/locale";
import { CalendarDays, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useCompanyScheduleMonthEvents } from "@/hooks/use-company-schedule-month-events";
import { isValidCompanyScheduleEvent } from "@/lib/company-schedule-events";

export function MobileSchedulePreviewCard(props: {
  companyId: string;
  onOpenCalendar: () => void;
}) {
  const monthAnchor = useMemo(() => startOfMonth(new Date()), []);
  const { events, loading } = useCompanyScheduleMonthEvents(props.companyId, monthAnchor);

  const nowMs = Date.now();
  const upcoming = useMemo(() => {
    const list = events.filter(
      (e) => isValidCompanyScheduleEvent(e) && e.at.getTime() >= nowMs - 120_000
    );
    return list.slice(0, 2);
  }, [events, nowMs]);

  const total = events.filter(isValidCompanyScheduleEvent).length;

  return (
    <button
      type="button"
      onClick={props.onOpenCalendar}
      className={cn(
        "w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur",
        "transition-colors hover:border-orange-500/35 hover:bg-white/[0.09] active:scale-[0.99]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 ring-1 ring-orange-500/30">
            <CalendarDays className="h-5 w-5 text-orange-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-white">Schůzky a zaměření</p>
            <p className="text-xs capitalize text-slate-400">
              {format(new Date(), "EEEE d. MMMM yyyy", { locale: cs })}
            </p>
          </div>
        </div>
        {total > 0 ? (
          <Badge className="shrink-0 border-orange-500/40 bg-orange-500/20 text-[11px] font-bold text-orange-200">
            {total > 99 ? "99+" : total}
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
        {loading ? (
          <p className="text-sm text-slate-400">Načítání…</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-slate-400">Žádné nadcházející akce v tomto měsíci.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((ev) => (
              <li
                key={ev.id}
                className="truncate text-sm text-slate-200"
                title={`${format(ev.at, "HH:mm")} — ${ev.headline}`}
              >
                <span className="font-semibold tabular-nums text-orange-200">
                  {format(ev.at, "HH:mm")}
                </span>{" "}
                <span className="text-slate-100">{ev.headline}</span>
                <span className="text-slate-500"> · {ev.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-orange-300">Otevřít kalendář</span>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-orange-300">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </span>
      </div>
      <span className="sr-only">Otevřít plný kalendář schůzek a zaměření</span>
    </button>
  );
}
