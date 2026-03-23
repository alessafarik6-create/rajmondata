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

/** Pole ID z řetězců nebo z objektů `{ jobId?, id? }` (legacy importy). */
export function parseAssignedJobIdsLoose(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.length > 0) {
      out.push(x);
      continue;
    }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const id = o.jobId ?? o.id;
      if (typeof id === "string" && id.length > 0) out.push(id);
    }
  }
  return out;
}

/** Zakázky pro výkaz práce: nové pole nebo legacy `assignedJobIds`. */
export function parseAssignedWorklogJobIds(employeeData: {
  assignedWorklogJobIds?: unknown;
  assignedJobIds?: unknown;
  /** Další legacy / alternativní názvy v datech */
  jobsIds?: unknown;
  assignedJobs?: unknown;
} | null | undefined): string[] {
  const next = parseAssignedJobIds(employeeData?.assignedWorklogJobIds);
  if (next.length > 0) return next;
  const legacy = parseAssignedJobIds(employeeData?.assignedJobIds);
  if (legacy.length > 0) return legacy;
  const jids = parseAssignedJobIds(employeeData?.jobsIds);
  if (jids.length > 0) return jids;
  const loose = parseAssignedJobIdsLoose(employeeData?.assignedJobs);
  if (loose.length > 0) return loose;
  return [];
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
