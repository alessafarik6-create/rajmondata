"use client";

import { useMemo } from "react";
import { collection } from "firebase/firestore";
import { useCollection, useMemoFirebase, useFirestore } from "@/firebase";
import {
  filterActiveEmployees,
  filterEmployeesForAssignment,
  type EmployeeActiveFields,
} from "@/lib/employee-active";

export type UseCompanyEmployeesOptions = {
  /** Výchozí true — pouze aktivní. Pro správu zaměstnanců nastav false. */
  activeOnly?: boolean;
  /** Při activeOnly — ponechat tyto ID ve výsledku (historický výběr). */
  alsoIncludeIds?: Iterable<string | null | undefined>;
};

export function useCompanyEmployees(
  companyId: string | null | undefined,
  options: UseCompanyEmployeesOptions = {}
) {
  const { activeOnly = true, alsoIncludeIds } = options;
  const firestore = useFirestore();

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeesRaw, isLoading, error } = useCollection(employeesQuery);

  const allEmployees = useMemo(() => {
    const raw = Array.isArray(employeesRaw) ? employeesRaw : [];
    return raw.map((e) => ({
      ...(e as EmployeeActiveFields),
      id: String((e as { id?: string }).id ?? ""),
    }));
  }, [employeesRaw]);

  const activeEmployees = useMemo(
    () => filterActiveEmployees(allEmployees),
    [allEmployees]
  );

  const employees = useMemo(() => {
    if (!activeOnly) return allEmployees;
    if (alsoIncludeIds) {
      return filterEmployeesForAssignment(allEmployees, { alsoIncludeIds });
    }
    return activeEmployees;
  }, [activeOnly, allEmployees, activeEmployees, alsoIncludeIds]);

  const employeesById = useMemo(() => {
    const m = new Map<string, EmployeeActiveFields & { id: string }>();
    for (const e of allEmployees) {
      if (e.id) m.set(e.id, e);
    }
    return m;
  }, [allEmployees]);

  return {
    employees,
    allEmployees,
    activeEmployees,
    employeesById,
    isLoading,
    error,
  };
}
