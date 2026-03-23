import type { Timestamp } from "firebase/firestore";

export type OrganizationTaskStatus = "open" | "done";

export type OrganizationTask = {
  id: string;
  title: string;
  description?: string;
  status: OrganizationTaskStatus;
  assignedTo: string | null;
  organizationId: string;
  createdBy: string;
  createdAt?: Timestamp | { toDate?: () => Date } | null;
  updatedAt?: Timestamp | { toDate?: () => Date } | null;
  completedAt?: Timestamp | { toDate?: () => Date } | null;
};

export function isTaskOpen(t: { status?: string } | null | undefined): boolean {
  return (t?.status ?? "open") !== "done";
}
