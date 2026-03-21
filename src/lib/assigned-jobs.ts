/**
 * Přiřazené zakázky zaměstnanci — dokument companies/{companyId}/employees/{id}.
 *
 * Odděleně:
 * - assignedWorklogJobIds (+ legacy assignedJobIds) → výkaz práce
 * - assignedTerminalJobIds → docházkový terminál (příchod/odchod)
 */

export function parseAssignedJobIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** Zakázky pro výkaz práce: nové pole nebo legacy `assignedJobIds`. */
export function parseAssignedWorklogJobIds(employeeData: {
  assignedWorklogJobIds?: unknown;
  assignedJobIds?: unknown;
} | null | undefined): string[] {
  const next = parseAssignedJobIds(employeeData?.assignedWorklogJobIds);
  if (next.length > 0) return next;
  return parseAssignedJobIds(employeeData?.assignedJobIds);
}

/** Zakázky pro docházkový terminál. */
export function parseAssignedTerminalJobIds(employeeData: {
  assignedTerminalJobIds?: unknown;
} | null | undefined): string[] {
  return parseAssignedJobIds(employeeData?.assignedTerminalJobIds);
}

export function isJobIdAssigned(assignedJobIds: string[], jobId: string): boolean {
  if (!jobId) return false;
  return assignedJobIds.includes(jobId);
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
