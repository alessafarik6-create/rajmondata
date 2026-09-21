"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  addDays,
} from "date-fns";
import { cs } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { useCompanyScheduleMonthEvents } from "@/hooks/use-company-schedule-month-events";
import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import type { DashboardTaskItem } from "@/lib/dashboard-task-items-merge";
import {
  buildDashboardCalendarEvents,
  countOverdueBeforeToday,
  filterDashboardCalendarEvents,
  filterScheduleEventsForDashboardViewer,
  kindDotClass,
  type DashboardCalendarEvent,
  type DashboardCalendarFilter,
} from "@/lib/dashboard-calendar-events";

type JobRow = { id: string; name?: string; status?: string; endDate?: string };

export type DashboardCompactCalendarProps = {
  companyId: string;
  todayIso: string;
  jobs: JobRow[];
  tasks: DashboardTaskItem[];
  canMeetings: boolean;
  canJobs: boolean;
  canTasks: boolean;
  restrictEmployeeEvents: boolean;
  viewerUid: string;
  viewerEmployeeId: string;
  /** Vedení / účetní — může plánovat schůzky a montáže */
  canPlanEvents?: boolean;
};

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

function relativeDayLabel(dayKey: string, todayIso: string): string {
  if (dayKey === todayIso) return "Dnes";
  const tomorrow = format(addDays(parseLocalIso(todayIso), 1), "yyyy-MM-dd");
  if (dayKey === tomorrow) return "Zítra";
  return format(parseLocalIso(dayKey), "d. M.", { locale: cs });
}

function parseLocalIso(iso: string): Date {
  return startOfDay(parseISOSafe(iso));
}

