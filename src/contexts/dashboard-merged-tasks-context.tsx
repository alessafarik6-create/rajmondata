"use client";

import React, { createContext, useContext } from "react";
import {
  useDashboardMergedTasks,
  type UseDashboardMergedTasksParams,
} from "@/hooks/use-dashboard-merged-tasks";
import type { DashboardTaskItem } from "@/lib/dashboard-task-items-merge";

type DashboardMergedTasksValue = {
  mergedTasks: DashboardTaskItem[];
  isLoading: boolean;
  jobNameById: Map<string, string>;
};

const DashboardMergedTasksContext = createContext<DashboardMergedTasksValue | null>(
  null
);

export function DashboardMergedTasksProvider(
  props: UseDashboardMergedTasksParams & { children: React.ReactNode }
) {
  const { children, ...params } = props;
  const value = useDashboardMergedTasks(params);
  return (
    <DashboardMergedTasksContext.Provider value={value}>
      {children}
    </DashboardMergedTasksContext.Provider>
  );
}

export function useDashboardMergedTasksContext(): DashboardMergedTasksValue {
  const ctx = useContext(DashboardMergedTasksContext);
  if (!ctx) {
    throw new Error(
      "useDashboardMergedTasksContext musí být uvnitř DashboardMergedTasksProvider"
    );
  }
  return ctx;
}

/** Volitelný kontext — mimo provider vrátí null (widget načte data sám). */
export function useDashboardMergedTasksContextOptional(): DashboardMergedTasksValue | null {
  return useContext(DashboardMergedTasksContext);
}
