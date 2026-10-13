"use client";

import { useMemo } from "react";
import { collection, limit, query } from "firebase/firestore";
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { useActiveJobTasksFromJobList } from "@/components/jobs/use-active-job-tasks-from-jobs";
import {
  buildMergedDashboardTaskItems,
  type DashboardTaskItem,
} from "@/lib/dashboard-task-items-merge";

type JobRef = { id: string; name?: string };

export type UseDashboardMergedTasksParams = {
  companyId: string;
  allJobs: JobRef[];
  jobsLoading: boolean;
  todayIso: string;
};

/** Sdílené načtení aktivních úkolů (zakázky + organizace) pro dashboard. */
export function useDashboardMergedTasks(params: UseDashboardMergedTasksParams): {
  mergedTasks: DashboardTaskItem[];
  isLoading: boolean;
  jobNameById: Map<string, string>;
} {
  const firestore = useFirestore();
  const cid = String(params.companyId ?? "").trim();

  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of params.allJobs) {
      m.set(j.id, j.name?.trim() || j.id);
    }
    return m;
  }, [params.allJobs]);

  const jobIds = useMemo(
    () => params.allJobs.map((j) => j.id).filter(Boolean),
    [params.allJobs]
  );

  const { data: taskRows, isLoading: jobTasksLoading } = useActiveJobTasksFromJobList(
    firestore,
    cid || undefined,
    jobIds,
    params.jobsLoading
  );

  const orgTasksQuery = useMemoFirebase(() => {
    if (!firestore || !cid) return null;
    return query(collection(firestore, "companies", cid, "tasks"), limit(300));
  }, [firestore, cid]);

  const { data: orgRaw, isLoading: orgTasksLoading } = useCollection(orgTasksQuery);

  const mergedTasks = useMemo(
    () =>
      buildMergedDashboardTaskItems(
        taskRows ?? [],
        orgRaw,
        jobNameById,
        params.todayIso
      ),
    [taskRows, orgRaw, jobNameById, params.todayIso]
  );

  const isLoading = params.jobsLoading || jobTasksLoading || orgTasksLoading;

  return { mergedTasks, isLoading, jobNameById };
}
