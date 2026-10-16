"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobListRow } from "@/lib/job-list-filters";
import { formatJobListDate } from "@/lib/job-list-filters";
import { jobStatusLabel } from "@/lib/job-status";
import { normalizeCompletionPercent } from "@/lib/job-customer-progress";
import {
  formatMonthLabelCs,
  isStrongDayTick,
  jobDaysUntilLabel,
  jobTimelineDeadlineIso,
  jobTimelineUrgency,
  parseLocalDay,
  pixelsPerDay,
  pragueTodayIso,
  resolveJobDisplayNumber,
  shouldShowDayNumber,
  shouldShowDayTick,
  urgencyDotClass,
  type JobTimelineScale,
} from "@/lib/jobs/job-timeline-utils";

const RULER_HEIGHT = 168;
const AXIS_Y = 108;
const PAD_LEFT = 48;
const CLUSTER_THRESHOLD = 7;
const LANE_OFFSETS = [-22, -36, -10, 10, 22, 36] as const;

type Props = {
  jobs: JobListRow[];
  getCustomerName?: (customerId: string | undefined | null) => string;
  isPortalEmployee?: boolean;
  mobile?: boolean;
};

type TooltipState = {
  jobs: JobListRow[];
  clientX: number;
  clientY: number;
};

function groupByDeadline(jobs: JobListRow[]): Map<string, JobListRow[]> {
  const map = new Map<string, JobListRow[]>();
  for (const j of jobs) {
    const key = jobTimelineDeadlineIso(j) ?? "__none__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(j);
  }
  return map;
}

