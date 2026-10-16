"use client";

import { useMemo } from "react";
import { collection, query, limit } from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { useActiveJobTasksFromJobList } from "@/components/jobs/use-active-job-tasks-from-jobs";
import type { OrganizationTask } from "@/lib/organization-task";
import { organizationTaskOpenForUser } from "@/lib/tasks/organization-task-visibility";
import { buildMergedDashboardTaskItems } from "@/lib/dashboard-task-items-merge";

type JobRef = { id: string; name?: string };

/**
 * Počet nevyřízených úkolů pro badge na mobilním dashboardu.
 * - Vedení / účetní: stejná množina jako {@link DashboardJobTasksWidget} (zakázky + organizace).
 * - Ostatní: stejná logika jako {@link DashboardOpenTasks} (jen org. úkoly + přiřazení).
 */
export function usePortalTasksModuleBadgeCount(opts: {
  companyId: string | null | undefined;
  /** `true` = sloučit úkoly zakázek a organizace (dashboard vedení). */
  mergeJobAndOrgTasks: boolean;
  jobs: JobRef[];
  jobsLoading: boolean;
  todayIso: string;
  employeeId: string | null | undefined;
  userId?: string | null;
  /** Owner / admin / manager / accountant — u org. režimu vidí všechny otevřené úkoly. */
  isPrivileged: boolean;
}): { count: number; isLoading: boolean } {
  const firestore = useFirestore();
  const cid = String(opts.companyId ?? "").trim();

  const jobIds = useMemo(
    () =>
      opts.mergeJobAndOrgTasks
        ? opts.jobs
            .map((j) => String(j?.id ?? "").trim())
            .filter(Boolean)
        : [],
    [opts.jobs, opts.mergeJobAndOrgTasks]
  );

  const { data: jobTasksRows, isLoading: jobTasksLoading } =
    useActiveJobTasksFromJobList(
      firestore,
      cid || undefined,
      jobIds,
      opts.mergeJobAndOrgTasks ? opts.jobsLoading : false
    );

  const orgTasksQuery = useMemoFirebase(() => {
    if (!firestore || !cid) return null;
    return query(collection(firestore, "companies", cid, "tasks"), limit(300));
  }, [firestore, cid]);

  const { data: orgRaw, isLoading: orgLoading } = useCollection(orgTasksQuery);

  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of opts.jobs) {
      m.set(j.id, j.name?.trim() || j.id);
    }
    return m;
  }, [opts.jobs]);

  const count = useMemo(() => {
    if (!cid) return 0;
    if (opts.mergeJobAndOrgTasks) {
      return buildMergedDashboardTaskItems(
        jobTasksRows,
        orgRaw,
        jobNameById,
        opts.todayIso
      ).length;
    }
    const tasksList = Array.isArray(orgRaw) ? orgRaw : [];
    const tasks = tasksList.map(
      (t) => ({ ...t, id: String(t?.id ?? "") }) as OrganizationTask
    );
    const uid = String(opts.userId ?? "").trim();
    if (!uid) return 0;
    const ctx = {
      userId: uid,
      employeeId: opts.employeeId,
      canManageAllTasks: false,
    };
    return tasks.filter((t) => organizationTaskOpenForUser(t, ctx)).length;
  }, [
    cid,
    opts.mergeJobAndOrgTasks,
    opts.todayIso,
    opts.employeeId,
    opts.userId,
    opts.isPrivileged,
    jobTasksRows,
    orgRaw,
    jobNameById,
  ]);

  const isLoading = opts.mergeJobAndOrgTasks
    ? orgLoading || opts.jobsLoading || jobTasksLoading
    : orgLoading;

  return { count, isLoading };
}
