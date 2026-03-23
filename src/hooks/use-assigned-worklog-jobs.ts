"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { chunkArray, parseAssignedWorklogJobIds } from "@/lib/assigned-jobs";

/**
 * Zakázky přiřazené zaměstnanci pro výkaz práce (`assignedWorklogJobIds` / legacy `assignedJobIds`).
 * Načítá názvy z `companies/{companyId}/jobs` — nezávisle na terminálu docházky.
 */
export function useAssignedWorklogJobs(
  firestore: Firestore | null | undefined,
  companyId: string | undefined,
  employeeData: Record<string, unknown> | null | undefined,
  employeeDocLoading: boolean
): {
  assignedJobIds: string[];
  jobs: { id: string; name?: string }[];
  jobsLoading: boolean;
} {
  const assignedJobIdsKey = useMemo(() => {
    if (employeeDocLoading) return "__loading__";
    return parseAssignedWorklogJobIds(employeeData).slice().sort().join("|");
  }, [employeeData, employeeDocLoading]);

  const assignedJobIds = useMemo(() => {
    if (employeeDocLoading) return [] as string[];
    return parseAssignedWorklogJobIds(employeeData);
  }, [employeeData, employeeDocLoading]);

  const [jobs, setJobs] = useState<{ id: string; name?: string }[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    if (!firestore || !companyId) {
      setJobs([]);
      setJobsLoading(false);
      return;
    }
    if (employeeDocLoading) {
      setJobsLoading(true);
      return;
    }
    if (assignedJobIds.length === 0) {
      setJobs([]);
      setJobsLoading(false);
      return;
    }

    let cancelled = false;
    setJobsLoading(true);
    void (async () => {
      try {
        const chunks = chunkArray(assignedJobIds, 10);
        const acc: { id: string; name?: string }[] = [];
        for (const chunk of chunks) {
          const q = query(
            collection(firestore, "companies", companyId, "jobs"),
            where(documentId(), "in", chunk)
          );
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data() as { name?: string; title?: string };
            const label =
              (typeof data.name === "string" && data.name.trim()) ||
              (typeof data.title === "string" && data.title.trim()) ||
              undefined;
            acc.push({ id: d.id, name: label });
          });
        }
        if (!cancelled) {
          acc.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "cs"));
          setJobs(acc);
        }
      } catch (e) {
        console.error("[useAssignedWorklogJobs]", e);
        if (!cancelled) setJobs([]);
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, assignedJobIdsKey, employeeDocLoading]);

  return { assignedJobIds, jobs, jobsLoading };
}