function parseISOSafe(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function DashboardCompactCalendar(props: DashboardCompactCalendarProps) {
  const router = useRouter();
  const portalPerm = usePortalPermissionsOptional();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [filter, setFilter] = useState<DashboardCalendarFilter>("all");
  const [dayDialogKey, setDayDialogKey] = useState<string | null>(null);

  const monthNext = addMonths(visibleMonth, 1);
  const { events: raw0, loading: l0 } = useCompanyScheduleMonthEvents(
    props.companyId,
    visibleMonth
  );
  const { events: raw1, loading: l1 } = useCompanyScheduleMonthEvents(
    props.companyId,
    monthNext
  );

  const scheduleFiltered = useMemo(() => {
    const merged = [...raw0, ...raw1];
    if (!props.canMeetings) return [];
    return filterScheduleEventsForDashboardViewer(merged, {
      restrictEmployeeEvents: props.restrictEmployeeEvents,
      viewerUid: props.viewerUid,
      viewerEmployeeId: props.viewerEmployeeId,
      isManagement: !props.restrictEmployeeEvents,
      calendarAccess: portalPerm?.calendar,
    });
  }, [
    raw0,
    raw1,
    props.canMeetings,
    props.restrictEmployeeEvents,
    props.viewerUid,
    props.viewerEmployeeId,
    portalPerm?.calendar,
  ]);

  const rangeStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
  const rangeEnd = endOfWeek(addMonths(startOfMonth(visibleMonth), 1), { weekStartsOn: 1 });

  const allEvents = useMemo(
    () =>
      buildDashboardCalendarEvents({
        scheduleEvents: scheduleFiltered,
        tasks: props.canTasks ? props.tasks : [],
        jobs: props.canJobs ? props.jobs : [],
        todayIso: props.todayIso,
        rangeStart,
        rangeEnd,
        includeMeetings: props.canMeetings,
        includeTasks: props.canTasks,
        includeJobs: props.canJobs,
      }),
    [
      scheduleFiltered,
      props.tasks,
      props.jobs,
      props.todayIso,
      rangeStart,
      rangeEnd,
      props.canMeetings,
      props.canTasks,
      props.canJobs,
    ]
  );

  const filtered = useMemo(
    () => filterDashboardCalendarEvents(allEvents, filter),
    [allEvents, filter]
  );

  const byDay = useMemo(() => {
    const m = new Map<string, DashboardCalendarEvent[]>();
    for (const ev of filtered) {
      if (ev.dayKey < props.todayIso) continue;
      const arr = m.get(ev.dayKey) ?? [];
      arr.push(ev);
      m.set(ev.dayKey, arr);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    return m;
  }, [filtered, props.todayIso]);

  const gridDays = useMemo(
    () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd]
  );

  const upcoming = useMemo(() => {
    const horizon = format(addDays(parseLocalIso(props.todayIso), 35), "yyyy-MM-dd");
    return filtered
      .filter((e) => e.dayKey >= props.todayIso && e.dayKey <= horizon)
      .slice(0, 5);
  }, [filtered, props.todayIso]);

  const overdueCount = useMemo(
    () =>
      countOverdueBeforeToday(
        props.canTasks ? props.tasks : [],
        props.canJobs ? props.jobs : [],
        props.todayIso
      ),
    [props.tasks, props.jobs, props.todayIso, props.canTasks, props.canJobs]
  );

  const loading = l0 || l1;
  const dayDialogEvents = dayDialogKey ? byDay.get(dayDialogKey) ?? [] : [];

  return (
    <article
      className={cn(
        "flex min-h-[320px] flex-col rounded-xl border border-border/80 bg-card shadow-sm",
        "border-l-[3px] border-l-indigo-500"
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          <CalendarDays className="h-4 w-4 text-indigo-600" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold capitalize text-foreground">
            {format(visibleMonth, "LLLL yyyy", { locale: cs })}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Předchozí měsíc"
            onClick={() => setVisibleMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setVisibleMonth(startOfMonth(new Date()))}
          >
            Dnes
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Další měsíc"
            onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as DashboardCalendarFilter)}>
          <SelectTrigger className="h-8 w-[108px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vše</SelectItem>
            <SelectItem value="meetings">Schůzky</SelectItem>
            <SelectItem value="jobs">Zakázky</SelectItem>
            <SelectItem value="tasks">Úkoly</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:flex-row sm:p-3">
        <div className="min-w-0 flex-1">
          {overdueCount > 0 ? (
            <p className="mb-2 text-[11px] font-medium text-red-700">
              Po termínu: {overdueCount}
            </p>
          ) : null}
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          {loading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Načítání kalendáře…</p>
          ) : (
            <div className="grid grid-cols-7 gap-0.5">
              {gridDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const inMonth = isSameMonth(day, visibleMonth);
                const today = isToday(day);
                const dayEvents = byDay.get(key) ?? [];
                const showEvents = key >= props.todayIso;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDayDialogKey(key)}
                    className={cn(
                      "min-h-[52px] rounded-md border border-transparent p-0.5 text-left sm:min-h-[58px]",
                      "hover:border-border/80 hover:bg-muted/30",
                      !inMonth && "opacity-40",
                      today && "ring-1 ring-orange-400/80 bg-orange-50/50 dark:bg-orange-950/20"
                    )}
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center text-[11px] tabular-nums",
                          today &&
                            "rounded-full bg-orange-500 font-semibold text-white"
                        )}
                      >
                        {format(day, "d")}
                      </span>
                    </div>
                    {showEvents ? (
                      <ul className="mt-0.5 space-y-0.5 px-0.5">
                        {dayEvents.slice(0, 2).map((ev) => (
                          <li key={ev.id}>
                            <Link
                              href={ev.href}
                              onClick={(e) => e.stopPropagation()}
                              title={[ev.tooltipTitle, ...ev.tooltipLines].join("\n")}
                              className="flex items-center gap-0.5 truncate rounded px-0.5 text-[9px] leading-tight hover:bg-muted/50 sm:text-[10px]"
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  kindDotClass(ev.kind, ev.overdue)
                                )}
                              />
                              <span className="truncate">
                                {ev.timeLabel !== "—" ? `${ev.timeLabel} ` : ""}
                                {ev.shortTitle}
                              </span>
                            </Link>
                          </li>
                        ))}
                        {dayEvents.length > 2 ? (
                          <li className="text-[9px] text-muted-foreground pl-2">
                            +{dayEvents.length - 2} další
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Schůzka
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Montáž
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Úkol
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Termín zakázky
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> Připomínka
            </span>
          </div>
        </div>

        <aside className="w-full shrink-0 border-t border-border/60 pt-2 sm:w-[140px] sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Nadcházející
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {upcoming.length === 0 ? (
              <li className="text-[11px] text-muted-foreground">Žádné události</li>
            ) : (
              upcoming.map((ev) => (
                <li key={ev.id}>
                  <Link
                    href={ev.href}
                    className="block text-[11px] leading-snug hover:text-primary"
                    title={ev.tooltipTitle}
                  >
                    <span className="font-medium text-foreground">
                      {relativeDayLabel(ev.dayKey, props.todayIso)}
                    </span>
                    <br />
                    <span className="text-muted-foreground">
                      {ev.timeLabel !== "—" ? `${ev.timeLabel} · ` : ""}
                      {ev.shortTitle}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </aside>
      </div>

      <footer className="border-t border-border/60 px-3 py-2">
        <Link
          href="/portal/schedule"
          className="text-xs font-medium text-primary hover:underline"
        >
          Otevřít celý kalendář →
        </Link>
      </footer>

      <Dialog open={!!dayDialogKey} onOpenChange={(o) => !o && setDayDialogKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dayDialogKey
                ? format(parseLocalIso(dayDialogKey), "d. MMMM yyyy", { locale: cs })
                : ""}
            </DialogTitle>
          </DialogHeader>
          {props.canPlanEvents && dayDialogKey ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                size="sm"
                className="gap-1"
                onClick={() => {
                  setDayDialogKey(null);
                  router.push(
                    `/portal/schedule?day=${encodeURIComponent(dayDialogKey)}&create=lead_meeting`
                  );
                }}
              >
                + Naplánovat schůzku
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1"
                onClick={() => {
                  setDayDialogKey(null);
                  router.push(
                    `/portal/schedule?day=${encodeURIComponent(dayDialogKey)}&create=installation`
                  );
                }}
              >
                + Naplánovat montáž
              </Button>
            </div>
          ) : null}
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
            {dayDialogEvents.length === 0 ? (
              <li className="text-muted-foreground">Žádné události v tento den.</li>
            ) : (
              dayDialogEvents.map((ev) => (
                <li key={ev.id}>
                  <Link
                    href={ev.href}
                    className="block rounded-md border border-border/60 px-2 py-1.5 hover:bg-muted/40"
                    onClick={() => setDayDialogKey(null)}
                  >
                    <span className="font-medium">
                      {ev.timeLabel !== "—" ? `${ev.timeLabel} – ` : ""}
                      {ev.title}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" asChild>
              <Link
                href={
                  dayDialogKey
                    ? `/portal/schedule?day=${encodeURIComponent(dayDialogKey)}`
                    : "/portal/schedule"
                }
                onClick={() => setDayDialogKey(null)}
              >
                Otevřít celý kalendář
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
