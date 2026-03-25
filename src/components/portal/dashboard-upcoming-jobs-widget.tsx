"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  deadlineUrgencyRowClass,
  formatDaysUntilDeadlineLabel,
  type DeadlineUrgency,
  parseJobDeadlineLocalDay,
  selectUpcomingDeadlineJobs,
} from "@/lib/dashboard-deadline-jobs";

type JobRow = {
  id: string;
  name?: string;
  endDate?: string;
  status?: string;
  customerName?: string;
  customerAddress?: string;
};

function formatJobDeadlineDate(endDate: string): string {
  const d = parseJobDeadlineLocalDay(endDate);
  if (!d) return endDate;
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

function subtitleForJob(job: JobRow): string {
  const cust = String(job.customerName ?? "").trim();
  if (cust) return cust;
  const addr = String(job.customerAddress ?? "").trim();
  if (addr) return addr.replace(/\s*\n\s*/g, ", ").slice(0, 80);
  return "—";
}

function urgencyBadgeClass(u: DeadlineUrgency): string {
  switch (u) {
    case "overdue":
    case "critical":
      return "bg-destructive/15 text-destructive";
    case "soon":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function DashboardUpcomingJobsWidget({ jobs }: { jobs: JobRow[] | null | undefined }) {
  const list = useMemo(
    () =>
      selectUpcomingDeadlineJobs(Array.isArray(jobs) ? jobs : [], {
        maxItems: 10,
      }),
    [jobs]
  );

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Termíny zakázek
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          Nejbližší otevřené zakázky podle data dokončení (nezahrnuje dokončené ani
          fakturované).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Žádná zakázka s termínem v nastaveném horizontu.
          </p>
        ) : (
          <ul className="max-h-[280px] space-y-2 overflow-y-auto pr-1 [-webkit-overflow-scrolling:touch]">
            {list.map((job) => (
              <li
                key={job.id}
                className={`rounded-lg border border-border/60 px-3 py-2 text-sm ${deadlineUrgencyRowClass(job.urgency)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/portal/jobs/${job.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {job.name?.trim() || "Bez názvu"}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground" title={subtitleForJob(job)}>
                      {subtitleForJob(job)}
                    </p>
                    <p className="mt-1 text-xs font-medium tabular-nums text-foreground">
                      {formatJobDeadlineDate(String(job.endDate ?? ""))}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${urgencyBadgeClass(job.urgency)}`}
                  >
                    {formatDaysUntilDeadlineLabel(job.daysUntil)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href="/portal/jobs">Zobrazit všechny zakázky</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
