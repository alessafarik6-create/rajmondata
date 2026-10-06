export type ProductionTaskStatus = "new" | "in_progress" | "done";

export type ProductionTaskRow = {
  id: string;
  companyId: string;
  jobId: string;
  name: string;
  description?: string | null;
  status: ProductionTaskStatus;
  active: boolean;
  sortOrder: number;
  publicToken: string;
  plannedMinutes?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ProductionTimeEntrySource = "qr" | "manual";

export type ProductionTimeEndReason =
  | "manual_stop"
  | "switched_task"
  | "attendance_clock_out"
  | "attendance_lunch"
  | "attendance_break"
  | "admin_edit";

export type ProductionTimeEntryRow = {
  id: string;
  companyId: string;
  jobId: string;
  productionTaskId: string;
  employeeId: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  endedReason?: ProductionTimeEndReason | null;
  source: ProductionTimeEntrySource;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ProductionTimeEntryAuditRow = {
  id: string;
  entryId: string;
  companyId: string;
  changedByUserId: string;
  reason?: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt?: string | null;
};
