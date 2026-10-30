import type { Firestore } from "firebase/firestore";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadCsvFromRows } from "@/lib/csv-download";
import {
  formatJobListDate,
  formatIsoDateLabel,
  type JobListRow,
} from "@/lib/job-list-filters";
import { jobStatusLabel } from "@/lib/job-status";
import { resolveJobDisplayNumber } from "@/lib/jobs/job-timeline-utils";
import { resolveJobBudgetFromFirestore, roundMoney2 } from "@/lib/vat-calculations";
import { sumJobExpensesFromFirestore } from "@/lib/pdf/sum-job-expenses-client";

export type JobsAdvancedExportColumnKey =
  | "number"
  | "name"
  | "customer"
  | "phone"
  | "email"
  | "address"
  | "createdAt"
  | "startDate"
  | "endDate"
  | "status"
  | "employees"
  | "budget"
  | "currentPrice"
  | "done"
  | "remaining";

export const JOBS_ADVANCED_EXPORT_COLUMNS: Array<{
  key: JobsAdvancedExportColumnKey;
  label: string;
  finance?: boolean;
  contact?: boolean;
}> = [
  { key: "number", label: "Evidenční číslo" },
  { key: "name", label: "Název zakázky" },
  { key: "customer", label: "Zákazník" },
  { key: "phone", label: "Telefon zákazníka", contact: true },
  { key: "email", label: "E-mail zákazníka", contact: true },
  { key: "address", label: "Adresa realizace" },
  { key: "createdAt", label: "Datum založení" },
  { key: "startDate", label: "Datum zahájení" },
  { key: "endDate", label: "Předpokládané dokončení" },
  { key: "status", label: "Stav zakázky" },
  { key: "employees", label: "Přiřazení zaměstnanci" },
  { key: "budget", label: "Rozpočet", finance: true },
  { key: "currentPrice", label: "Aktuální cena", finance: true },
  { key: "done", label: "Provedeno", finance: true },
  { key: "remaining", label: "Zbývá k fakturaci", finance: true },
];

export type JobsAdvancedExportRow = Record<JobsAdvancedExportColumnKey, string | number>;

export async function buildJobsAdvancedExportRows(params: {
  firestore: Firestore;
  companyId: string;
  jobs: JobListRow[];
  getCustomerName: (id: string | undefined | null) => string;
  getCustomerAddress: (id: string | undefined | null) => string;
  formatEmployeeIds: (ids: string[] | undefined) => string;
  includeFinance: boolean;
  includeContact: boolean;
}): Promise<JobsAdvancedExportRow[]> {
  const rows: JobsAdvancedExportRow[] = [];
  for (const job of params.jobs) {
    const jid = String(job.id ?? "").trim();
    const raw = job as unknown as Record<string, unknown>;
    const phone = String(job.customerPhone ?? raw.customerPhone ?? "").trim();
    const email = String(job.customerEmail ?? raw.customerEmail ?? "").trim();
    const address =
      params.getCustomerAddress(job.customerId) ||
      String(raw.realizationAddress ?? raw.address ?? "").trim();

    let budget = "";
    let current = "";
    let done = "";
    let remaining = "";
    if (params.includeFinance && jid) {
      const bd = resolveJobBudgetFromFirestore(raw);
      const costs = await sumJobExpensesFromFirestore(params.firestore, params.companyId, jid);
      const budgetGross =
        bd?.budgetGross != null && Number.isFinite(Number(bd.budgetGross))
          ? Number(bd.budgetGross)
          : 0;
      const costsGross = Number.isFinite(costs.gross) ? costs.gross : 0;
      budget = budgetGross ? String(roundMoney2(budgetGross)) : "";
      current = budget;
      done = costsGross ? String(roundMoney2(costsGross)) : "";
      remaining =
        budgetGross > 0 ? String(roundMoney2(budgetGross - costsGross)) : "";
    }

    rows.push({
      number: resolveJobDisplayNumber(job) || "",
      name: String(job.name ?? ""),
      customer: String(job.customerName ?? "").trim() || params.getCustomerName(job.customerId),
      phone: params.includeContact ? phone : "",
      email: params.includeContact ? email : "",
      address,
      createdAt: formatJobListDate(job.createdAt),
      startDate: formatIsoDateLabel(job.startDate),
      endDate: formatIsoDateLabel(job.endDate),
      status: jobStatusLabel(job.status),
      employees: params.formatEmployeeIds(job.assignedEmployeeIds),
      budget,
      currentPrice: current,
      done,
      remaining,
    });
  }
  return rows;
}

