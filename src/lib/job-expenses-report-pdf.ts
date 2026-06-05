/**
 * HTML report „Výpočet nákladů / položkový rozpočet zakázky“ (A4).
 */

import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { escapeHtml, withLineBreaks } from "@/lib/work-contract-print-html";
import {
  jobExpenseDateLabelCs,
  jobExpenseDescriptionLabel,
  jobExpenseDocumentLinkLabel,
  jobExpenseSourceTypeLabel,
  jobExpenseSupplierLabel,
  sortJobExpensesForReport,
} from "@/lib/job-expense-display";
import type { JobExpenseRow } from "@/lib/job-expense-types";
import {
  resolveExpenseAmounts,
  roundMoney2,
  type JobBudgetBreakdown,
  VAT_RATE_OPTIONS,
} from "@/lib/vat-calculations";

const REPORT_CSS = `
  :root { --ink: #0a0a0a; --muted: #404040; --border: #bdbdbd; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: var(--ink); background: #fff; }
  .sheet { max-width: 800px; margin: 0 auto; padding: 24px 28px 32px; }
  @media print { @page { margin: 12mm 10mm 14mm; size: A4 portrait; } .sheet { max-width: none; margin: 0; padding: 0; } .block { page-break-inside: avoid; } thead { display: table-header-group; } }
  .doc-header { display: flex; gap: 18px; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
  .doc-logo img { max-height: 52px; max-width: 180px; object-fit: contain; }
  .doc-company { flex: 1; text-align: right; font-size: 9pt; line-height: 1.4; color: var(--muted); white-space: pre-wrap; }
  h1 { font-size: 16pt; margin: 0 0 4px; text-align: center; }
  .sub { text-align: center; font-size: 9.5pt; color: var(--muted); margin: 0 0 16px; }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 9.5pt; }
  table.meta td { padding: 5px 7px; border: 1px solid var(--border); vertical-align: top; }
  table.meta td.k { width: 34%; font-weight: 600; color: var(--muted); background: #f8fafc; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .summary-box { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: #fafafa; }
  .summary-box h3 { margin: 0 0 6px; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  .summary-row { display: flex; justify-content: space-between; gap: 8px; font-size: 9.5pt; margin: 2px 0; }
  .summary-row strong { font-variant-numeric: tabular-nums; }
  table.items { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 8px; }
  table.items th, table.items td { border: 1px solid var(--border); padding: 4px 5px; text-align: left; vertical-align: top; }
  table.items th { background: #f1f5f9; font-weight: 700; }
  table.items td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .section-title { font-size: 10pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; margin: 14px 0 6px; }
  table.vat-sum { width: 100%; max-width: 420px; border-collapse: collapse; font-size: 9pt; margin-top: 6px; }
  table.vat-sum th, table.vat-sum td { border: 1px solid var(--border); padding: 5px 7px; }
  table.vat-sum th { background: #f1f5f9; text-align: left; }
  table.vat-sum td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); font-style: italic; }
`;

function fmtKc(n: number): string {
  return `${roundMoney2(n).toLocaleString("cs-CZ")} Kč`;
}

