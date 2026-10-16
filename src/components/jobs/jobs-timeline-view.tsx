"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobListRow } from "@/lib/job-list-filters";
import { formatJobListDate } from "@/lib/job-list-filters";
import { jobStatusLabel } from "@/lib/job-status";
import { normalizeCompletionPercent } from "@/lib/job-customer-progress";
import {
  jobTimelineDeadlineIso,
  jobTimelineUrgency,
  parseLocalDay,
  pixelsPerDay,
  pragueTodayIso,
  resolveJobDisplayNumber,
  urgencyColorClass,
  type JobTimelineScale,
} from "@/lib/jobs/job-timeline-utils";

type Props = {
  jobs: JobListRow[];
  isPortalEmployee?: boolean;
  mobile?: boolean;
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

export function JobsTimelineView({ jobs, isPortalEmployee = false, mobile = false }: Props) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<JobTimelineScale>("month");
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
    Math.ceil((maxDay.getTime() - minDay.getTime()) / (86400000))
  );
  const widthPx = totalDays * ppd + 120;

  const dayToX = (iso: string) => {
    const d = parseLocalDay(iso);
    if (!d) return 0;
    const diff = (d.getTime() - minDay.getTime()) / 86400000;
    return 60 + diff * ppd;
  };

  const openJob = (id: string) => {
    router.push(
      isPortalEmployee ? `/portal/employee/jobs/${id}` : `/portal/jobs/${id}`
    );
  };

  const grouped = useMemo(() => groupByDeadline(withDeadline), [withDeadline]);

  if (mobile) {
    const sorted = [...withDeadline].sort((a, b) =>
      (jobTimelineDeadlineIso(a) ?? "").localeCompare(jobTimelineDeadlineIso(b) ?? "")
    );
    return (
      <div className="space-y-4 p-3">
        <p className="text-xs text-slate-500">Dnes: {formatJobListDate(todayIso)}</p>
        <ol className="relative border-l border-slate-200 pl-4 space-y-4">
          {sorted.map((job) => {
            const id = String(job.id ?? "");
            const u = jobTimelineUrgency(job);
            return (
              <li key={id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[1.35rem] top-1 h-3 w-3 rounded-full border-2 border-white",
                    urgencyColorClass(u)
                  )}
                />
                <button
                  type="button"
                  className="w-full text-left rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                  onClick={() => id && openJob(id)}
                >
                  <p className="text-xs font-mono text-slate-500">
                    {resolveJobDisplayNumber(job) || "—"}
                  </p>
                  <p className="font-medium text-sm">{job.name}</p>
                  <p className="text-xs text-slate-600">
                    {jobTimelineDeadlineIso(job)
                      ? formatJobListDate(jobTimelineDeadlineIso(job))
                      : "—"}{" "}
                    · {jobStatusLabel(job.status)}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>
        {withoutDeadline.length ? (
          <section>
            <h3 className="text-sm font-semibold mb-2">Zakázky bez stanoveného termínu</h3>
            <ul className="space-y-2">
              {withoutDeadline.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    className="w-full text-left rounded border p-2 text-sm"
                    onClick={() => job.id && openJob(String(job.id))}
                  >
                    {resolveJobDisplayNumber(job)} — {job.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  return (
    <div className="space-y-3 p-4">
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
          <Button type="button" size="icon" variant="outline" onClick={() => scrollBy(-240)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" onClick={() => scrollBy(240)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => setScale((s) => (s === "week" ? s : s === "month" ? "week" : "month"))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => setScale((s) => (s === "year" ? s : s === "quarter" ? "year" : "quarter"))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="relative min-h-[220px]" style={{ width: widthPx }}>
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-600 z-10"
            style={{ left: dayToX(todayIso) }}
          >
            <span className="absolute -top-1 left-1 text-[10px] font-bold text-orange-700 whitespace-nowrap">
              DNES
            </span>
          </div>

          {[...grouped.entries()].map(([dayKey, list]) => {
            if (dayKey === "__none__") return null;
            const x = dayToX(dayKey);
            return (
              <div key={dayKey} className="absolute top-8" style={{ left: x }}>
                {list.map((job, row) => {
                  const id = String(job.id ?? "");
                  const u = jobTimelineUrgency(job);
                  const pct = normalizeCompletionPercent(
                    (job as { completionPercent?: unknown }).completionPercent
                  );
                  return (
                    <button
                      key={id}
                      type="button"
                      title={job.name}
                      className={cn(
                        "mb-2 block max-w-[160px] rounded-md border px-2 py-1 text-left text-[11px] shadow-sm hover:ring-2 hover:ring-orange-400",
                        urgencyColorClass(u),
                        "text-white"
                      )}
                      style={{ marginTop: row * 52 }}
                      onClick={() => id && openJob(id)}
                    >
                      <span className="font-mono opacity-90">
                        {resolveJobDisplayNumber(job) || "—"}
                      </span>
                      <span className="block font-semibold truncate">{job.name}</span>
                      <span className="opacity-90">
                        {formatJobListDate(dayKey)} · {jobStatusLabel(job.status)}
                        {pct > 0 ? ` · ${pct}%` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {withoutDeadline.length ? (
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
            {withoutDeadline.length > 40 ? (
              <span className="text-xs text-slate-500">+ {withoutDeadline.length - 40} dalších</span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