export function filterExportColumns(
  keys: JobsAdvancedExportColumnKey[],
  opts: { includeFinance: boolean; includeContact: boolean }
): JobsAdvancedExportColumnKey[] {
  const allowed = new Set(
    JOBS_ADVANCED_EXPORT_COLUMNS.filter((c) => {
      if (c.finance && !opts.includeFinance) return false;
      if (c.contact && !opts.includeContact) return false;
      return true;
    }).map((c) => c.key)
  );
  return keys.filter((k) => allowed.has(k));
}

export function exportJobsAdvancedCsv(
  rows: JobsAdvancedExportRow[],
  columnKeys: JobsAdvancedExportColumnKey[],
  fileName: string
): void {
  const labels = columnKeys.map(
    (k) => JOBS_ADVANCED_EXPORT_COLUMNS.find((c) => c.key === k)?.label ?? k
  );
  const body = rows.map((r) => columnKeys.map((k) => String(r[k] ?? "")));
  downloadCsvFromRows([labels, ...body], fileName);
}

export function exportJobsAdvancedXlsx(
  rows: JobsAdvancedExportRow[],
  columnKeys: JobsAdvancedExportColumnKey[],
  fileName: string,
  sheetTitle: string
): void {
  const labels = columnKeys.map(
    (k) => JOBS_ADVANCED_EXPORT_COLUMNS.find((c) => c.key === k)?.label ?? k
  );
  const aoa = [labels, ...rows.map((r) => columnKeys.map((k) => r[k] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle.slice(0, 31));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export function exportJobsAdvancedPdf(
  rows: JobsAdvancedExportRow[],
  columnKeys: JobsAdvancedExportColumnKey[],
  fileName: string,
  title: string,
  companyName: string
): void {
  const labels = columnKeys.map(
    (k) => JOBS_ADVANCED_EXPORT_COLUMNS.find((c) => c.key === k)?.label ?? k
  );
  const body = rows.map((r) => columnKeys.map((k) => String(r[k] ?? "")));
  const landscape = columnKeys.length > 6;
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  doc.setFontSize(14);
  doc.text(companyName, 14, 16);
  doc.setFontSize(11);
  doc.text(title, 14, 24);
  doc.setFontSize(9);
  doc.text(
    `${new Date().toLocaleString("cs-CZ")} · ${rows.length} zakázek`,
    14,
    30
  );
  autoTable(doc, {
    startY: 34,
    head: [labels],
    body,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [234, 88, 12] },
  });
  doc.save(`${fileName}.pdf`);
}

export function printJobsAdvancedHtml(
  rows: JobsAdvancedExportRow[],
  columnKeys: JobsAdvancedExportColumnKey[],
  companyName: string,
  title: string
): void {
  const labels = columnKeys.map(
    (k) => JOBS_ADVANCED_EXPORT_COLUMNS.find((c) => c.key === k)?.label ?? k
  );
  const head = labels.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${columnKeys
          .map((k) => `<td>${escapeHtml(String(r[k] ?? ""))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;padding:16px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#ea580c;color:#fff}</style></head>
<body><h1>${escapeHtml(companyName)}</h1><h2>${escapeHtml(title)}</h2>
<p>${new Date().toLocaleString("cs-CZ")} · ${rows.length} zakázek</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
