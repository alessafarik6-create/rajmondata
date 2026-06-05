import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPdf = readFileSync(join(root, "src/lib/job-expenses-report-pdf.ts"), "utf8");
const display = readFileSync(join(root, "src/lib/job-expense-display.ts"), "utf8");
const section = readFileSync(join(root, "src/components/jobs/job-expenses-section.tsx"), "utf8");
const previewDlg = readFileSync(
  join(root, "src/components/jobs/job-expenses-pdf-preview-dialog.tsx"),
  "utf8"
);
const jobDetail = readFileSync(
  join(root, "src/app/portal/jobs/job-detail-page-content.tsx"),
  "utf8"
);

assert.match(reportPdf, /Výpočet nákladů/, "report title");
assert.match(reportPdf, /Položkový rozpočet zakázky/, "report subtitle");
assert.match(reportPdf, /doc-logo/, "organization logo");
assert.match(reportPdf, /Název zakázky/, "job name meta");
assert.match(reportPdf, /Číslo zakázky/, "job number meta");
assert.match(reportPdf, /Zákazník/, "customer meta");
assert.match(reportPdf, /Adresa realizace/, "realization address");
assert.match(reportPdf, /Datum exportu/, "export date");
assert.match(reportPdf, /Rozpočet bez DPH/, "budget net");
assert.match(reportPdf, /Rozpočet s DPH/, "budget gross");
assert.match(reportPdf, /Náklady bez DPH/, "expenses net");
assert.match(reportPdf, /Náklady s DPH/, "expenses gross");
assert.match(reportPdf, /Zbývá bez DPH/, "remaining net");
assert.match(reportPdf, /Zbývá s DPH/, "remaining gross");
assert.match(reportPdf, /Položkový rozpis nákladů/, "line items section");
assert.match(reportPdf, /Souhrn DPH/, "vat summary");
assert.match(reportPdf, /computeJobExpensesVatBuckets/, "vat bucket helper");
assert.match(reportPdf, /VAT_RATE_OPTIONS/, "all vat rates 0\/12\/21");
assert.match(reportPdf, /DPH \$\{b\.rate\} %/, "vat rate rows in summary");
assert.match(reportPdf, /Žádné náklady k zobrazení/, "empty expenses message");

assert.match(display, /jobExpenseSourceTypeLabel/, "source labels");
assert.match(display, /jobExpenseMatchesSourceFilter/, "source filter");
assert.match(display, /COMPANY_DOCUMENT_EXPENSE_SOURCE/, "document source");
assert.match(display, /DAILY_WORK_REPORT_JOB_EXPENSE_SOURCE/, "work report source");

assert.match(section, /Náhled nákladů/, "preview button");
assert.match(section, /Export nákladů do PDF/, "export button");
assert.match(section, /Tisk nákladů/, "print button");
assert.match(section, /JobExpensesPdfPreviewDialog/, "preview dialog");
assert.match(section, /printInvoiceHtmlDocument/, "print uses same HTML");
assert.match(section, /Pouze filtrované/, "filtered export scope");
assert.match(section, /Všechny náklady/, "all export scope");
assert.match(section, /Export nákladů zakázky/, "activity log label");

assert.match(previewDlg, /PortalInvoicePreviewDialog/, "reuses invoice preview");
assert.match(previewDlg, /downloadJobExpensesReportPdf/, "custom PDF download");

assert.match(jobDetail, /jobExpensesReportMeta/, "job detail passes report meta");
assert.match(jobDetail, /companyDoc=/, "company doc prop");
assert.match(jobDetail, /realizationAddress=/, "realization address prop");

console.log("OK: test-job-expenses-report");
