"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { collection, query, limit, where } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Loader2, ListTodo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { jobTaskPriorityLabel } from "@/lib/job-task-types";
import type { JobTaskPriority } from "@/lib/job-task-types";
import type { OrganizationTask } from "@/lib/organization-task";
import { organizationTaskAssigneeSummaryLabel } from "@/lib/tasks/organization-task-visibility";
import {
  resolveOrgTaskAssigneeLabel,
  buildOrgTaskAssigneeOptions,
} from "@/lib/tasks/organization-task-assignees";
import { markDashboardTaskDone } from "@/lib/dashboard-task-complete-client";
import {
  buildMergedDashboardTaskItems,
  dashboardTaskDueUrgency,
  itemForAll,
  selectMyOpenDashboardTasks,
  type DashboardTaskItem,
} from "@/lib/dashboard-task-items-merge";
import { useDashboardMergedTasksContextOptional } from "@/contexts/dashboard-merged-tasks-context";
import { cn } from "@/lib/utils";

const MAX_VISIBLE = 5;

type Props = {
  companyId: string;
  employeeId: string | null | undefined;
  companyOwnerUid?: string | null;
  todayIso: string;
  /** Na dashboardu vedení — úkoly zakázek + organizace ze sdíleného kontextu. */
  useMergedTasks?: boolean;
};

function formatDueCs(iso: string | undefined, todayIso: string): string {
  if (!iso?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "Bez termínu";
  const due = iso.trim();
  if (due < todayIso) return formatCsDate(due);
  if (due === todayIso) return "Dnes";
  return formatCsDate(due);
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

function assigneeLabelForItem(
  item: DashboardTaskItem,
  formatOne: (ref: string) => string
): string {
  if (item.source === "job") {
    if (itemForAll(item)) return "Všem (zakázka)";
    if (item.assignedTo) return formatOne(item.assignedTo);
    return "—";
  }
  return organizationTaskAssigneeSummaryLabel(
    {
      assignedMode: item.assignedMode,
      assignedTo: item.assignedTo,
      assignedTargets: item.assignedTargets,
    } as OrganizationTask,
    formatOne
  );
}

function detailHref(item: DashboardTaskItem): string {
  if (item.source === "job" && item.jobId?.trim()) {
    return `/portal/jobs/${encodeURIComponent(item.jobId.trim())}`;
  }
  return "/portal/tasks";
}

function urgencyRowClass(urgency: ReturnType<typeof dashboardTaskDueUrgency>): string {
  if (urgency === "overdue") {
    return "border-red-300 bg-red-50/90 text-red-950";
  }
  if (urgency === "soon") {
    return "border-orange-300 bg-orange-50/90 text-orange-950";
  }
  return "border-slate-200 bg-white text-slate-900";
}

export function DashboardOpenTasks({
  companyId,
  employeeId,
  companyOwnerUid,
  todayIso,
  useMergedTasks = false,
}: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const userId = String(user?.uid ?? "").trim();
  const mergedCtx = useDashboardMergedTasksContextOptional();
  const [completingKey, setCompletingKey] = useState<string | null>(null);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "users"),
      where("companyId", "==", companyId),
      limit(300)
    );
  }, [firestore, companyId]);

  const { data: employeesRaw } = useCollection(employeesQuery);
  const { data: usersRaw } = useCollection(usersQuery, {
    suppressGlobalPermissionError: true,
  });

  const assigneeOptions = useMemo(
    () =>
      buildOrgTaskAssigneeOptions({
        users: Array.isArray(usersRaw) ? usersRaw : [],
        employees: Array.isArray(employeesRaw) ? employeesRaw : [],
        companyOwnerUid,
      }),
    [usersRaw, employeesRaw, companyOwnerUid]
  );

  const tasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || useMergedTasks) return null;
    return query(collection(firestore, "companies", companyId, "tasks"), limit(300));
  }, [firestore, companyId, useMergedTasks]);

  const { data: tasksRaw, isLoading: orgOnlyLoading } = useCollection<any>(tasksQuery);

  const myOpenTasks = useMemo(() => {
    if (!userId) return [];
    if (useMergedTasks && mergedCtx) {
      return selectMyOpenDashboardTasks(
        mergedCtx.mergedTasks,
        userId,
        employeeId,
        todayIso
      );
    }
    const tasksList = Array.isArray(tasksRaw) ? tasksRaw : [];
    const merged = buildMergedDashboardTaskItems(
      [],
      tasksList,
      new Map(),
      todayIso
    );
    return selectMyOpenDashboardTasks(merged, userId, employeeId, todayIso);
  }, [
    userId,
    useMergedTasks,
    mergedCtx,
    tasksRaw,
    employeeId,
    todayIso,
  ]);

  const isLoading = useMergedTasks
    ? (mergedCtx?.isLoading ?? true)
    : orgOnlyLoading;

  const formatAssignee = (ref: string) =>
    resolveOrgTaskAssigneeLabel(ref, assigneeOptions);

  const complete = async (item: DashboardTaskItem) => {
    if (!firestore || !companyId || !userId) return;
    setCompletingKey(item.key);
    try {
      await markDashboardTaskDone(firestore, companyId, item, {
        userId,
        employeeId,
      });
      toast({ title: "Úkol označen jako splněný" });
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

  if (!userId) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám úkoly…
      </div>
    );
  }

  if (myOpenTasks.length === 0) return null;

  const visible = myOpenTasks.slice(0, MAX_VISIBLE);
  const total = myOpenTasks.length;

  return (
    <section className="w-full space-y-2" aria-label="Moje úkoly">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Moje úkoly</h2>
        <span className="text-xs text-slate-600">{total} otevřených</span>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {visible.map((item) => {
          const urgency = dashboardTaskDueUrgency(item.dueIso, todayIso);
          const pr = (item.priority as JobTaskPriority) ?? "medium";
          const completing = completingKey === item.key;
          return (
            <li
              key={item.key}
              className={cn(
                "flex flex-col gap-2 border-l-4 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
                urgency === "overdue"
                  ? "border-l-red-500"
                  : urgency === "soon"
                    ? "border-l-orange-500"
                    : "border-l-transparent",
                urgencyRowClass(urgency)
              )}
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-semibold">{item.title}</p>
                <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-700">
                  <span>Termín: {formatDueCs(item.dueIso, todayIso)}</span>
                  <span>·</span>
                  <span>Priorita: {jobTaskPriorityLabel(pr)}</span>
                  <span>·</span>
                  <span>Přiřazení: {assigneeLabelForItem(item, formatAssignee)}</span>
                  <span>·</span>
                  <span>Stav: Otevřený</span>
                </p>
                {item.source === "job" && item.jobName ? (
                  <p className="truncate text-xs text-slate-600">Zakázka: {item.jobName}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" asChild>
                  <Link href={detailHref(item)}>Detail</Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={cn(
                    "h-8 text-xs",
                    urgency === "overdue" && "bg-red-600 hover:bg-red-700 text-white",
                    urgency === "soon" && "bg-orange-600 hover:bg-orange-700 text-white"
                  )}
                  disabled={completing}
                  onClick={() => void complete(item)}
                >
                  {completing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Splněno"
                  )}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {total > MAX_VISIBLE ? (
        <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
          <Link href="/portal/tasks">
            <ListTodo className="mr-1.5 h-4 w-4" />
            Zobrazit všechny úkoly ({total})
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-600" asChild>
          <Link href="/portal/tasks">Přejít na úkoly</Link>
        </Button>
      )}
    </section>
  );
}
