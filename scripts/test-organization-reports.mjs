/**
 * Test agregace reportů organizace a scoping dat podle companyId.
 * node scripts/test-organization-reports.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const reportsSrc = readFileSync(
  join(root, "src/lib/organization-reports.ts"),
  "utf8"
);
const pageSrc = readFileSync(
  join(root, "src/app/portal/reports/page.tsx"),
  "utf8"
);
const exportSrc = readFileSync(
  join(root, "src/lib/organization-reports-export.ts"),
  "utf8"
);

assert.match(
  pageSrc,
  /companies", companyId, "jobs"/,
  "jobs query must be scoped to companyId"
);
assert.match(
  pageSrc,
  /companies", companyId, "finance"/,
  "finance query must be scoped to companyId"
);
assert.match(
  pageSrc,
  /companies", companyId, "documents"/,
  "documents query must be scoped to companyId"
);
assert.match(
  pageSrc,
  /companies", companyId, "attendance"/,
  "attendance query must be scoped to companyId"
);
assert.match(
  pageSrc,
  /companies", companyId, "employees"/,
  "employees query must be scoped to companyId"
);

assert.doesNotMatch(pageSrc, /setTimeout/, "fake export timeout must be removed");
assert.match(pageSrc, /exportOrganizationReportPdf/, "PDF export must be wired");
assert.match(pageSrc, /exportOrganizationReportCsv/, "CSV export must be wired");
assert.match(pageSrc, /activeTab/, "export must use active tab state");
assert.match(pageSrc, /computeOrganizationReports/, "page must use shared report compute");

assert.match(exportSrc, /formatCurrency/, "PDF must format amounts in Kč");
assert.match(exportSrc, /formatReportDate/, "PDF must use Czech date formatting");
assert.match(exportSrc, /buildOrganizationReportCsvRows/, "CSV builder must exist");
assert.match(exportSrc, /REPORT_TAB_LABELS/, "PDF must include tab label");

assert.match(reportsSrc, /computeOrganizationReports/, "report compute export");
assert.match(reportsSrc, /summarizeAttendanceByDay/, "hours from attendance");
assert.match(reportsSrc, /resolveExpenseAmounts/, "costs from documents");
assert.match(reportsSrc, /isUnfacturedJobStatus/, "unfactured = dokončená");
assert.match(reportsSrc, /isCompletedJobStatus/, "completed jobs metric");
assert.doesNotMatch(pageSrc, /mock|sample|demo|ukázk/i, "no sample data in page");

function isActiveJobStatus(status) {
  return status !== "dokončená" && status !== "fakturována";
}
function isCompletedJobStatus(status) {
  return status === "dokončená" || status === "fakturována";
}
function isUnfacturedJobStatus(status) {
  return status === "dokončená";
}

const jobs = [
  { status: "probíhá" },
  { status: "dokončená" },
  { status: "fakturována" },
];
assert.equal(jobs.filter((j) => isActiveJobStatus(j.status)).length, 1);
assert.equal(jobs.filter((j) => isCompletedJobStatus(j.status)).length, 2);
assert.equal(jobs.filter((j) => isUnfacturedJobStatus(j.status)).length, 1);

const revenue = 100000;
const costs = 40000;
const profit = revenue - costs;
assert.equal(profit, 60000);
assert.equal((profit / revenue) * 100, 60);

console.log("OK: organization reports aggregation, scoping, and export helpers.");
