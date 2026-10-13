"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, ExternalLink } from "lucide-react";
import { collection } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDashboardMergedTasksContext } from "@/contexts/dashboard-merged-tasks-context";
import {
  personalTaskDueBucket,
  sortPersonalAssignedTasks,
  taskAssignedToEmployee,
  type DashboardTaskItem,
} from "@/lib/dashboard-task-items-merge";
import { markDashboardTaskDone } from "@/lib/dashboard-task-complete-client";

const MAX_VISIBLE = 5;

function formatDueLabel(dueIso: string | undefined, todayIso: string): string {
  if (!dueIso?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dueIso.trim())) {
    return "Bez termínu";
  }
  const due = dueIso.trim();
  if (due < todayIso) {
    return `Po termínu (${formatCsDate(due)})`;
  }
  if (due === todayIso) return "Dnes";
  const tomorrow = addDaysIso(todayIso, 1);
  if (due === tomorrow) return "Zítra";
  return formatCsDate(due);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatCsDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).format(new Date(y, m - 1, d));
  } catch {
    return iso;
  }
}

function resolveCreatorLabel(
  createdBy: string | null | undefined,
  authUserToName: Map<string, string>
): string {
  const uid = String(createdBy ?? "").trim();
  if (!uid) return "Vedení";
  return authUserToName.get(uid) ?? "Vedení";
}

function PersonalTaskAlertRow(props: {
  item: DashboardTaskItem;
  todayIso: string;
  assignerLabel: string;
  completing: boolean;
  onComplete: () => void;
}) {
  const { item, todayIso, assignerLabel, completing, onComplete } = props;
  const bucket = personalTaskDueBucket(item.dueIso, todayIso);
  const overdue = bucket === "overdue";

  return (
    <article
      className={cn(
        "rounded-lg border-2 bg-red-50 px-4 py-3 text-red-950 shadow-sm",
        overdue
          ? "rajmon-personal-task-alert rajmon-personal-task-alert--overdue border-red-700 bg-red-100/95 shadow-md"
          : "rajmon-personal-task-alert border-red-500"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle
              className={cn(
                "h-5 w-5 shrink-0 text-red-600 rajmon-personal-task-alert-icon",
                overdue && "text-red-800"
              )}
              aria-hidden
            />
            <p className="text-sm font-bold uppercase tracking-wide text-red-800">
              {overdue ? "Úkol po termínu — vyžaduje pozornost" : "Úkol pro vás — vyžaduje pozornost"}
            </p>
          </div>
          <p className="text-base font-semibold text-red-950">
            <span className="font-bold">Úkol:</span> {item.title}
          </p>
          {item.note ? (
            <p className="text-sm text-red-900/90 line-clamp-2">{item.note}</p>
          ) : null}
          {item.source === "job" && item.jobName ? (
            <p className="text-xs text-red-800/80">Zakázka: {item.jobName}</p>
          ) : null}
          <p className="text-sm text-red-900">
            <span className="font-semibold">Termín:</span> {formatDueLabel(item.dueIso, todayIso)}
          </p>
          <p className="text-sm text-red-900">
            <span className="font-semibold">Přidělil:</span> {assignerLabel}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-10 border border-red-200 bg-white text-red-900 hover:bg-red-50"
            asChild
          >
            <Link href="/portal/tasks">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Otevřít úkol
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            className="min-h-10 bg-red-700 text-white hover:bg-red-800"
            disabled={completing}
            onClick={() => onComplete()}
          >
            {completing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" />
            )}
            Označit jako hotové
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Výrazná upozornění na osobní přidělené úkoly (desktop, pod AI sekretářkou). */
export function DashboardPersonalTaskAlerts(props: {
  companyId: string;
  employeeId: string | null | undefined;
  todayIso: string;
}) {
  const { companyId, employeeId, todayIso } = props;
  const firestore = useFirestore();
  const { toast } = useToast();
  const eid = String(employeeId ?? "").trim();
  const [completingKey, setCompletingKey] = useState<string | null>(null);

  const { mergedTasks, isLoading } = useDashboardMergedTasksContext();

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeesRaw } = useCollection(employeesQuery);

  const authUserToName = useMemo(() => {
    const m = new Map<string, string>();
    const list = Array.isArray(employeesRaw) ? employeesRaw : [];
    for (const row of list as {
      authUserId?: string;
      firstName?: string;
      lastName?: string;
    }[]) {
      const uid = String(row.authUserId ?? "").trim();
      if (!uid) continue;
      const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
      m.set(uid, name || "Vedení");
    }
    return m;
  }, [employeesRaw]);

  const personalTasks = useMemo(() => {
    if (!eid) return [];
    const mine = mergedTasks.filter((t) => taskAssignedToEmployee(t, eid));
    return sortPersonalAssignedTasks(mine, todayIso);
  }, [mergedTasks, eid, todayIso]);

  const visible = personalTasks.slice(0, MAX_VISIBLE);
  const hasMore = personalTasks.length > MAX_VISIBLE;

  const handleComplete = async (item: DashboardTaskItem) => {
    if (!firestore || !companyId) return;
    setCompletingKey(item.key);
    try {
      await markDashboardTaskDone(firestore, companyId, item);
      toast({ title: "Úkol označen jako hotový" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Stav úkolu se nepodařilo uložit.",
      });
    } finally {
      setCompletingKey(null);
    }
  };

  if (!eid) return null;
  if (isLoading) return null;
  if (personalTasks.length === 0) return null;

  return (
    <section
      className="hidden lg:block w-full max-w-5xl space-y-3"
      aria-label="Úkoly pro vás"
    >
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-700">
        <span aria-hidden>🔴</span>
        Úkoly pro vás
      </h2>
      <ul className="space-y-3">
        {visible.map((item) => (
          <li key={item.key} className="list-none">
            <PersonalTaskAlertRow
              item={item}
              todayIso={todayIso}
              assignerLabel={resolveCreatorLabel(item.createdBy, authUserToName)}
              completing={completingKey === item.key}
              onComplete={() => void handleComplete(item)}
            />
          </li>
        ))}
      </ul>
      {hasMore ? (
        <Button variant="outline" size="sm" className="border-red-300 text-red-800" asChild>
          <Link href="/portal/tasks">Zobrazit všechny úkoly ({personalTasks.length})</Link>
        </Button>
      ) : null}
    </section>
  );
}
