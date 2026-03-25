"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { collectionGroup, query, where, limit } from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ListTodo, Briefcase, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JOB_TASK_SCOPE,
  type JobTaskRow,
  jobTaskPriorityLabel,
  jobTaskStatusLabel,
  sortActiveJobTasksForDashboard,
} from "@/lib/job-task-types";

function rowClasses(row: JobTaskRow, todayIso: string): string {
  const due = String(row.dueDate ?? "");
  const overdue = due && due < todayIso;
  const pr = row.priority ?? "low";
  if (overdue) {
    return "border-destructive/40 bg-destructive/10 ring-1 ring-destructive/25";
  }
  if (pr === "high") return "border-red-600/40 bg-red-50/50 dark:bg-red-950/20";
  if (pr === "medium") return "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/15";
  return "border-blue-400/30 bg-blue-50/30 dark:bg-blue-950/15";
}

type JobRef = { id: string; name?: string };

export function DashboardJobTasksWidget({
  companyId,
  jobs,
  todayIso,
}: {
  companyId: string;
  jobs: JobRef[];
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

  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) {
      m.set(j.id, j.name?.trim() || j.id);
    }
    return m;
  }, [jobs]);

  const sorted = useMemo(() => {
    const list = Array.isArray(raw) ? raw : [];
    return sortActiveJobTasksForDashboard(list, todayIso);
  }, [raw, todayIso]);

  if (isLoading) {
    return (
      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Načítám úkoly ze zakázek…
        </CardContent>
      </Card>
    );
  }

  if (sorted.length === 0) {
    return null;
  }

  return (
    <Card className="border-2 border-primary/35 bg-gradient-to-br from-primary/8 to-background shadow-sm">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ListTodo className="h-5 w-5 shrink-0 text-primary" />
          Aktivní úkoly ze zakázek
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          {sorted.length}{" "}
          {sorted.length === 1
            ? "otevřený úkol"
            : sorted.length < 5
              ? "otevřené úkoly"
              : "otevřených úkolů"}{" "}
          — řazeno: po termínu, termín, priorita.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 max-h-[min(22rem,50vh)] overflow-y-auto pr-1">
        <ul className="space-y-2">
          {sorted.map((row) => {
            const jid = row.jobId ?? "";
            const jname = jid ? jobNameById.get(jid) ?? "Zakázka" : "—";
            const overdue =
              row.dueDate && row.dueDate < todayIso ? true : false;
            return (
              <li
                key={`${jid}-${row.id}`}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3",
                  rowClasses(row, todayIso)
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className="font-medium leading-tight truncate"
                    title={row.title}
                  >
                    {row.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Briefcase className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate max-w-[12rem]">{jname}</span>
                    <Badge variant="outline" className="text-[10px] h-5 px-1 font-normal">
                      {row.dueDate ?? "—"}
                      {overdue ? (
                        <span className="text-destructive ml-1 font-semibold">!</span>
                      ) : null}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1 font-normal">
                      {jobTaskPriorityLabel(row.priority)}
                    </Badge>
                    <span className="text-[10px]">{jobTaskStatusLabel(row.status)}</span>
                  </div>
                </div>
                {jid ? (
                  <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs gap-1" asChild>
                    <Link href={`/portal/jobs/${jid}`}>
                      Zakázka
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
