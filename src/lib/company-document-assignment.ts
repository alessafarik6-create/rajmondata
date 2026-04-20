/**
 * Jednotná logika zařazení firemního dokladu (companies/.../documents).
 * Zdroj pravdy pro vazbu na zakázku: jobId, zakazkaId nebo assignedTo.jobId.
 * Rozdělení nákladu: jobCostAllocations / allocationJobIds.
 */

import {
  allocationJobIdsFromRows,
  resolveJobCostAllocationsFromDocument,
} from "@/lib/company-document-job-allocations";

export type CompanyDocumentAssignmentLike = {
  jobId?: string | null;
  zakazkaId?: string | null;
  assignedTo?: { jobId?: string | null } | null;
  assignmentType?: string | null;
  unassigned?: boolean | null;
  classificationStatus?: string | null;
  jobCostAllocations?: unknown;
  jobCostAllocationMode?: string | null;
  /** Zrcadlo k `jobCostAllocationMode`. */
  allocationMode?: string | null;
  /** Zrcadlo / zjednodušený zápis k `jobCostAllocations`. */
  allocations?: unknown;
  allocationJobIds?: unknown;
};

/** Všechny zakázky, na které doklad alokuje náklad (bez režie). */
export function documentLinkedJobIds(
  row: CompanyDocumentAssignmentLike
): string[] {
  const raw = row.allocationJobIds;
  if (Array.isArray(raw)) {
    const ids = raw
      .map((x) => String(x).trim())
      .filter(Boolean);
    if (ids.length) return [...new Set(ids)];
  }
  const { rows } = resolveJobCostAllocationsFromDocument(row);
  return allocationJobIdsFromRows(rows);
}

/** Filtr tabulky dokladů podle zakázky — primární vazba nebo libovolná alokace. */
export function companyDocumentMatchesJobFilterRow(
  row: CompanyDocumentAssignmentLike,
  jobId: string
): boolean {
  const j = jobId.trim();
  if (!j) return true;
  if (documentLinkedJobIds(row).includes(j)) return true;
  return documentJobLinkId(row) === j;
}

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

/**
 * Filt „Zařazené“ v seznamu dokladů: vazba na zakázku, explicitně přiřazený stav,
 * nebo zařazení mimo zakázku (sklad / firma / režijní).
 */
export function companyDocumentMatchesAssignedJobFilter(
  row: CompanyDocumentAssignmentLike
): boolean {
  if (documentJobLinkId(row)) return true;
  if (row.unassigned === false) return true;
  if (row.classificationStatus === "assigned") return true;
  const at = row.assignmentType;
  if (at === "warehouse" || at === "company" || at === "overhead") return true;
  return false;
}

/** Komplement k {@link companyDocumentMatchesAssignedJobFilter} (včetně starých záznamů bez `unassigned`). */
export function companyDocumentMatchesUnassignedJobFilter(
  row: CompanyDocumentAssignmentLike
): boolean {
  return !companyDocumentMatchesAssignedJobFilter(row);
}
