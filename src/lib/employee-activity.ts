/**
 * Aktivity zaměstnanců pro dashboard (např. odeslání výkazu ke schválení).
 * Záznamy vytváří server (Admin SDK); klient pouze čte a může označit jako vyřízené.
 */

export type EmployeeActivityCategory =
  | "worklog_submitted"
  | "other";

export type EmployeeActivityDoc = {
  organizationId: string;
  employeeUserId: string;
  employeeName?: string | null;
  type: EmployeeActivityCategory;
  /** Doplňková klasifikace (např. worklog_submitted). */
  category?: string;
  title: string;
  message: string;
  jobId?: string | null;
  jobName?: string | null;
  targetLink?: string | null;
  createdAt: unknown;
  resolved?: boolean;
  resolvedAt?: unknown;
  resolvedBy?: string | null;
  /** Volitelná metadata pro rozšíření */
  meta?: Record<string, unknown>;
};

export function isEmployeeActivityUnresolved(
  data: Partial<EmployeeActivityDoc> | Record<string, unknown>
): boolean {
  return data.resolved !== true;
}
