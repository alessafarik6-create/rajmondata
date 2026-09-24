import type { Firestore } from "firebase/firestore";
import { downloadCsvFromRows } from "@/lib/csv-download";
import type { JobListRow } from "@/lib/job-list-filters";
import {
  isActiveJobStatus,
  isCompletedJobStatus,
  jobStatusLabel,
} from "@/lib/job-status";
import { isJobOpenForDeadlineWidget, parseJobDeadlineLocalDay } from "@/lib/dashboard-deadline-jobs";
import {
  exportJobsToPdf,
  fetchImageAsDataUrl,
  type JobPdfExportRow,
} from "@/lib/pdf/exportJobsToPdf";
import { resolveJobBudgetFromFirestore } from "@/lib/vat-calculations";
import { sumJobExpensesFromFirestore } from "@/lib/pdf/sum-job-expenses-client";
import { roundMoney2 } from "@/lib/vat-calculations";

export type JobsListExportPreset =
  | "current"
  | "overdue"
  | "active"
  | "completed"
  | "by_customer";

export function filterJobsForExportPreset(
  jobs: JobListRow[],
  preset: JobsListExportPreset
): JobListRow[] {
  if (preset === "current") return jobs;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === "active") {
    return jobs.filter((j) => isActiveJobStatus(j.status));
  }
  if (preset === "completed") {
    return jobs.filter((j) => isCompletedJobStatus(j.status));
  }
  if (preset === "overdue") {
    return jobs.filter((j) => {
      if (!isJobOpenForDeadlineWidget({ status: j.status })) return false;
      const end = parseJobDeadlineLocalDay(String(j.endDate ?? ""));
      if (!end) return false;
      end.setHours(0, 0, 0, 0);
      return end.getTime() < today.getTime();
    });
  }
  return jobs;
}

export function sortJobsForExportPreset(
  jobs: JobListRow[],
  preset: JobsListExportPreset,
  getCustomerName: (id: string | undefined | null) => string
): JobListRow[] {
  const list = [...jobs];
  if (preset === "by_customer") {
    list.sort((a, b) =>
      getCustomerName(a.customerId).localeCompare(getCustomerName(b.customerId), "cs")
    );
  }
  return list;
}

export async function buildJobPdfExportRows(
  firestore: Firestore,
  companyId: string,
  jobs: JobListRow[],
  getCustomerName: (id: string | undefined | null) => string
): Promise<JobPdfExportRow[]> {
  const rows: JobPdfExportRow[] = [];
  for (const job of jobs) {
    const jid = job?.id;
    if (!jid) continue;
    const raw = job as unknown as Record<string, unknown>;
    const bd = resolveJobBudgetFromFirestore(raw);
    const costs = await sumJobExpensesFromFirestore(firestore, companyId, jid);
    const budgetRaw = bd?.budgetGross;
    const budgetGross =
      budgetRaw != null && Number.isFinite(Number(budgetRaw)) ? Number(budgetRaw) : 0;
    const costsGross = Number.isFinite(costs.gross) ? costs.gross : 0;
    const remainingGross =
      bd != null && budgetRaw != null && Number.isFinite(Number(budgetRaw))
        ? roundMoney2(Number(budgetRaw) - costsGross)
        : 0;
    const periodParts = [
      job?.startDate ? `Zahájení: ${job.startDate}` : "",
      job?.endDate ? `Dokončení: ${job.endDate}` : "",
    ].filter(Boolean);
    rows.push({
      jobName: String(job?.name ?? "—"),
      customer: getCustomerName(job?.customerId),
      statusLabel: jobStatusLabel(job?.status),
      budgetGross,
      costsGross,
      remainingGross,
      vatPercentLabel: bd ? `${bd.vatRate} %` : "0 %",
      periodLabel: periodParts.length ? periodParts.join(" · ") : "—",
    });
  }
  return rows;
}

export function exportJobsListCsv(
  jobs: JobListRow[],
  getCustomerName: (id: string | undefined | null) => string,
  fileName: string
): void {
  const head = [
    "Zakázka",
    "Zákazník",
    "Stav",
    "Zahájení",
    "Dokončení",
    "Štítek",
  ];
  const body = jobs.map((j) => [
    String(j.name ?? "—"),
    getCustomerName(j.customerId),
    jobStatusLabel(j.status),
    String(j.startDate ?? ""),
    String(j.endDate ?? ""),
    String(j.jobTag ?? ""),
  ]);
  downloadCsvFromRows([head, ...body], fileName);
}

export function printJobsListHtml(
  jobs: JobListRow[],
  getCustomerName: (id: string | undefined | null) => string,
  companyName: string,
  title: string
): void {
  const rows = jobs
    .map(
      (j) =>
        `<tr><td>${escapeHtml(String(j.name ?? "—"))}</td><td>${escapeHtml(getCustomerName(j.customerId))}</td><td>${escapeHtml(jobStatusLabel(j.status))}</td><td>${escapeHtml(String(j.endDate ?? "—"))}</td></tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;padding:16px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#ea580c;color:#fff}</style></head>
<body><h1>${escapeHtml(companyName)}</h1><h2>${escapeHtml(title)}</h2>
<p>Datum: ${new Date().toLocaleString("cs-CZ")} · Počet: ${jobs.length}</p>
<table><thead><tr><th>Zakázka</th><th>Zákazník</th><th>Stav</th><th>Termín</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
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

export async function exportJobsListPdfBundle(params: {
  firestore: Firestore;
  companyId: string;
  jobs: JobListRow[];
  getCustomerName: (id: string | undefined | null) => string;
  companyName: string;
  logoUrl?: string | null;
  fileName: string;
  reportTitle?: string;
}): Promise<void> {
  const logoDataUrl =
    params.logoUrl && params.logoUrl.trim()
      ? await fetchImageAsDataUrl(params.logoUrl.trim())
      : null;
  const rows = await buildJobPdfExportRows(
    params.firestore,
    params.companyId,
    params.jobs,
    params.getCustomerName
  );
  await exportJobsToPdf({
    jobs: rows,
    companyName: params.companyName || "Organizace",
    logoDataUrl,
    fileName: params.fileName,
  });
}