function TimelineTooltip({
  state,
  onClose,
  getCustomerName,
  onOpenJob,
}: {
  state: TooltipState;
  onClose: () => void;
  getCustomerName: (id: string | undefined | null) => string;
  onOpenJob: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.clientX, top: state.clientY - 8 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = state.clientX - rect.width / 2;
    let top = state.clientY - rect.height - 12;
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    if (top < margin) top = state.clientY + 16;
    setPos({ left, top });
  }, [state.clientX, state.clientY, state.jobs.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-[200] max-w-[min(320px,calc(100vw-16px))] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl"
      style={{ left: pos.left, top: pos.top }}
      onMouseLeave={onClose}
    >
      {state.jobs.length === 1 ? (
        <JobTooltipBody job={state.jobs[0]!} getCustomerName={getCustomerName} />
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {state.jobs.map((job) => {
            const id = String(job.id ?? "");
            return (
              <li key={id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-slate-100 p-2 text-left hover:bg-orange-50 hover:border-orange-200"
                  onClick={() => id && onOpenJob(id)}
                >
                  <JobTooltipBody job={job} getCustomerName={getCustomerName} compact />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

function JobTooltipBody({
  job,
  getCustomerName,
  compact,
}: {
  job: JobListRow;
  getCustomerName: (id: string | undefined | null) => string;
  compact?: boolean;
}) {
  const deadline = jobTimelineDeadlineIso(job);
  const pct = normalizeCompletionPercent(
    (job as { completionPercent?: unknown }).completionPercent
  );
  return (
    <div className={cn("space-y-1 text-xs text-slate-700", compact && "space-y-0.5")}>
      <p className="font-mono text-[11px] text-slate-500">
        {resolveJobDisplayNumber(job) || "—"}
      </p>
      <p className={cn("font-semibold text-slate-900", compact ? "text-xs" : "text-sm")}>
        {job.name ?? "—"}
      </p>
      {!compact ? (
        <>
          <p>
            <span className="text-slate-500">Zákazník:</span> {getCustomerName(job.customerId)}
          </p>
          <p>
            <span className="text-slate-500">Termín:</span>{" "}
            {deadline ? formatJobListDate(deadline) : "—"}
          </p>
          <p>
            <span className="text-slate-500">Stav:</span> {jobStatusLabel(job.status)}
          </p>
          {pct > 0 ? (
            <p>
              <span className="text-slate-500">Dokončení:</span> {pct} %
            </p>
          ) : null}
          <p className="font-medium text-orange-800">{jobDaysUntilLabel(job)}</p>
        </>
      ) : null}
    </div>
  );
}

export function JobsTimelineView({
  jobs,
  getCustomerName = () => "—",
  isPortalEmployee = false,
  mobile = false,
}: Props) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ active: boolean; startX: number; scrollLeft: number } | null>(
    null
  );
  const [scale, setScale] = useState<JobTimelineScale>("month");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pinnedDay, setPinnedDay] = useState<string | null>(null);

  const todayIso = pragueTodayIso();
  const today = parseLocalDay(todayIso)!;
  const ppd = pixelsPerDay(scale);

  const withDeadline = useMemo(
    () => jobs.filter((j) => jobTimelineDeadlineIso(j)),
    [jobs]
  );
  const withoutDeadline = useMemo(
    () => jobs.filter((j) => !jobTimelineDeadlineIso(j)),
    [jobs]
  );

  const minDay = useMemo(() => {
    const dates = withDeadline
      .map((j) => parseLocalDay(jobTimelineDeadlineIso(j)!))
      .filter(Boolean) as Date[];
    dates.push(today);
    const t = Math.min(...dates.map((d) => d.getTime()));
    const d = new Date(t);
    d.setDate(d.getDate() - 14);
    return d;
  }, [withDeadline, today]);

  const maxDay = useMemo(() => {
    const dates = withDeadline
      .map((j) => parseLocalDay(jobTimelineDeadlineIso(j)!))
      .filter(Boolean) as Date[];
    dates.push(today);
    const t = Math.max(...dates.map((d) => d.getTime()));
    const d = new Date(t);
    d.setDate(d.getDate() + 21);
    return d;
  }, [withDeadline, today]);

  const totalDays = Math.max(
    1,
    Math.ceil((maxDay.getTime() - minDay.getTime()) / 86400000)
  );
  const widthPx = totalDays * ppd + PAD_LEFT + 40;

  const dayToX = useCallback(
    (iso: string) => {
      const d = parseLocalDay(iso);
      if (!d) return PAD_LEFT;
      const diff = (d.getTime() - minDay.getTime()) / 86400000;
      return PAD_LEFT + diff * ppd;
    },
    [minDay, ppd]
  );

  const openJob = useCallback(
    (id: string) => {
      setTooltip(null);
      router.push(
        isPortalEmployee ? `/portal/employee/jobs/${id}` : `/portal/jobs/${id}`
      );
    },
    [router, isPortalEmployee]
  );

  const grouped = useMemo(() => groupByDeadline(withDeadline), [withDeadline]);

  const rulerDays = useMemo(() => {
    const out: { offset: number; date: Date; iso: string }[] = [];
    for (let i = 0; i <= totalDays; i++) {
      const date = new Date(minDay.getTime() + i * 86400000);
      const iso = date.toISOString().slice(0, 10);
      out.push({ offset: i, date, iso });
    }
    return out;
  }, [minDay, totalDays]);

  const monthBands = useMemo(() => {
    const bands: { x: number; label: string; width: number }[] = [];
    let curMonth = -1;
    let startX = PAD_LEFT;
    for (const day of rulerDays) {
      const m = day.date.getMonth();
      if (m !== curMonth) {
        if (curMonth >= 0) {
          bands.push({
            x: startX,
            width: dayToX(day.iso) - startX,
            label: formatMonthLabelCs(new Date(day.date.getFullYear(), curMonth, 1)),
          });
        }
        curMonth = m;
        startX = dayToX(day.iso);
      }
    }
    if (curMonth >= 0) {
      bands.push({
        x: startX,
        width: widthPx - startX,
        label: formatMonthLabelCs(
          new Date(rulerDays[rulerDays.length - 1]?.date.getFullYear() ?? today.getFullYear(), curMonth, 1)
        ),
      });
    }
    return bands;
  }, [rulerDays, dayToX, widthPx, today]);

  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  const dotAnchorToClient = (x: number, y: number) => {
    const el = scrollRef.current;
    if (!el) return { clientX: x, clientY: y };
    const rect = el.getBoundingClientRect();
    return {
      clientX: rect.left + x - el.scrollLeft,
      clientY: rect.top + y,
    };
  };

  const showTooltipAt = (jobsAtPoint: JobListRow[], x: number, y: number) => {
    const { clientX, clientY } = dotAnchorToClient(x, y);
    setTooltip({ jobs: jobsAtPoint, clientX, clientY });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag?.active || !el) return;
    el.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
  };

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    scrollRef.current?.releasePointerCapture(e.pointerId);
  };

  const showTooltip = (jobsAtPoint: JobListRow[], e: React.MouseEvent | React.FocusEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({
      jobs: jobsAtPoint,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top,
    });
  };

  const renderDots = () => {
    const nodes: React.ReactNode[] = [];
    for (const [dayKey, list] of grouped.entries()) {
      if (dayKey === "__none__") continue;
      const x = dayToX(dayKey);
      if (list.length >= CLUSTER_THRESHOLD) {
        const u = jobTimelineUrgency(list[0]!);
        nodes.push(
          <button
            key={`cluster-${dayKey}`}
            type="button"
            aria-label={`${list.length} zakázek ${formatJobListDate(dayKey)}`}
            className={cn(
              "absolute z-20 flex h-3 min-w-[12px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500",
              urgencyDotClass(u)
            )}
            style={{ left: x - 6, top: AXIS_Y - 18 }}
            onMouseEnter={(e) => showTooltip(list, e)}
            onFocus={(e) => showTooltip(list, e)}
            onMouseLeave={() => !pinnedDay && setTooltip(null)}
            onBlur={() => !pinnedDay && setTooltip(null)}
            onClick={() => {
              if (mobile || list.length > 1) {
                setPinnedDay(dayKey);
                showTooltipAt(list, x, AXIS_Y - 12);
              } else if (list[0]?.id) {
                openJob(String(list[0].id));
              }
            }}
          >
            {list.length}
          </button>
        );
        continue;
      }
      list.forEach((job, idx) => {
        const id = String(job.id ?? "");
        const u = jobTimelineUrgency(job);
        const lane = LANE_OFFSETS[idx % LANE_OFFSETS.length] ?? 0;
        const above = idx % 2 === 0;
        nodes.push(
          <button
            key={id || `${dayKey}-${idx}`}
            type="button"
            aria-label={`${job.name ?? "Zakázka"} ${formatJobListDate(dayKey)}`}
            className={cn(
              "absolute z-20 h-3 w-3 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500",
              urgencyDotClass(u)
            )}
            style={{
              left: x - 6,
              top: above ? AXIS_Y + lane - 6 : AXIS_Y - lane - 6,
            }}
            onMouseEnter={(e) => showTooltip([job], e)}
            onFocus={(e) => showTooltip([job], e)}
            onMouseLeave={() => !pinnedDay && setTooltip(null)}
            onBlur={() => !pinnedDay && setTooltip(null)}
            onClick={() => {
              if (mobile) {
                setPinnedDay(dayKey);
                showTooltipAt([job], x, above ? AXIS_Y + lane - 12 : AXIS_Y - lane - 12);
              } else if (id) openJob(id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && id) openJob(id);
            }}
          />
        );
      });
    }
    return nodes;
  };

  function renderRulerSvg() {
    return (
      <>
        {monthBands.map((b, i) => (
          <div
            key={`m-${i}`}
            className="absolute top-0 border-l border-slate-200 bg-slate-50/80"
            style={{ left: b.x, width: b.width, height: 36 }}
          >
            <span className="block px-1 pt-1 text-[10px] font-semibold text-slate-700 truncate">
              {scale === "year" || b.width > 36 ? b.label : ""}
            </span>
          </div>
        ))}
        <div
          className="absolute left-0 right-0 bg-slate-300"
          style={{ top: AXIS_Y, height: 2 }}
        />
        {rulerDays.map((day) => {
          if (!shouldShowDayTick(day.offset, scale)) return null;
          const x = dayToX(day.iso);
          const strong = isStrongDayTick(day.offset);
          const showNum = shouldShowDayNumber(day.offset, scale, ppd);
          return (
            <React.Fragment key={day.iso}>
              <div
                className={cn(
                  "absolute w-px bg-slate-400",
                  strong ? "h-3 bg-slate-600" : "h-1.5"
                )}
                style={{ left: x, top: strong ? AXIS_Y - 10 : AXIS_Y - 6 }}
              />
              {showNum ? (
                <span
                  className="absolute text-[9px] tabular-nums text-slate-600 -translate-x-1/2 select-none"
                  style={{ left: x, top: AXIS_Y + 6 }}
                >
                  {day.date.getDate()}
                </span>
              ) : null}
            </React.Fragment>
          );
        })}
      </>
    );
  }

  function TodayMarker({ x }: { x: number }) {
    return (
      <div
        className="pointer-events-none absolute z-10 w-0.5 bg-orange-600"
        style={{ left: x, top: 28, bottom: 8 }}
      >
        <span className="absolute -top-5 left-0.5 whitespace-nowrap text-[10px] font-bold text-orange-700">
          DNES
        </span>
      </div>
    );
  }

  function withoutDeadlineSection() {
    if (!withoutDeadline.length) return null;
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">
          Zakázky bez stanoveného termínu ({withoutDeadline.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {withoutDeadline.slice(0, 40).map((job) => (
            <button
              key={job.id}
              type="button"
              className="rounded-full border bg-white px-2 py-1 text-xs hover:border-orange-400"
              onClick={() => job.id && openJob(String(job.id))}
            >
              {resolveJobDisplayNumber(job) || "—"} · {job.name}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className={cn("space-y-3", mobile ? "p-3" : "p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-600">Měřítko:</span>
        {(["week", "month", "quarter", "year"] as JobTimelineScale[]).map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={scale === s ? "default" : "outline"}
            className={scale === s ? "bg-orange-600 hover:bg-orange-700" : ""}
            onClick={() => setScale(s)}
          >
            {s === "week"
              ? "Týden"
              : s === "month"
                ? "Měsíc"
                : s === "quarter"
                  ? "Čtvrtletí"
                  : "Rok"}
          </Button>
        ))}
        <div className="ml-auto flex gap-1">
          <Button type="button" size="icon" variant="outline" aria-label="Posunout doleva" onClick={() => scrollBy(-240)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" aria-label="Posunout doprava" onClick={() => scrollBy(240)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Přiblížit"
            onClick={() => setScale((s) => (s === "week" ? s : s === "month" ? "week" : "month"))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Oddálit"
            onClick={() => setScale((s) => (s === "year" ? s : s === "quarter" ? "year" : "quarter"))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        {mobile
          ? "Posunete prstem. Klepnutím na bod zobrazíte detail, znovu klepnutím otevřete zakázku."
          : "Tažením myší posunete osu. Najetím na bod zobrazíte detail, kliknutím otevřete zakázku."}
      </p>

      <div
        ref={scrollRef}
        className={cn(
          "overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 touch-pan-x",
          mobile ? "bg-slate-50" : "bg-white cursor-grab active:cursor-grabbing"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="relative select-none" style={{ width: widthPx, height: RULER_HEIGHT }}>
          {renderRulerSvg()}
          <TodayMarker x={dayToX(todayIso)} />
          {renderDots()}
        </div>
      </div>

      {tooltip ? (
        <TimelineTooltip
          state={tooltip}
          onClose={() => {
            setTooltip(null);
            setPinnedDay(null);
          }}
          getCustomerName={getCustomerName ?? (() => "—")}
          onOpenJob={openJob}
        />
      ) : null}

      {withoutDeadlineSection()}
    </div>
  );
}
