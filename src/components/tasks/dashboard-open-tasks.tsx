"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { collection, doc, updateDoc, serverTimestamp, query, limit } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, ListTodo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { OrganizationTask } from "@/lib/organization-task";
import { isTaskOpen } from "@/lib/organization-task";

type Props = {
  companyId: string;
  employeeId: string | null | undefined;
  /** Vedení / účetní — vidí všechny otevřené úkoly */
  isPrivileged: boolean;
};

export function DashboardOpenTasks({
  companyId,
  employeeId,
  isPrivileged,
}: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeesRaw } = useCollection(employeesQuery);
  const employeesList = Array.isArray(employeesRaw) ? employeesRaw : [];

  const employeeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employeesList as {
      id?: string;
      firstName?: string;
      lastName?: string;
    }[]) {
      const id = String(e?.id ?? "");
      if (!id) continue;
      m.set(id, `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || id);
    }
    return m;
  }, [employeesRaw]);

  const tasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "tasks"), limit(300));
  }, [firestore, companyId]);

  const { data: tasksRaw, isLoading } = useCollection<any>(tasksQuery);
  const tasksList = Array.isArray(tasksRaw) ? tasksRaw : [];

  const tasks = useMemo(() => {
    const list = tasksList.map(
      (t) => ({ ...t, id: String(t?.id ?? "") }) as OrganizationTask
    );
    return list.filter((t) => isTaskOpen(t));
  }, [tasksList]);

  const visible = useMemo(() => {
    if (isPrivileged) return tasks;
    const eid = String(employeeId || "").trim();
    if (!eid) return [];
    return tasks.filter(
      (t) => t.assignedTo == null || String(t.assignedTo) === eid
    );
  }, [tasks, isPrivileged, employeeId]);

  const toggle = async (t: OrganizationTask) => {
    if (!user || !companyId) return;
    const eid = String(employeeId || "").trim();
    if (!isPrivileged && String(t.assignedTo) !== eid) {
      toast({
        variant: "destructive",
        title: "Nelze změnit",
        description: "Tento úkol není přiřazen vám.",
      });
      return;
    }
    try {
      await updateDoc(doc(firestore, "companies", companyId, "tasks", t.id), {
        status: "done",
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Stav úkolu se nepodařilo uložit.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám úkoly…
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Aktivní úkoly</h2>
        <Button variant="outline" size="sm" className="gap-1" asChild>
          <Link href="/portal/jobs">
            <ListTodo className="h-4 w-4" />
            Správa úkolů
          </Link>
        </Button>
      </div>
      <ul className="space-y-2">
        {visible.map((t) => (
          <li key={t.id}>
            <Alert className="border-2 border-red-600 bg-red-50 text-red-950 shadow-md dark:border-red-500 dark:bg-red-950/40 dark:text-red-50">
              <ListTodo className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
              <AlertTitle className="text-base font-semibold pr-8">
                {t.title}
              </AlertTitle>
              <AlertDescription className="space-y-2 text-sm font-medium text-red-900 dark:text-red-100">
                {t.description ? (
                  <p className="whitespace-pre-wrap">{t.description}</p>
                ) : null}
                <p className="text-xs font-normal opacity-90">
                  {t.assignedTo
                    ? `Přiřazeno: ${
                        employeeNameById.get(String(t.assignedTo)) ?? t.assignedTo
                      }`
                    : "Bez přiřazení (společný úkol)"}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="bg-white/90 text-red-900 hover:bg-white"
                    onClick={() => void toggle(t)}
                  >
                    Označit jako vyřízené
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </li>
        ))}
      </ul>
    </div>
  );
}
