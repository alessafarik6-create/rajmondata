import { DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE } from "@/lib/daily-work-report-job-labor-expenses-constants";
import { COMPANY_DOCUMENT_EXPENSE_SOURCE } from "@/lib/document-job-expense-sync";
import type { JobExpenseRow } from "@/lib/job-expense-types";

export type JobExpenseSourceFilter = "all" | "manual" | "document" | "work_report";

export function jobExpenseSourceTypeLabel(row: JobExpenseRow): string {
  const src = String(row.source ?? "").trim();
  if (src === COMPANY_DOCUMENT_EXPENSE_SOURCE || row.dokladId) return "Doklad";
  if (src === DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE) return "Výkaz práce";
  if (src === "folder_documents") return "Účetní složka";
  return "Ruční záznam";
}

export function jobExpenseMatchesSourceFilter(
  row: JobExpenseRow,
  filter: JobExpenseSourceFilter
): boolean {
  if (filter === "all") return true;
  const src = String(row.source ?? "").trim();
  if (filter === "document") {
    return src === COMPANY_DOCUMENT_EXPENSE_SOURCE || Boolean(row.dokladId);
  }
  if (filter === "work_report") {
    return src === DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE;
  }
  if (filter === "manual") {
    return (
      src !== COMPANY_DOCUMENT_EXPENSE_SOURCE &&
      src !== DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE &&
      !row.dokladId
    );
  }
  return true;
}

export function jobExpenseDateLabelCs(isoDate: string | undefined | null): string {
  const d = String(isoDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || "—";
  const [y, m, day] = d.split("-").map(Number);
  try {
    return new Date(y, m - 1, day).toLocaleDateString("cs-CZ");
  } catch {
    return d;
  }
}

export function jobExpenseSupplierLabel(row: JobExpenseRow): string {
  const src = String(row.source ?? "").trim();
  if (src === DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE) {
    const note = String(row.note ?? "");
    const m = note.match(/výkaz práce · (.+?) ·/i);
    if (m?.[1]?.trim()) return m[1].trim();
    const emp = String(row.sourceEmployeeId ?? "").trim();
    if (emp) return `Zaměstnanec (${emp.slice(0, 8)}…)`;
    return "Zaměstnanec";
  }
  const entity = String((row as Record<string, unknown>).entityName ?? "").trim();
  if (entity) return entity;
  return "";
}

export function jobExpenseDocumentLinkLabel(row: JobExpenseRow): string {
  const dokladId = String(row.dokladId ?? "").trim();
  if (dokladId) return `Doklad ${dokladId.slice(0, 12)}`;
  const fileName = String(row.fileName ?? "").trim();
  if (fileName) return fileName;
  return "";
}

export function jobExpenseDescriptionLabel(row: JobExpenseRow): string {
  const note = String(row.note ?? "").trim();
  if (note) return note;
  const fileName = String(row.fileName ?? "").trim();
  if (fileName) return fileName;
  return "—";
}

export function sortJobExpensesForReport(rows: JobExpenseRow[]): JobExpenseRow[] {
  return [...rows].sort((a, b) => {
    const da = String(a.date ?? "");
    const db = String(b.date ?? "");
    if (da !== db) return da.localeCompare(db);
    return a.id.localeCompare(b.id);
  });
}
