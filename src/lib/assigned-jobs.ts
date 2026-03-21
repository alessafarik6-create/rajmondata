/**
 * Přiřazené zakázky zaměstnanci — pole assignedJobIds na companies/{companyId}/employees/{id}.
 */

export function parseAssignedJobIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
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
