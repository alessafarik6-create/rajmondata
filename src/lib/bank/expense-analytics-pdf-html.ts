import { escapeHtml } from "@/lib/work-contract-print-html";
import type { ExpenseAnalyticsSummary } from "@/lib/bank/expense-analytics-aggregate";
import type { ExpenseAnalyticsRow } from "@/lib/bank/expense-analytics-aggregate";

export function buildBankExpenseAnalyticsPdfHtml(input: {
  companyName: string;
  logoUrl?: string | null;
  periodLabel: string;
  summary: ExpenseAnalyticsSummary;
  monthly: { month: string; marketing: number; total: number }[];
  rows: ExpenseAnalyticsRow[];
}): string {
  const rowsHtml = input.rows
    .slice(0, 500)
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.bookingDate)}</td>
      <td>${escapeHtml(String(r.counterpartyName ?? "—"))}</td>
      <td>${escapeHtml(String(r.message ?? "—"))}</td>
      <td class="num">${r.expenseAbsCzk.toLocaleString("cs-CZ")} ${escapeHtml(r.currency)}</td>
      <td>${escapeHtml(r.effectiveCategoryLabel)}</td>
    </tr>`
    )
    .join("");

  const monthlyHtml = input.monthly
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.month)}</td><td class="num">${m.marketing.toLocaleString("cs-CZ")} Kč</td><td class="num">${m.total.toLocaleString("cs-CZ")} Kč</td></tr>`
    )
    .join("");

  const logo =
    input.logoUrl?.trim() ?
      `<img src="${escapeHtml(input.logoUrl.trim())}" alt="Logo" style="max-height:48px"/>`
    : "";

  return `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"/>
<style>
body{font-family:system-ui,sans-serif;font-size:10pt;color:#0f172a;margin:0;padding:24px}
h1{font-size:18pt;margin:0 0 8px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
th{background:#f1f5f9}
.num{text-align:right;font-variant-numeric:tabular-nums}
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
.kpi div{border:1px solid #e2e8f0;padding:10px;border-radius:8px}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
  <div><h1>Analýza výdajů — marketing</h1>
  <p>${escapeHtml(input.companyName)} · ${escapeHtml(input.periodLabel)}</p></div>
  <div>${logo}</div>
</div>
<div class="kpi">
  <div><strong>Marketing celkem</strong><br/>${input.summary.totalMarketing.toLocaleString("cs-CZ")} Kč</div>
  <div><strong>Google Ads</strong><br/>${input.summary.googleAds.toLocaleString("cs-CZ")} Kč</div>
  <div><strong>Meta Ads</strong><br/>${input.summary.metaAds.toLocaleString("cs-CZ")} Kč</div>
</div>
<h2>Měsíční přehled</h2>
<table><thead><tr><th>Měsíc</th><th>Marketing</th><th>Výdaje celkem</th></tr></thead><tbody>${monthlyHtml}</tbody></table>
<h2>Platby</h2>
<table><thead><tr><th>Datum</th><th>Dodavatel</th><th>Popis</th><th>Částka</th><th>Kategorie</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<p><strong>Celkem odchozí:</strong> ${input.summary.totalOutgoing.toLocaleString("cs-CZ")} Kč · <strong>Čisté:</strong> ${input.summary.netExpenses.toLocaleString("cs-CZ")} Kč</p>
<p style="font-size:8pt;color:#64748b">${escapeHtml(input.summary.currencyNote)}</p>
</body></html>`;
}
