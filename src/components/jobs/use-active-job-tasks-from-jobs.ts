"use client";

import { useEffect, useState, useMemo, useRef, useId } from "react";
import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  type Firestore,
} from "firebase/firestore";
import type { JobTaskRow } from "@/lib/job-task-types";
import {
  isFirestoreIndexError,
  logFirestoreIndexError,
} from "@/firebase/firestore/firestore-query-errors";
import { useFirestoreIndexPendingRegistry } from "@/firebase/firestore/firestore-index-pending-registry";

export type JobTaskWithId = JobTaskRow & { id: string };

/**
 * Aktivní úkoly ze subkolekcí jobs/{jobId}/tasks pro dané jobId.
 * Nahrazuje collectionGroup dotaz (index / pravidla často selžou jinak než přímý path).
 */
export function useActiveJobTasksFromJobList(
  firestore: Firestore | null,
  companyId: string | undefined,
  jobIds: string[],
  /** Dokud true, listenery nespouštět (čekej na načtení seznamu zakázek). */
  jobsListLoading: boolean
): {
  data: JobTaskWithId[] | null;
  isLoading: boolean;
  error: Error | null;
  isIndexPending: boolean;
} {
  const sortedKey = useMemo(
    () =>
      [...new Set(jobIds.map((id) => String(id || "").trim()).filter(Boolean))].sort().join(","),
    [jobIds]
  );

  const [data, setData] = useState<JobTaskWithId[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isIndexPending, setIsIndexPending] = useState(false);
  const indexJobsRef = useRef<Set<string>>(new Set());
  const hookInstanceId = useId();
  const indexRegistry = useFirestoreIndexPendingRegistry();

  useEffect(() => {
    setError(null);
    setIsIndexPending(false);
    indexJobsRef.current.clear();

    const cid = String(companyId ?? "").trim();
    if (!firestore || !cid || jobsListLoading) {
      setData(null);
      setIsLoading(Boolean(firestore && cid && jobsListLoading));
      return;
    }

    const ids = sortedKey
      ? sortedKey.split(",").filter(Boolean)
      : [];

    if (ids.length === 0) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const rowMap = new Map<string, JobTaskWithId>();
    const awaitingFirst = new Set(ids);

    const unsubscribers = ids.map((jobId) => {
      const q = query(
        collection(firestore, "companies", cid, "jobs", jobId, "tasks"),
        where("status", "==", "active"),
        limit(120)
      );

      let first = true;
      return onSnapshot(
        q,
        (snap) => {
          const prefix = `${jobId}::`;
          for (const k of rowMap.keys()) {
            if (k.startsWith(prefix)) rowMap.delete(k);
          }

          for (const docSnap of snap.docs) {
            const raw = docSnap.data() as JobTaskRow;
            const taskScope = raw.taskScope;
            if (taskScope != null && taskScope !== "job") continue;

            const row: JobTaskWithId = {
              ...raw,
              id: docSnap.id,
              jobId: raw.jobId?.trim() ? raw.jobId : jobId,
            };
            rowMap.set(`${jobId}::${docSnap.id}`, row);
          }

          setData(Array.from(rowMap.values()));
          indexJobsRef.current.delete(jobId);
          if (indexJobsRef.current.size === 0) {
            setIsIndexPending(false);
          }
          if (first) {
            first = false;
            awaitingFirst.delete(jobId);
            if (awaitingFirst.size === 0) setIsLoading(false);
          }
        },
        (e) => {
          const path = `companies/${cid}/jobs/${jobId}/tasks`;
          if (isFirestoreIndexError(e)) {
            logFirestoreIndexError(
              "useActiveJobTasksFromJobList",
              path,
              e
            );
            indexJobsRef.current.add(jobId);
            setIsIndexPending(true);
            setError(null);
            setData(null);
          } else {
            console.error("useActiveJobTasksFromJobList", jobId, e);
            setError(e instanceof Error ? e : new Error(String(e)));
          }
          awaitingFirst.delete(jobId);
          if (awaitingFirst.size === 0) setIsLoading(false);
        }
      );
    });

    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, [firestore, companyId, sortedKey, jobsListLoading]);

  const registryKey = `useActiveJobTasks:${hookInstanceId}`;
  useEffect(() => {
    if (!indexRegistry) return;
    if (isIndexPending) {
      indexRegistry.register(registryKey);
    } else {
      indexRegistry.unregister(registryKey);
    }
    return () => {
      indexRegistry.unregister(registryKey);
    };
  }, [isIndexPending, indexRegistry, registryKey]);

  return { data, isLoading, error, isIndexPending };
}
