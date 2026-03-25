"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { collectionGroup, query, where, limit } from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { Loader2, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JOB_TASK_SCOPE,
  type JobTaskRow,
  type JobTaskPriority,
  jobTaskPriorityLabel,
  sortActiveJobTasksForDashboard,
} from "@/lib/job-task-types";

function formatDueShort(due: string | undefined): string {
  if (!due?.trim()) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const [y, m, d] = due.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "numeric",
    }).format(new Date(y, m - 1, d));
  } catch {
    return due;
  }
}

function PriorityMark({ priority }: { priority: JobTaskPriority | undefined }) {
  const label = jobTaskPriorityLabel(priority);
  const dotClass =
    priority === "high"
      ? "bg-rose-500/80"
      : priority === "medium"
        ? "bg-amber-500/75"
        : "bg-muted-foreground/40";
  return (
    <span
      title={label}
      className="inline-flex shrink-0 items-center justify-center"
      aria-label={label}
    >
      <span className={cn("block h-1.5 w-1.5 rounded-full", dotClass)} />
    </span>
  );
}

function rowHighlight(row: JobTaskRow, todayIso: string): boolean {
  const due = String(row.dueDate ?? "");
  const overdue = Boolean(due && due < todayIso);
  const high = row.priority === "high";
  return overdue || high;
}

export function DashboardJobTasksWidget({
  companyId,
  todayIso,
}: {
  companyId: string;
  todayIso: string;
}) {
  const firestore = useFirestore();

  const q = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collectionGroup(firestore, "tasks"),
      where("companyId", "==", companyId),
      where("taskScope", "==", JOB_TASK_SCOPE),
      where("status", "==", "active"),
      limit(250)
    );
  }, [firestore, companyId]);

  const { data: raw, isLoading } = useCollection<JobTaskRow>(q);

  const sorted = useMemo(() => {
    const list = Array.isArray(raw) ? raw : [];
    return sortActiveJobTasksForDashboard(list, todayIso);
  }, [raw, todayIso]);

  return (
    <section
      className="rounded-md border border-border/50 bg-muted/5 px-3 py-2.5 sm:px-3.5 sm:py-3"
      aria-label="Úkoly ze zakázek"
    >
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <ListTodo className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <h2 className="text-[11px] font-medium uppercase tracking-wide">
          Úkoly
        </h2>
        {!isLoading ? (
          <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground/80">
            ({sorted.length})
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 opacity-70" />
          Načítání…
        </div>
      ) : sorted.length === 0 ? (
        <p className="py-0.5 text-xs text-muted-foreground">
          Žádné aktivní úkoly ze zakázek.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((row) => {
            const jid = row.jobId?.trim() ?? "";
            const urgent = rowHighlight(row, todayIso);
            const due = String(row.dueDate ?? "");
            const overdue = Boolean(due && due < todayIso);
            const content = (
              <>
                <div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5 sm:flex-nowrap sm:items-center">
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground/90"
                    title={row.title}
                  >
                    {row.title || "Bez názvu"}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 sm:ml-auto">
                    <span
                      className={cn(
                        "whitespace-nowrap text-[11px] tabular-nums text-muted-foreground",
                        overdue && "text-rose-600/90 dark:text-rose-400/90"
                      )}
                    >
                      {formatDueShort(row.dueDate)}
                      {overdue ? " · po termínu" : ""}
                    </span>
                    <PriorityMark priority={row.priority} />
                  </span>
                </div>
              </>
            );

            const rowClass = cn(
              "block rounded border border-transparent px-2 py-1.5 transition-colors",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              urgent
                ? "border-rose-200/55 bg-rose-50/40 dark:border-rose-900/35 dark:bg-rose-950/20"
                : "bg-background/40"
            );

            if (!jid) {
              return (
                <li key={row.id} className={rowClass}>
                  {content}
                </li>
              );
            }

            return (
              <li key={`${jid}-${row.id}`}>
                <Link href={`/portal/jobs/${jid}`} className={rowClass}>
                  {content}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
