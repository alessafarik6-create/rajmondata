/**
 * HTML report „Položkový rozpočet prací“ (A4).
 */

import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { escapeHtml, withLineBreaks } from "@/lib/work-contract-print-html";
import { computeWorkBudgetSummary } from "@/lib/work-budget-calculations";
import type { JobWorkBudgetItemDoc } from "@/lib/work-budget-types";
import { roundMoney2, VAT_RATE_OPTIONS } from "@/lib/vat-calculations";

const REPORT_CSS = `
  :root { --ink: #0a0a0a; --muted: #404040; --border: #bdbdbd; --done: #ecfdf5; }
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
  table.items { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 8px; }
  table.items th, table.items td { border: 1px solid var(--border); padding: 4px 5px; text-align: left; vertical-align: top; }
  table.items th { background: #f1f5f9; font-weight: 700; }
  table.items td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.items tr.done td { background: var(--done); }
  .section-title { font-size: 10pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; margin: 14px 0 6px; }
  table.vat-sum { width: 100%; max-width: 420px; border-collapse: collapse; font-size: 9pt; margin-top: 6px; }
  table.vat-sum th, table.vat-sum td { border: 1px solid var(--border); padding: 5px 7px; }
  table.vat-sum th { background: #f1f5f9; text-align: left; }
  table.vat-sum td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge-done { display: inline-block; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #047857; background: #d1fae5; border-radius: 3px; padding: 1px 4px; }
  .badge-invoiced { display: inline-block; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #1d4ed8; background: #dbeafe; border-radius: 3px; padding: 1px 4px; margin-left: 4px; }
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

function doneAtLabel(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

export type WorkBudgetVatBucket = {
  rate: number;
  net: number;
  vat: number;
  gross: number;
};

export function computeWorkBudgetVatBuckets(rows: JobWorkBudgetItemDoc[]): WorkBudgetVatBucket[] {
  const map = new Map<number, WorkBudgetVatBucket>();
  for (const rate of VAT_RATE_OPTIONS) {
    map.set(rate, { rate, net: 0, vat: 0, gross: 0 });
  }
  for (const row of rows) {
    const rate = row.vatRate;
    const bucket = map.get(rate) ?? { rate, net: 0, vat: 0, gross: 0 };
    bucket.net = roundMoney2(bucket.net + row.amountNet);
    bucket.vat = roundMoney2(bucket.vat + row.vatAmount);
    bucket.gross = roundMoney2(bucket.gross + row.amountGross);
    map.set(rate, bucket);
  }
  return VAT_RATE_OPTIONS.map((rate) => map.get(rate)!);
}

export function buildWorkBudgetReportPdfHtml(params: {
  companyDoc: Record<string, unknown> | null | undefined;
  jobName: string;
  jobNumber?: string | null;
  customerName?: string | null;
  realizationAddress?: string | null;
  items: JobWorkBudgetItemDoc[];
}): string {
  const company = handoverCompanyPdfMeta(params.companyDoc);
  const summary = computeWorkBudgetSummary(params.items);
  const vatBuckets = computeWorkBudgetVatBuckets(params.items);
  const exportDate = exportDateLabel();

  const logoBlock = company.logoUrl
    ? `<div class="doc-logo"><img src="${escapeHtml(company.logoUrl)}" alt="" /></div>`
    : "";

  const itemRows =
    params.items.length === 0
      ? `<tr><td colspan="11" class="muted">Žádné položky rozpočtu.</td></tr>`
      : params.items
          .map((row) => {
            const statusBadges = [
              row.done ? `<span class="badge-done">Provedeno</span>` : "",
              row.invoiced ? `<span class="badge-invoiced">Vyfakturováno</span>` : "",
            ]
              .filter(Boolean)
              .join("");
            const title = escapeHtml(row.title || "—");
            const desc = row.description
              ? `<div class="muted">${withLineBreaks(escapeHtml(row.description))}</div>`
              : "";
            const note = row.note
              ? `<div class="muted">Pozn.: ${withLineBreaks(escapeHtml(row.note))}</div>`
              : "";
            return `<tr class="${row.done ? "done" : ""}">
              <td>${title}${desc}${note}${statusBadges ? `<div style="margin-top:3px">${statusBadges}</div>` : ""}</td>
              <td class="num">${row.quantity.toLocaleString("cs-CZ")}</td>
              <td>${escapeHtml(row.unit)}</td>
              <td class="num">${fmtKc(row.unitPriceNet)}</td>
              <td class="num">${row.vatRate} %</td>
              <td class="num">${fmtKc(row.amountNet)}</td>
              <td class="num">${fmtKc(row.vatAmount)}</td>
              <td class="num">${fmtKc(row.amountGross)}</td>
              <td>${row.done ? "Ano" : "Ne"}</td>
              <td>${escapeHtml(doneAtLabel(row.doneAt))}</td>
            </tr>`;
          })
          .join("");

  const vatRows = vatBuckets
    .filter((b) => b.net > 0 || b.vat > 0)
    .map(
      (b) => `<tr>
        <td>DPH ${b.rate} %</td>
        <td class="num">${fmtKc(b.net)}</td>
        <td class="num">${fmtKc(b.vat)}</td>
        <td class="num">${fmtKc(b.gross)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Položkový rozpočet prací</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="sheet">
    <div class="doc-header block">
      ${logoBlock}
      <div class="doc-company">${withLineBreaks(escapeHtml(company.companyAddressText))}</div>
    </div>
    <h1>Položkový rozpočet prací</h1>
    <p class="sub">Vyúčtování prací u zakázky</p>

    <table class="meta block">
      <tr><td class="k">Název zakázky</td><td>${escapeHtml(params.jobName || "—")}</td></tr>
      ${params.jobNumber ? `<tr><td class="k">Číslo zakázky</td><td>${escapeHtml(params.jobNumber)}</td></tr>` : ""}
      ${params.customerName ? `<tr><td class="k">Zákazník</td><td>${escapeHtml(params.customerName)}</td></tr>` : ""}
      ${params.realizationAddress ? `<tr><td class="k">Adresa realizace</td><td>${withLineBreaks(escapeHtml(params.realizationAddress))}</td></tr>` : ""}
      <tr><td class="k">Datum exportu</td><td>${escapeHtml(exportDate)}</td></tr>
    </table>

    <div class="summary-grid block">
      <div class="summary-box">
        <h3>Rozpočet celkem</h3>
        <div class="summary-row"><span>bez DPH</span><strong>${fmtKc(summary.totalNet)}</strong></div>
        <div class="summary-row"><span>s DPH</span><strong>${fmtKc(summary.totalGross)}</strong></div>
      </div>
      <div class="summary-box">
        <h3>Provedeno</h3>
        <div class="summary-row"><span>bez DPH</span><strong>${fmtKc(summary.doneNet)}</strong></div>
        <div class="summary-row"><span>s DPH</span><strong>${fmtKc(summary.doneGross)}</strong></div>
      </div>
      <div class="summary-box">
        <h3>Zbývá</h3>
        <div class="summary-row"><span>bez DPH</span><strong>${fmtKc(summary.remainingNet)}</strong></div>
        <div class="summary-row"><span>s DPH</span><strong>${fmtKc(summary.remainingGross)}</strong></div>
      </div>
      <div class="summary-box">
        <h3>K fakturaci</h3>
        <div class="summary-row"><span>bez DPH</span><strong>${fmtKc(summary.billableNet)}</strong></div>
        <div class="summary-row"><span>s DPH</span><strong>${fmtKc(summary.billableGross)}</strong></div>
      </div>
    </div>

    <div class="section-title">Položkový rozpočet</div>
    <table class="items block">
      <thead>
        <tr>
          <th>Název / popis</th>
          <th>Množství</th>
          <th>Jedn.</th>
          <th>Cena/j. bez DPH</th>
          <th>DPH</th>
          <th>Celkem bez DPH</th>
          <th>DPH</th>
          <th>Celkem s DPH</th>
          <th>Provedeno</th>
          <th>Datum provedení</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="section-title">Souhrn DPH</div>
    <table class="vat-sum block">
      <thead>
        <tr><th>Sazba</th><th>Základ</th><th>DPH</th><th>Celkem</th></tr>
      </thead>
      <tbody>
        ${vatRows || `<tr><td colspan="4" class="muted">—</td></tr>`}
        <tr>
          <td><strong>Celkem</strong></td>
          <td class="num"><strong>${fmtKc(summary.totalNet)}</strong></td>
          <td class="num"><strong>${fmtKc(roundMoney2(summary.totalGross - summary.totalNet))}</strong></td>
          <td class="num"><strong>${fmtKc(summary.totalGross)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
