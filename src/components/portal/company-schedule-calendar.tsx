"use client";

import React, { useMemo, useState } from "react";
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  format,
  parseISO,
} from "date-fns";
import { cs } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  collection,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { useFirestore, useMemoFirebase, useCollection } from "@/firebase";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { parseFirestoreScheduledAt } from "@/lib/lead-meeting-utils";
import type { MeasurementDoc, MeasurementStatus } from "@/lib/measurements";
import { MEASUREMENT_STATUS_LABELS } from "@/lib/measurements";

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

type CalendarEvent = {
  id: string;
  at: Date;
  title: string;
  kind: "meeting" | "measurement";
  detail?: string;
};

function isValidCalendarEvent(e: unknown): e is CalendarEvent {
  if (e == null || typeof e !== "object") return false;
  const o = e as Partial<CalendarEvent>;
  if (typeof o.id !== "string" || !o.id) return false;
  return o.at instanceof Date && !Number.isNaN(o.at.getTime());
}

function isMeasurementDeleted(m: { deletedAt?: unknown }): boolean {
  return m.deletedAt != null;
}

function parseMeasurementTime(raw: string): Date | null {
  try {
    const d = parseISO(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function CompanyScheduleCalendar({
  companyId,
}: {
  companyId: string;
}) {
  const firestore = useFirestore();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));

  const monthStart = startOfMonth(visibleMonth);
  const monthEnd = endOfMonth(visibleMonth);

  const meetingsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "lead_meetings"),
      where("scheduledAt", ">=", Timestamp.fromDate(monthStart)),
      where("scheduledAt", "<=", Timestamp.fromDate(monthEnd)),
      orderBy("scheduledAt", "asc")
    );
  }, [firestore, companyId, monthStart.getTime(), monthEnd.getTime()]);

  const measurementsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const startIso = monthStart.toISOString();
    const endIso = monthEnd.toISOString();
    return query(
      collection(firestore, "companies", companyId, "measurements"),
      where("scheduledAt", ">=", startIso),
      where("scheduledAt", "<=", endIso),
      orderBy("scheduledAt", "asc")
    );
  }, [firestore, companyId, monthStart.getTime(), monthEnd.getTime()]);

  const { data: meetingsRaw = [], isLoading: meetingsLoading } =
    useCollection(meetingsQuery);
  const { data: measurementsRaw = [], isLoading: measurementsLoading } =
    useCollection(measurementsQuery);

  const events = useMemo(() => {
    const out: CalendarEvent[] = [];
    const list = Array.isArray(meetingsRaw) ? meetingsRaw : [];
    for (const raw of list as Record<string, unknown>[]) {
      const id = String(raw?.id ?? "");
      if (!id) continue;
      const at = parseFirestoreScheduledAt(raw.scheduledAt);
      if (!at) continue;
      const customerName = String(raw.customerName ?? "—");
      out.push({
        id: `m-${id}`,
        at,
        title: customerName,
        kind: "meeting",
        detail: "Schůzka",
      });
    }

    const mlist = Array.isArray(measurementsRaw) ? measurementsRaw : [];
    for (const raw of mlist as (MeasurementDoc & { id?: string })[]) {
      if (!raw?.id || isMeasurementDeleted(raw)) continue;
      const st = raw.status as MeasurementStatus | undefined;
      if (st === "cancelled") continue;
      const at = parseMeasurementTime(raw.scheduledAt);
      if (!at) continue;
      const label = MEASUREMENT_STATUS_LABELS[st ?? "planned"] ?? "Zaměření";
      out.push({
        id: `z-${raw.id}`,
        at,
        title: raw.customerName?.trim() || "—",
        kind: "measurement",
        detail: `Zaměření · ${label}`,
      });
    }

    const valid = out.filter(isValidCalendarEvent);
    valid.sort((a, b) => a.at.getTime() - b.at.getTime());
    return valid;
  }, [meetingsRaw, measurementsRaw]);

  const eventsByDayKey = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!isValidCalendarEvent(ev)) continue;
      const key = format(ev.at, "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(ev);
      m.set(key, arr);
    }
    return m;
  }, [events]);

  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const loading = meetingsLoading || measurementsLoading;

  return (
    <div className="rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Kalendář schůzek a zaměření
          </h2>
          <p className="text-sm text-slate-800">
            Schůzky z poptávek a naplánovaná zaměření — měsíční přehled.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={() => setVisibleMonth((d) => subMonths(d, 1))}
            aria-label="Předchozí měsíc"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[160px] text-center text-sm font-medium tabular-nums text-slate-900">
            {format(visibleMonth, "LLLL yyyy", { locale: cs })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={() => setVisibleMonth((d) => addMonths(d, 1))}
            aria-label="Další měsíc"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="hidden sm:inline-flex border border-slate-200 bg-slate-100 text-slate-900 hover:bg-slate-200"
            onClick={() => setVisibleMonth(startOfMonth(new Date()))}
          >
            Dnes
          </Button>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <span
              className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              aria-label="Načítání"
            />
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-800">
              <div className="flex flex-wrap gap-4">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-orange-100 ring-1 ring-orange-200" />
                  Schůzka (poptávka)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-200" />
                  Zaměření
                </span>
              </div>
              {!loading && events.length === 0 ? (
                <span className="text-slate-800">
                  V tomto měsíci nic — naplánujte v{" "}
                  <Link
                    href="/portal/leads"
                    className="font-medium text-slate-900 underline underline-offset-2 hover:no-underline"
                  >
                    Poptávkách
                  </Link>
                  .
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
              {WEEKDAYS.map((wd) => (
                <div
                  key={wd}
                  className="bg-slate-100 px-1 py-2 text-center text-xs font-semibold text-slate-900"
                >
                  {wd}
                </div>
              ))}
              {days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayEvents = (eventsByDayKey.get(key) ?? []).filter(
                  isValidCalendarEvent
                );
                const outside = !isSameMonth(day, visibleMonth);
                const today = isToday(day);
                return (
                  <div
                    key={key}
                    className={`min-h-[92px] bg-white p-1 sm:min-h-[104px] sm:p-1.5 ${
                      outside ? "opacity-40" : ""
                    } ${today ? "ring-1 ring-inset ring-slate-400" : ""}`}
                  >
                    <div
                      className={`mb-1 text-right text-xs font-medium tabular-nums ${
                        today ? "text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {format(day, "d.", { locale: cs })}
                    </div>
                    <ul className="space-y-0.5">
                      {dayEvents.slice(0, 4).map((ev) => (
                        <li
                          key={ev.id}
                          className={`truncate rounded border px-1 py-0.5 text-[10px] leading-tight sm:text-[11px] ${
                            ev.kind === "meeting"
                              ? "border-orange-200 bg-orange-100 text-slate-900"
                              : "border-emerald-200 bg-emerald-100 text-slate-900"
                          }`}
                          title={`${format(ev.at, "HH:mm")} — ${ev.title} — ${ev.detail ?? ""}`}
                        >
                          <span className="font-semibold tabular-nums">
                            {format(ev.at, "HH:mm")}
                          </span>{" "}
                          <span className="font-medium">{ev.title}</span>
                          {ev.detail ? (
                            <span className="block truncate text-[9px] opacity-90 sm:text-[10px]">
                              {ev.detail}
                            </span>
                          ) : null}
                        </li>
                      ))}
                      {dayEvents.length > 4 ? (
                        <li className="text-[10px] text-slate-800">
                          +{dayEvents.length - 4} další
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
