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
 * Zakázky přiřazené zaměstnanci pro výkaz práce:
 * - `assignedWorklogJobIds` / legacy pole na employees/{id}
 * - zakázky kde `jobs.assignedEmployeeIds` obsahuje employeeId nebo uid uživatele
 * Načítá názvy z `companies/{companyId}/jobs` — nezávisle na terminálu docházky.
 */
export function useAssignedWorklogJobs(
  firestore: Firestore | null | undefined,
  companyId: string | undefined,
  employeeData: Record<string, unknown> | null | undefined,
  employeeDocLoading: boolean,
  /** UID přihlášeného uživatele (často stejné jako v assignedEmployeeIds na zakázce). */
  userUid?: string | undefined,
  /** ID záznamu zaměstnance v companies/.../employees. */
  employeeId?: string | undefined
): {
  assignedJobIds: string[];
  jobs: { id: string; name?: string }[];
  jobsLoading: boolean;
} {
  const depsKey = useMemo(() => {
    if (employeeDocLoading) return "__loading__";
    return [
      parseAssignedWorklogJobIds(employeeData).slice().sort().join("|"),
      userUid ?? "",
      employeeId ?? "",
    ].join("::");
  }, [employeeData, employeeDocLoading, userUid, employeeId]);

  const [jobs, setJobs] = useState<{ id: string; name?: string }[]>([]);
  const [allowedJobIds, setAllowedJobIds] = useState<string[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    if (!firestore || !companyId) {
      setJobs([]);
      setAllowedJobIds([]);
      setJobsLoading(false);
      return;
    }
    if (employeeDocLoading) {
      setJobsLoading(true);
      return;
    }

    let cancelled = false;
    setJobsLoading(true);
    void (async () => {
      try {
        const jobsCol = collection(firestore, "companies", companyId, "jobs");
        const idSet = new Set<string>(parseAssignedWorklogJobIds(employeeData));

        if (employeeId) {
          const qEmp = query(
            jobsCol,
            where("assignedEmployeeIds", "array-contains", employeeId)
          );
          const snapEmp = await getDocs(qEmp);
          snapEmp.forEach((d) => idSet.add(d.id));
        }
        if (userUid && userUid !== employeeId) {
          const qUid = query(
            jobsCol,
            where("assignedEmployeeIds", "array-contains", userUid)
          );
          const snapUid = await getDocs(qUid);
          snapUid.forEach((d) => idSet.add(d.id));
        }

        const sortedIds = [...idSet].sort((a, b) => a.localeCompare(b));
        if (!cancelled) setAllowedJobIds(sortedIds);

        const allIds = sortedIds;
        if (allIds.length === 0) {
          if (!cancelled) {
            setJobs([]);
            setJobsLoading(false);
          }
          return;
        }

        const chunks = chunkArray(allIds, 10);
        const acc: { id: string; name?: string }[] = [];
        for (const chunk of chunks) {
          const q = query(jobsCol, where(documentId(), "in", chunk));
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
        if (!cancelled) {
          setJobs([]);
          setAllowedJobIds(parseAssignedWorklogJobIds(employeeData).sort());
        }
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, depsKey, employeeDocLoading, employeeData, userUid, employeeId]);

  const assignedJobIds = useMemo(() => {
    if (employeeDocLoading) return [] as string[];
    if (allowedJobIds.length > 0) return allowedJobIds;
    return parseAssignedWorklogJobIds(employeeData).sort();
  }, [employeeDocLoading, allowedJobIds, employeeData]);

  return { assignedJobIds, jobs, jobsLoading };
}
