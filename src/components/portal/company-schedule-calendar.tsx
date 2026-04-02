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
  isSameDay,
  isToday,
  format,
  parseISO,
  startOfDay,
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
import { cn } from "@/lib/utils";
import { parseFirestoreScheduledAt } from "@/lib/lead-meeting-utils";
import type { MeasurementDoc, MeasurementStatus } from "@/lib/measurements";
import { MEASUREMENT_STATUS_LABELS } from "@/lib/measurements";

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

type CalendarEvent = {
  id: string;
  at: Date;
  /** Jméno zákazníka (stejné jako dříve `title` v mřížce) */
  title: string;
  /** Krátký název / poznámka nahoře na kartě */
  headline: string;
  kind: "meeting" | "measurement";
  detail?: string;
  phone?: string;
  address?: string;
  statusLabel: string;
  /** Tailwind barva štítku */
  badgeClass: string;
  /** Barva levého proužku / akcentu karty */
  accentClass: string;
};

function isValidCalendarEvent(e: unknown): e is CalendarEvent {
  if (e == null || typeof e !== "object") return false;
  const o = e as Partial<CalendarEvent>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.headline !== "string") return false;
  if (typeof o.statusLabel !== "string") return false;
  if (typeof o.badgeClass !== "string") return false;
  if (typeof o.accentClass !== "string") return false;
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

function measurementVisuals(status: MeasurementStatus | undefined): {
  badgeClass: string;
  accentClass: string;
} {
  switch (status) {
    case "completed":
      return {
        badgeClass: "border-sky-200 bg-sky-100 text-sky-950",
        accentClass: "border-l-sky-500",
      };
    case "converted":
      return {
        badgeClass: "border-violet-200 bg-violet-100 text-violet-950",
        accentClass: "border-l-violet-500",
      };
    case "cancelled":
      return {
        badgeClass: "border-slate-200 bg-slate-100 text-slate-800",
        accentClass: "border-l-slate-400",
      };
    default:
      return {
        badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-950",
        accentClass: "border-l-emerald-500",
      };
  }
}

function scheduleMobileEventCountLabel(n: number): string {
  if (n === 0) return "žádná událost";
  if (n === 1) return "1 událost";
  if (n >= 2 && n <= 4) return `${n} události`;
  return `${n} událostí`;
}

