"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  isFirestoreIndexError,
  logFirestoreIndexError,
} from "@/firebase/firestore/firestore-query-errors";
import { chunkArray, parseAssignedWorklogJobIds } from "@/lib/assigned-jobs";

/**
 * Zakázky přiřazené zaměstnanci pro výkaz práce:
 * - `assignedWorklogJobIds` / legacy pole na employees/{id}
 * - zakázky kde `jobs.assignedEmployeeIds` obsahuje employeeId nebo uid uživatele
 * Načítá názvy z `companies/{companyId}/jobs/{id}` nebo z `.../employeeSummary/summary`
 * (režim employeeSummary — bez celého dokumentu zakázky s financemi).
 */
export function useAssignedWorklogJobs(
  firestore: Firestore | null | undefined,
  companyId: string | undefined,
  employeeData: Record<string, unknown> | null | undefined,
  employeeDocLoading: boolean,
  /** UID přihlášeného uživatele (často stejné jako v assignedEmployeeIds na zakázce). */
  userUid?: string | undefined,
  /** ID záznamu zaměstnance v companies/.../employees. */
  employeeId?: string | undefined,
  /** `employeeSummary` pro role employee (bez čtení celého job dokumentu). */
  jobLabelSource: "job" | "employeeSummary" = "job"
): {
  assignedJobIds: string[];
  jobs: { id: string; name?: string }[];
  jobsLoading: boolean;
} {
  const assignedNamesById = useMemo(() => {
    const raw = (employeeData as { assignedWorklogJobsById?: unknown } | null | undefined)
      ?.assignedWorklogJobsById;
    if (!raw || typeof raw !== "object") return new Map<string, string>();
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
        m.set(k.trim(), v.trim());
      }
    }
    return m;
  }, [employeeData]);
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

        const acc: { id: string; name?: string }[] = [];

        if (jobLabelSource === "employeeSummary") {
          for (const jid of allIds) {
            const direct = assignedNamesById.get(jid);
            if (direct) {
              acc.push({ id: jid, name: direct });
              continue;
            }
            try {
              const sref = doc(
                firestore,
                "companies",
                companyId,
                "jobs",
                jid,
                "employeeSummary",
                "summary"
              );
              const snap = await getDoc(sref);
              const nm =
                snap.exists() &&
                typeof (snap.data() as { name?: string }).name === "string"
                  ? String((snap.data() as { name: string }).name).trim()
                  : "";
              if (nm) {
                acc.push({ id: jid, name: nm });
                continue;
              }
              /**
               * Fallback: někdy employeeSummary existuje, ale bez `name` (nebo ještě není synchronizováno).
               * Pokud má zaměstnanec přístup k otevření zakázky, obvykle smí přečíst alespoň základní job doc.
               */
              try {
                const jref = doc(firestore, "companies", companyId, "jobs", jid);
                const js = await getDoc(jref);
                if (!js.exists()) {
                  acc.push({ id: jid, name: "Zakázka nenalezena" });
                } else {
                  const d = js.data() as { name?: unknown; title?: unknown };
                  const label =
                    (typeof d.name === "string" && d.name.trim()) ||
                    (typeof d.title === "string" && d.title.trim()) ||
                    assignedNamesById.get(jid) ||
                    "Zakázka";
                  acc.push({ id: jid, name: String(label).trim() || "Zakázka" });
                }
              } catch {
                // permission denied → nepovažovat za neexistující; použij mapu nebo bezpečný label
                const safe = assignedNamesById.get(jid) || "Zakázka";
                acc.push({ id: jid, name: safe });
              }
            } catch {
              // pokud selže summary, zkusíme ještě job doc (pokud je čitelný)
              try {
                const jref = doc(firestore, "companies", companyId, "jobs", jid);
                const js = await getDoc(jref);
                if (!js.exists()) {
                  acc.push({ id: jid, name: "Zakázka nenalezena" });
                } else {
                  const d = js.data() as { name?: unknown; title?: unknown };
                  const label =
                    (typeof d.name === "string" && d.name.trim()) ||
                    (typeof d.title === "string" && d.title.trim()) ||
                    assignedNamesById.get(jid) ||
                    "Zakázka";
                  acc.push({ id: jid, name: String(label).trim() || "Zakázka" });
                }
              } catch {
                const safe = assignedNamesById.get(jid) || "Zakázka";
                acc.push({ id: jid, name: safe });
              }
            }
          }
        } else {
          const chunks = chunkArray(allIds, 10);
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
        }
        if (!cancelled) {
          // pokud už je jobId v mapě u zaměstnance, upřednostni ho (stabilní label i při omezených právech)
          for (let i = 0; i < acc.length; i++) {
            const r = acc[i];
            if (!r) continue;
            if (!r.name) {
              const direct = assignedNamesById.get(r.id);
              if (direct) acc[i] = { ...r, name: direct };
            }
          }
          acc.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "cs"));
          setJobs(acc);
        }
      } catch (e) {
        if (isFirestoreIndexError(e)) {
          logFirestoreIndexError(
            "useAssignedWorklogJobs",
            `companies/${companyId}/jobs`,
            e
          );
          if (!cancelled) {
            setJobs([]);
            setAllowedJobIds(parseAssignedWorklogJobIds(employeeData).sort());
          }
          return;
        }
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
  }, [
    firestore,
    companyId,
    depsKey,
    employeeDocLoading,
    employeeData,
    userUid,
    employeeId,
    jobLabelSource,
    assignedNamesById,
  ]);

  const assignedJobIds = useMemo(() => {
    if (employeeDocLoading) return [] as string[];
    if (allowedJobIds.length > 0) return allowedJobIds;
    return parseAssignedWorklogJobIds(employeeData).sort();
  }, [employeeDocLoading, allowedJobIds, employeeData]);

  return { assignedJobIds, jobs, jobsLoading };
}