function exportDateLabel(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

export type JobExpensesVatBucket = {
  rate: number;
  net: number;
  vat: number;
  gross: number;
};

export function computeJobExpensesVatBuckets(rows: JobExpenseRow[]): JobExpensesVatBucket[] {
  const map = new Map<number, JobExpensesVatBucket>();
  for (const rate of VAT_RATE_OPTIONS) {
    map.set(rate, { rate, net: 0, vat: 0, gross: 0 });
  }
  for (const row of rows) {
    const r = resolveExpenseAmounts(row);
    const rate = r.vatRate;
    const bucket = map.get(rate) ?? { rate, net: 0, vat: 0, gross: 0 };
    bucket.net = roundMoney2(bucket.net + r.amountNet);
    bucket.vat = roundMoney2(bucket.vat + r.vatAmount);
    bucket.gross = roundMoney2(bucket.gross + r.amountGross);
    map.set(rate, bucket);
  }
  return VAT_RATE_OPTIONS.map((rate) => map.get(rate)!);
}

export function computeJobExpenseTotals(rows: JobExpenseRow[]) {
  let net = 0;
  let vat = 0;
  let gross = 0;
  for (const row of rows) {
    const r = resolveExpenseAmounts(row);
    net += r.amountNet;
    vat += r.vatAmount;
    gross += r.amountGross;
  }
  return {
    net: roundMoney2(net),
    vat: roundMoney2(vat),
    gross: roundMoney2(gross),
  };
}

export function buildJobExpensesReportPdfHtml(params: {
  companyDoc: Record<string, unknown> | null | undefined;
  jobName: string;
  jobNumber?: string | null;
  customerName?: string | null;
  realizationAddress?: string | null;
  jobBudget: JobBudgetBreakdown | null;
  expenses: JobExpenseRow[];
  exportScopeLabel?: string | null;
}): string {
  const company = handoverCompanyPdfMeta(params.companyDoc);
  const rows = sortJobExpensesForReport(params.expenses);
  const totals = computeJobExpenseTotals(rows);
  const buckets = computeJobExpensesVatBuckets(rows);
  const budget = params.jobBudget;
  const remainingNet =
    budget != null ? roundMoney2(budget.budgetNet - totals.net) : null;
  const remainingGross =
    budget != null ? roundMoney2(budget.budgetGross - totals.gross) : null;

  const logoBlock = company.logoUrl
    ? `<div class="doc-logo"><img src="${escapeHtml(company.logoUrl)}" alt="Logo"/></div>`
    : "";
  const companyBlock = `<div class="doc-company">${withLineBreaks(company.companyAddressText || company.contractorCompanyName)}</div>`;

  const metaRows = [
    ["Název zakázky", params.jobName || "—"],
    ["Číslo zakázky", params.jobNumber?.trim() || "—"],
    ["Zákazník", params.customerName?.trim() || "—"],
    ["Adresa realizace", params.realizationAddress?.trim() || "—"],
    ["Datum exportu", exportDateLabel()],
    ...(params.exportScopeLabel?.trim()
      ? [["Rozsah exportu", params.exportScopeLabel.trim()] as [string, string]]
      : []),
  ]
    .map(
      ([k, v]) =>
        `<tr><td class="k">${escapeHtml(k)}</td><td>${v === "—" ? "—" : withLineBreaks(v)}</td></tr>`
    )
    .join("");

  const summaryBox = (title: string, lines: { label: string; value: string }[]) =>
    `<div class="summary-box block"><h3>${escapeHtml(title)}</h3>${lines
      .map(
        (l) =>
          `<div class="summary-row"><span>${escapeHtml(l.label)}</span><strong>${escapeHtml(l.value)}</strong></div>`
      )
      .join("")}</div>`;

  const budgetLines = budget
    ? [
        { label: "Rozpočet bez DPH", value: fmtKc(budget.budgetNet) },
        { label: "Rozpočet s DPH", value: fmtKc(budget.budgetGross) },
      ]
    : [
        { label: "Rozpočet bez DPH", value: "—" },
        { label: "Rozpočet s DPH", value: "—" },
      ];

  const costLines = [
    { label: "Náklady bez DPH", value: fmtKc(totals.net) },
    { label: "Náklady s DPH", value: fmtKc(totals.gross) },
  ];

  const remainLines = [
    {
      label: "Zbývá bez DPH",
      value: remainingNet != null ? fmtKc(remainingNet) : "—",
    },
    {
      label: "Zbývá s DPH",
      value: remainingGross != null ? fmtKc(remainingGross) : "—",
    },
  ];

  const itemRows =
    rows.length === 0
      ? `<tr><td colspan="10" class="muted">Žádné náklady k zobrazení.</td></tr>`
      : rows
          .map((row) => {
            const r = resolveExpenseAmounts(row);
            const supplier = jobExpenseSupplierLabel(row);
            const docLink = jobExpenseDocumentLinkLabel(row);
            const description = jobExpenseDescriptionLabel(row);
            const rawNote = String(row.note ?? "").trim();
            const noteCol =
              rawNote && rawNote !== description && rawNote !== "—" ? rawNote : "—";
            return `<tr>
              <td>${escapeHtml(jobExpenseDateLabelCs(row.date))}</td>
              <td>${escapeHtml(jobExpenseSourceTypeLabel(row))}</td>
              <td>${escapeHtml(description)}</td>
              <td>${supplier ? escapeHtml(supplier) : "—"}</td>
              <td class="num">${fmtKc(r.amountNet)}</td>
              <td class="num">${r.vatRate} %</td>
              <td class="num">${fmtKc(r.vatAmount)}</td>
              <td class="num">${fmtKc(r.amountGross)}</td>
              <td>${noteCol === "—" ? "—" : escapeHtml(noteCol)}</td>
              <td>${docLink ? escapeHtml(docLink) : "—"}</td>
            </tr>`;
          })
          .join("");

  const vatRows = buckets
    .map(
      (b) => `<tr>
        <td>DPH ${b.rate} %</td>
        <td class="num">${fmtKc(b.net)}</td>
        <td class="num">${fmtKc(b.vat)}</td>
        <td class="num">${fmtKc(b.gross)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/><style>${REPORT_CSS}</style></head><body>
<div class="sheet">
  <div class="doc-header block">${logoBlock}${companyBlock}</div>
  <h1>Výpočet nákladů</h1>
  <p class="sub">Položkový rozpočet zakázky</p>
  <table class="meta">${metaRows}</table>

  <div class="summary-grid block">
    ${summaryBox("Rozpočet zakázky", budgetLines)}
    ${summaryBox("Náklady celkem", costLines)}
    ${summaryBox("Zbývá", remainLines)}
  </div>

  <div class="block">
    <div class="section-title">Položkový rozpis nákladů</div>
    <table class="items">
      <thead><tr>
        <th>Datum</th><th>Typ / zdroj</th><th>Název / popis</th><th>Dodavatel / zaměstnanec</th>
        <th>Bez DPH</th><th>DPH %</th><th>DPH</th><th>S DPH</th><th>Poznámka</th><th>Doklad</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>

  <div class="block">
    <div class="section-title">Souhrn DPH (náklady)</div>
    <table class="vat-sum">
      <thead><tr><th>Sazba</th><th>Základ bez DPH</th><th>DPH</th><th>Celkem s DPH</th></tr></thead>
      <tbody>
        ${vatRows}
        <tr>
          <th>Celkem</th>
          <td class="num">${fmtKc(totals.net)}</td>
          <td class="num">${fmtKc(totals.vat)}</td>
          <td class="num">${fmtKc(totals.gross)}</td>
        </tr>
      </tbody>
    </table>
  </div>
</div></body></html>`;
}
