"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  collection,
  collectionGroup,
  query,
  where,
  limit,
} from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { Loader2, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  JOB_TASK_SCOPE,
  type JobTaskRow,
  type JobTaskPriority,
  jobTaskPriorityLabel,
} from "@/lib/job-task-types";
import type { OrganizationTask } from "@/lib/organization-task";
import { isTaskOpen } from "@/lib/organization-task";

type JobRef = { id: string; name?: string };

type UnifiedRow = {
  key: string;
  source: "job" | "organization";
  href: string;
  title: string;
  dueIso?: string;
  priority?: JobTaskPriority;
  statusLabel: string;
  jobId?: string;
  jobName?: string;
};

const PRIORITY_RANK: Record<JobTaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

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

function parseOrgPriority(p: unknown): JobTaskPriority | undefined {
  if (p === "high" || p === "medium" || p === "low") return p;
  return undefined;
}

function PriorityMark({ priority }: { priority: JobTaskPriority | undefined }) {
  const label = jobTaskPriorityLabel(priority ?? "low");
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

function sortUnifiedRows(rows: UnifiedRow[], todayIso: string): UnifiedRow[] {
  return [...rows].sort((a, b) => {
    const da =
      a.dueIso && /^\d{4}-\d{2}-\d{2}$/.test(a.dueIso) ? a.dueIso : "";
    const db =
      b.dueIso && /^\d{4}-\d{2}-\d{2}$/.test(b.dueIso) ? b.dueIso : "";
    const overdueA = da && da < todayIso ? 0 : 1;
    const overdueB = db && db < todayIso ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    const sa = da || "9999-12-31";
    const sb = db || "9999-12-31";
    if (sa !== sb) return sa.localeCompare(sb);
    const pa = PRIORITY_RANK[a.priority ?? "low"];
    const pb = PRIORITY_RANK[b.priority ?? "low"];
    return pa - pb;
  });
}

function rowHighlight(row: UnifiedRow, todayIso: string): boolean {
  const due = row.dueIso ?? "";
  const overdue = Boolean(due && due < todayIso);
  const high = row.priority === "high";
  return overdue || high;
}

/** Jeden přehled: úkoly zakázek (collectionGroup tasks + scope job) + úkoly organizace (companies/.../tasks). */
export function DashboardJobTasksWidget({
  companyId,
  todayIso,
  jobs,
}: {
  companyId: string;
  todayIso: string;
  jobs: JobRef[];
}) {
  const firestore = useFirestore();

  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) {
      m.set(j.id, j.name?.trim() || j.id);
    }
    return m;
  }, [jobs]);

  const jobTasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collectionGroup(firestore, "tasks"),
      where("companyId", "==", companyId),
      where("taskScope", "==", JOB_TASK_SCOPE),
      where("status", "==", "active"),
      limit(250)
    );
  }, [firestore, companyId]);

  const orgTasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "tasks"),
      limit(300)
    );
  }, [firestore, companyId]);

  const { data: jobRaw, isLoading: jobLoading } =
    useCollection<JobTaskRow>(jobTasksQuery);
  const { data: orgRaw, isLoading: orgLoading } = useCollection(orgTasksQuery);

  const unified = useMemo(() => {
    const out: UnifiedRow[] = [];

    const jlist = Array.isArray(jobRaw) ? jobRaw : [];
    for (const row of jlist) {
      if (row.status === "done") continue;
      const jid = row.jobId?.trim() ?? "";
      out.push({
        key: jid ? `job-${jid}-${row.id}` : `job-orphan-${row.id}`,
        source: "job",
        href: jid ? `/portal/jobs/${jid}` : "/portal/jobs",
        title: row.title || "Bez názvu",
        dueIso: row.dueDate?.trim() || undefined,
        priority: row.priority,
        statusLabel: "Aktivní",
        jobId: jid || undefined,
        jobName: jid ? jobNameById.get(jid) : undefined,
      });
    }

    const olist = Array.isArray(orgRaw) ? orgRaw : [];
    for (const raw of olist) {
      const t = {
        ...raw,
        id: String((raw as { id?: string })?.id ?? ""),
      } as OrganizationTask;
      if (!t.id || !isTaskOpen(t)) continue;
      const r = raw as { dueDate?: string };
      const dueRaw =
        typeof r.dueDate === "string" && r.dueDate.trim()
          ? r.dueDate.trim()
          : undefined;

      out.push({
        key: `org-${t.id}`,
        source: "organization",
        href: "/portal/jobs?tasks=1",
        title: t.title || "Bez názvu",
        dueIso: dueRaw,
        priority: parseOrgPriority((raw as { priority?: unknown }).priority),
        statusLabel: "Aktivní",
      });
    }

    return sortUnifiedRows(out, todayIso);
  }, [jobRaw, orgRaw, jobNameById, todayIso]);

  const isLoading = jobLoading || orgLoading;

  return (
    <section
      className="rounded-md border border-border/50 bg-muted/5 px-3 py-2.5 sm:px-3.5 sm:py-3"
      aria-label="Úkoly zakázek a organizace"
    >
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <ListTodo className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <h2 className="text-[11px] font-medium uppercase tracking-wide">
          Úkoly
        </h2>
        {!isLoading ? (
          <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground/80">
            ({unified.length})
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 opacity-70" />
          Načítání…
        </div>
      ) : unified.length === 0 ? (
        <p className="py-0.5 text-xs text-muted-foreground">
          Žádné aktivní úkoly (zakázky ani organizace).
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {unified.map((row) => {
            const urgent = rowHighlight(row, todayIso);
            const due = String(row.dueIso ?? "");
            const overdue = Boolean(due && due < todayIso);

            const rowClass = cn(
              "block rounded border border-transparent px-2 py-1.5 transition-colors",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              urgent
                ? "border-rose-200/55 bg-rose-50/40 dark:border-rose-900/35 dark:bg-rose-950/20"
                : "bg-background/40"
            );

            const inner = (
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge
                    variant="outline"
                    className="h-5 shrink-0 border-border px-1.5 text-[10px] font-normal"
                  >
                    {row.source === "job" ? "Zakázka" : "Organizace"}
                  </Badge>
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] font-medium leading-snug text-foreground/90"
                    title={row.title}
                  >
                    {row.title}
                  </span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground sm:justify-end">
                  <span className="whitespace-nowrap">{row.statusLabel}</span>
                  <span
                    className={cn(
                      "whitespace-nowrap tabular-nums",
                      overdue && "text-rose-600/90 dark:text-rose-400/90"
                    )}
                  >
                    {formatDueShort(row.dueIso)}
                    {overdue ? " · po termínu" : ""}
                  </span>
                  <PriorityMark priority={row.priority} />
                </div>
              </div>
            );

            return (
              <li key={row.key}>
                <Link href={row.href} className={rowClass}>
                  {inner}
                  {row.source === "job" && row.jobName ? (
                    <p className="mt-0.5 truncate pl-0 text-[10px] text-muted-foreground sm:pl-1">
                      {row.jobName}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
