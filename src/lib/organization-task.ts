import type { Timestamp } from "firebase/firestore";
import type { JobTaskPriority, TaskAssignedMode } from "./job-task-types";

export type OrganizationTaskStatus = "open" | "done";

export type OrganizationTask = {
  id: string;
  title: string;
  description?: string;
  status: OrganizationTaskStatus;
  assignedTo: string | null;
  /** Všem (`all`) nebo konkrétnímu (`single` + assignedTo). */
  assignedMode?: TaskAssignedMode;
  /** YYYY-MM-DD */
  dueDate?: string;
  priority?: JobTaskPriority;
  organizationId: string;
  createdBy: string;
  createdAt?: Timestamp | { toDate?: () => Date } | null;
  updatedAt?: Timestamp | { toDate?: () => Date } | null;
  completedAt?: Timestamp | { toDate?: () => Date } | null;
};

export function isTaskOpen(t: { status?: string } | null | undefined): boolean {
  return (t?.status ?? "open") !== "done";
}

/** Úkol určený všem (nebo legacy bez přiřazení = společný). */
export function organizationTaskIsForAll(t: OrganizationTask): boolean {
  if (t.assignedMode === "all") return true;
  if (t.assignedMode === "single") return false;
  return t.assignedTo == null;
}
