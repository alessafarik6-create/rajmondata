import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const types = readFileSync(join(root, "src/lib/work-budget-types.ts"), "utf8");
const calc = readFileSync(join(root, "src/lib/work-budget-calculations.ts"), "utf8");
const templates = readFileSync(join(root, "src/lib/work-budget-templates-firestore.ts"), "utf8");
const reportPdf = readFileSync(join(root, "src/lib/work-budget-report-pdf.ts"), "utf8");
const invoice = readFileSync(join(root, "src/lib/work-budget-invoice.ts"), "utf8");
const section = readFileSync(join(root, "src/components/jobs/job-work-budget-section.tsx"), "utf8");
const previewDlg = readFileSync(
  join(root, "src/components/jobs/job-work-budget-pdf-preview-dialog.tsx"),
  "utf8"
);
const jobDetail = readFileSync(
  join(root, "src/app/portal/jobs/job-detail-page-content.tsx"),
  "utf8"
);
const employeeJob = readFileSync(
  join(root, "src/app/portal/employee/jobs/[jobId]/page.tsx"),
  "utf8"
);
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(types, /workBudgetItems/, "items collection");
assert.match(types, /workBudgetTemplates/, "templates collection");
assert.match(types, /computeWorkBudgetLineAmounts/, "line amounts");
assert.match(types, /invoiced/, "invoiced flag");
assert.match(types, /doneAt/, "done timestamp");

assert.match(calc, /computeWorkBudgetSummary/, "summary helper");
assert.match(calc, /billableNet/, "billable totals");
assert.match(calc, /remainingNet/, "remaining totals");

assert.match(templates, /WORK_BUDGET_TEMPLATES_COLLECTION/, "template collection constant");
assert.match(templates, /fetchWorkBudgetTemplates/, "fetch templates");
assert.match(templates, /createWorkBudgetTemplate/, "create template");

assert.match(reportPdf, /Položkový rozpočet prací/, "pdf title");
assert.match(reportPdf, /doc-logo/, "organization logo");
assert.match(reportPdf, /Název zakázky/, "job name");
assert.match(reportPdf, /Zákazník/, "customer");
assert.match(reportPdf, /Adresa realizace/, "realization address");
assert.match(reportPdf, /Datum exportu/, "export date");
assert.match(reportPdf, /badge-done/, "done marker");
assert.match(reportPdf, /Souhrn DPH/, "vat summary");
assert.match(reportPdf, /Rozpočet celkem/, "budget totals");
assert.match(reportPdf, /Provedeno/, "done summary");
assert.match(reportPdf, /Zbývá/, "remaining summary");

assert.match(invoice, /billableWorkBudgetItems/, "billable filter");
assert.match(invoice, /createInvoiceFromWorkBudgetItems/, "invoice creator");
assert.match(invoice, /done && !row.invoiced/, "no duplicate invoicing");
assert.match(invoice, /syncPortalInvoiceToDocuments/, "documents sync");
assert.match(invoice, /invoiced: true/, "mark invoiced after create");
assert.match(invoice, /priceType: "net"/, "net unit prices");

assert.match(section, /Položkový rozpočet prací/, "section title");
assert.match(section, /Nový položkový rozpočet/, "new budget button");
assert.match(section, /Vybrat šablonu/, "pick template");
assert.match(section, /Uložit jako šablonu/, "save template");
assert.match(section, /Náhled PDF/, "pdf preview");
assert.match(section, /Export PDF/, "pdf export");
assert.match(section, /Vygenerovat fakturu z hotových položek/, "invoice button");
assert.match(section, /Provedeno/, "done checkbox column");
assert.match(section, /Vyfakturováno/, "invoiced badge");
assert.match(section, /Rozpočet bez DPH/, "summary net");
assert.match(section, /Zbývá s DPH/, "summary remaining gross");

assert.match(previewDlg, /PortalInvoicePreviewDialog/, "preview dialog reuse");
assert.match(previewDlg, /downloadJobExpensesReportPdf/, "pdf endpoint");

assert.match(jobDetail, /JobWorkBudgetSection/, "job detail integration");
assert.match(jobDetail, /job-work-budget-heading/, "section aria");

assert.match(employeeJob, /canViewBudgets/, "employee permission gate");
assert.match(employeeJob, /JobWorkBudgetSection/, "employee section");

assert.match(rules, /workBudgetItems/, "firestore items rules");
assert.match(rules, /workBudgetTemplates/, "firestore template rules");
assert.match(rules, /jobWorkBudgetReadAccess/, "read access helper");
assert.match(rules, /jobMemberCanViewBudgets/, "employee budget permission");

console.log("OK: test-work-budget");
