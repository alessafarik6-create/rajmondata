"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { collection, query, limit, where } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Loader2, ListTodo, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { OrganizationTask } from "@/lib/organization-task";
import { jobTaskPriorityLabel } from "@/lib/job-task-types";
import type { JobTaskPriority } from "@/lib/job-task-types";
import {
  organizationTaskAssigneeSummaryLabel,
  organizationTaskOpenForUser,
} from "@/lib/tasks/organization-task-visibility";
import {
  resolveOrgTaskAssigneeLabel,
  buildOrgTaskAssigneeOptions,
} from "@/lib/tasks/organization-task-assignees";
import { setOrganizationTaskCompletionForUser } from "@/lib/tasks/organization-task-completion";
import { personalTaskDueBucket } from "@/lib/dashboard-task-items-merge";
import { cn } from "@/lib/utils";

type Props = {
  companyId: string;
  employeeId: string | null | undefined;
  /** Nepoužívá se pro filtrování — blok vždy zobrazuje „Moje úkoly“. */
  isPrivileged?: boolean;
  companyOwnerUid?: string | null;
};

function formatDueCs(iso: string | undefined, todayIso: string): string {
  if (!iso?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "Bez termínu";
  const due = iso.trim();
  if (due < todayIso) return `Po termínu (${formatCsDate(due)})`;
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

function todayPragueYmd(): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function DashboardOpenTasks({
  companyId,
  employeeId,
  companyOwnerUid,
}: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const todayIso = todayPragueYmd();
  const userId = String(user?.uid ?? "").trim();

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
    [usersRaw, employeesRaw, companyId, companyOwnerUid]
  );

  const tasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "tasks"), limit(300));
  }, [firestore, companyId]);

  const { data: tasksRaw, isLoading } = useCollection<any>(tasksQuery);
  const tasksList = Array.isArray(tasksRaw) ? tasksRaw : [];

  const viewerCtx = useMemo(
    () => ({
      userId,
      employeeId,
      canManageAllTasks: false,
    }),
    [userId, employeeId]
  );

  const myOpenTasks = useMemo(() => {
    if (!userId) return [];
    const list = tasksList.map(
      (t) => ({ ...t, id: String(t?.id ?? "") }) as OrganizationTask
    );
    return list
      .filter((t) => organizationTaskOpenForUser(t, viewerCtx))
      .sort((a, b) => {
        const ba = personalTaskDueBucket(a.dueDate, todayIso);
        const bb = personalTaskDueBucket(b.dueDate, todayIso);
        const rank = { overdue: 0, today: 1, upcoming: 2, none: 3 };
        if (rank[ba] !== rank[bb]) return rank[ba] - rank[bb];
        return String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999"));
      });
  }, [tasksList, viewerCtx, userId, todayIso]);

  const toggle = async (t: OrganizationTask) => {
    if (!user || !companyId) return;
    try {
      await setOrganizationTaskCompletionForUser(
        firestore,
        companyId,
        t,
        viewerCtx,
        true
      );
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Stav úkolu se nepodařilo uložit.",
      });
    }
  };

  if (!userId) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám úkoly…
      </div>
    );
  }

  if (myOpenTasks.length === 0) return null;

  const formatAssignee = (ref: string) =>
    resolveOrgTaskAssigneeLabel(ref, assigneeOptions);

  return (
    <section className="space-y-3" aria-label="Moje úkoly">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Moje úkoly</h2>
        <Button variant="outline" size="sm" className="gap-1" asChild>
          <Link href="/portal/tasks">
            <ListTodo className="h-4 w-4" />
            Všechny úkoly
          </Link>
        </Button>
      </div>
      <ul className="space-y-2">
        {myOpenTasks.map((t) => {
          const bucket = personalTaskDueBucket(t.dueDate, todayIso);
          const overdue = bucket === "overdue";
          const pr = (t.priority as JobTaskPriority) ?? "medium";
          return (
            <li key={t.id}>
              <div
                className={cn(
                  "rounded-lg border px-4 py-3 shadow-sm",
                  overdue
                    ? "border-red-400 bg-red-50 text-red-950"
                    : "border-slate-200 bg-white text-slate-900"
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    {overdue ? (
                      <p className="text-xs font-semibold uppercase text-red-700">
                        Po termínu
                      </p>
                    ) : null}
                    <p className="font-semibold">{t.title}</p>
                    {t.description ? (
                      <p className="text-sm text-slate-700 line-clamp-2 whitespace-pre-wrap">
                        {t.description}
                      </p>
                    ) : null}
                    <p className="text-xs text-slate-600">
                      Termín: {formatDueCs(t.dueDate, todayIso)} · Priorita:{" "}
                      {jobTaskPriorityLabel(pr)} · Stav: Otevřený
                    </p>
                    <p className="text-xs text-slate-600">
                      Přiřazení:{" "}
                      {organizationTaskAssigneeSummaryLabel(t, formatAssignee)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" asChild>
                      <Link href="/portal/tasks">
                        <ExternalLink className="mr-1 h-4 w-4" />
                        Detail
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className={overdue ? "bg-red-700 hover:bg-red-800 text-white" : undefined}
                      onClick={() => void toggle(t)}
                    >
                      Splněno
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
