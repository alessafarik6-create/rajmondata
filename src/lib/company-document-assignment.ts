/**
 * Jednotná logika zařazení firemního dokladu (companies/.../documents).
 * Zdroj pravdy pro vazbu na zakázku: jobId, zakazkaId nebo assignedTo.jobId.
 */

export type CompanyDocumentAssignmentLike = {
  jobId?: string | null;
  zakazkaId?: string | null;
  assignedTo?: { jobId?: string | null } | null;
  assignmentType?: string | null;
};

export function documentJobLinkId(row: CompanyDocumentAssignmentLike): string {
  for (const p of [row.jobId, row.zakazkaId, row.assignedTo?.jobId]) {
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return "";
}

/** Text štítku v seznamu dokladů (Zakázka / Sklad / Firma / Nezařazeno). */
export function resolveDocumentAssignmentBadge(
  row: CompanyDocumentAssignmentLike
): string {
  const at = row.assignmentType;
  if (at === "warehouse") return "Sklad";
  if (at === "company" || at === "overhead") return "Firma";
  if (at === "job_cost" || documentJobLinkId(row)) return "Zakázka";
  return "Nezařazeno";
}

/**
 * Doklad je opravdu „čeká na zařazení“ jen když nemá žádnou vazbu na zakázku,
 * i když ve Firestore zůstalo assignmentType === "pending_assignment" (legacy).
 */
export function documentShowsAsPendingAssignment(
  row: CompanyDocumentAssignmentLike
): boolean {
  if (row.assignmentType !== "pending_assignment") return false;
  return !documentJobLinkId(row);
}

export type CompanyDocumentEditAssignmentType =
  | "job_cost"
  | "company"
  | "warehouse"
  | "overhead"
  | "pending_assignment";

/** Výchozí typ v dialogu úpravy / přiřazení podle uložených dat a vazby. */
export function effectiveCompanyDocumentAssignmentTypeForForm(
  row: CompanyDocumentAssignmentLike
): CompanyDocumentEditAssignmentType {
  const link = documentJobLinkId(row);
  const at = row.assignmentType;
  if (at === "warehouse") return "warehouse";
  if (at === "company") return "company";
  if (at === "overhead") return "overhead";
  if (at === "job_cost") return "job_cost";
  if (link) return "job_cost";
  return "pending_assignment";
}