function ScheduleMobileEventCard({ ev }: { ev: CalendarEvent }) {
  const telHref = ev.phone
    ? `tel:${ev.phone.replace(/\s/g, "")}`
    : undefined;

  return (
    <article
      className={cn(
        "min-h-[44px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm border-l-[6px]",
        ev.accentClass
      )}
    >
      <div className="flex flex-col gap-3.5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Název
          </p>
          <p className="text-[1.05rem] font-semibold leading-snug text-slate-900 sm:text-lg">
            {ev.headline}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Čas</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">
              {format(ev.at, "HH:mm")}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Zákazník</p>
            <p className="text-base font-medium leading-snug text-slate-900">
              {ev.title}
            </p>
          </div>
        </div>

        {ev.address ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Adresa</p>
            <p className="text-sm leading-relaxed text-slate-800">{ev.address}</p>
          </div>
        ) : null}

        {ev.phone ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500">Telefon</p>
            <a
              href={telHref}
              className="inline-flex min-h-[44px] items-center text-base font-semibold text-blue-700 underline-offset-2 hover:underline active:text-blue-900"
            >
              {ev.phone}
            </a>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span
            className={cn(
              "inline-flex max-w-full rounded-full border px-3 py-1.5 text-xs font-bold leading-tight",
              ev.badgeClass
            )}
          >
            {ev.statusLabel}
          </span>
          <span
            className={cn(
              "inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold",
              ev.kind === "meeting"
                ? "border-orange-300 bg-orange-50 text-orange-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-900"
            )}
          >
            {ev.kind === "meeting" ? "Schůzka" : "Zaměření"}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CompanyScheduleCalendar({
  companyId,
}: {
  companyId: string;
}) {
  const firestore = useFirestore();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [mobileSelectedDay, setMobileSelectedDay] = useState(() =>
    startOfDay(new Date())
  );

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
      const note = String(raw.note ?? "").trim();
      const phone = String(raw.phone ?? "").trim();
      const place = String(raw.place ?? "").trim();
      out.push({
        id: `m-${id}`,
        at,
        title: customerName,
        headline: note || "Schůzka",
        kind: "meeting",
        detail: "Schůzka",
        phone: phone || undefined,
        address: place || undefined,
        statusLabel: "Schůzka",
        badgeClass: "border-orange-200 bg-orange-100 text-orange-950",
        accentClass: "border-l-orange-500",
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
      const visuals = measurementVisuals(st);
      const note = String(raw.note ?? "").trim();
      const phone = String(raw.phone ?? "").trim();
      const address = String(raw.address ?? "").trim();
      out.push({
        id: `z-${raw.id}`,
        at,
        title: raw.customerName?.trim() || "—",
        headline: note || "Zaměření",
        kind: "measurement",
        detail: `Zaměření · ${label}`,
        phone: phone || undefined,
        address: address || undefined,
        statusLabel: label,
        badgeClass: visuals.badgeClass,
        accentClass: visuals.accentClass,
      });
    }

    const valid = out.filter(isValidCalendarEvent);
    valid.sort((a, b) => a.at.getTime() - b.at.getTime());
    return valid;
  }, [meetingsRaw, measurementsRaw]);

  React.useEffect(() => {
    setMobileSelectedDay((prev) => {
      if (isSameMonth(prev, visibleMonth)) return prev;
      return startOfDay(startOfMonth(visibleMonth));
    });
  }, [visibleMonth]);

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

  const mobileSelectedDayKey = format(mobileSelectedDay, "yyyy-MM-dd");
  const mobileDayEvents = useMemo(() => {
    return (eventsByDayKey.get(mobileSelectedDayKey) ?? []).filter(
      isValidCalendarEvent
    );
  }, [eventsByDayKey, mobileSelectedDayKey]);

  const monthDaysOnly = useMemo(
    () => eachDayOfInterval({ start: monthStart, end: monthEnd }),
    [monthStart, monthEnd]
  );
  const mobileGridLeadingPad = (monthStart.getDay() + 6) % 7;

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
            className="inline-flex shrink-0 border border-slate-200 bg-slate-100 px-3 text-slate-900 hover:bg-slate-200"
            onClick={() => {
              const t = startOfDay(new Date());
              setVisibleMonth(startOfMonth(t));
              setMobileSelectedDay(t);
            }}
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-800 md:mb-3">
              <div className="hidden flex-wrap gap-4 md:flex">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-orange-100 ring-1 ring-orange-200" />
                  Schůzka (poptávka)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-200" />
                  Zaměření
                </span>
              </div>
              <div className="flex w-full flex-wrap gap-3 md:hidden">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-orange-100 ring-1 ring-orange-200" />
                  Schůzka
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

            {/* Mobil: výběr dne + karty událostí */}
            <div className="md:hidden">
              <div className="grid grid-cols-7 gap-2">
                {WEEKDAYS.map((wd) => (
                  <div
                    key={wd}
                    className="py-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600"
                  >
                    {wd}
                  </div>
                ))}
                {Array.from({ length: mobileGridLeadingPad }).map((_, i) => (
                  <div key={`pad-${i}`} className="min-h-[52px]" aria-hidden />
                ))}
                {monthDaysOnly.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayEvents = eventsByDayKey.get(key) ?? [];
                  const hasEvents = dayEvents.length > 0;
                  const selected = isSameDay(day, mobileSelectedDay);
                  const today = isToday(day);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMobileSelectedDay(startOfDay(day))}
                      className={cn(
                        "flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 px-0.5 py-2 text-sm font-bold tabular-nums transition-colors",
                        selected
                          ? "border-orange-500 bg-orange-50 text-slate-900 shadow-md"
                          : "border-slate-200 bg-white text-slate-800 active:bg-slate-50",
                        today && !selected ? "ring-2 ring-slate-400 ring-offset-1" : ""
                      )}
                    >
                      <span>{format(day, "d.", { locale: cs })}</span>
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 rounded-full",
                          hasEvents ? "bg-orange-500" : "bg-transparent"
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex flex-col gap-1 px-0.5 sm:flex-row sm:items-end sm:justify-between">
                  <h3 className="text-lg font-bold capitalize leading-tight text-slate-900">
                    {format(mobileSelectedDay, "EEEE d. MMMM yyyy", { locale: cs })}
                  </h3>
                  <p className="text-sm font-medium text-slate-600">
                    {scheduleMobileEventCountLabel(mobileDayEvents.length)}
                  </p>
                </div>
                {mobileDayEvents.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-base leading-relaxed text-slate-600">
                    Tento den nemáte žádné naplánované schůzky ani zaměření.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {mobileDayEvents.map((ev) => (
                      <li key={ev.id}>
                        <ScheduleMobileEventCard ev={ev} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Desktop: klasická měsíční mřížka */}
            <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid">
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
