import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const lib = read("src/lib/job-detail-collapsible-sections.ts");
const panel = read("src/components/jobs/job-detail-collapsible-sections-panel.tsx");
const section = read("src/components/jobs/job-detail-collapsible-section.tsx");
const page = read("src/app/portal/jobs/job-detail-page-content.tsx");

const requiredIds = [
  "meeting_records",
  "customer_tasks",
  "cutting_plan",
  "financial",
  "document_email",
  "material_orders",
  "production_team",
  "contract_deposit",
  "expenses",
  "product_catalogs",
];

for (const id of requiredIds) {
  if (!lib.includes(`"${id}"`)) throw new Error(`missing section id in lib: ${id}`);
}

if (!lib.includes("localStorage")) throw new Error("lib must use localStorage");
if (!panel.includes("moveSectionInOrder")) throw new Error("panel must reorder sections");
if (!section.includes("CollapsibleTrigger")) throw new Error("section must use collapsible trigger");
if (!page.includes("JobDetailCollapsibleSectionsPanel")) {
  throw new Error("job detail page must render collapsible panel");
}
if (page.includes('aria-labelledby="job-expenses-heading"')) {
  throw new Error("standalone expenses section should be removed from page");
}

console.log("test-job-detail-collapsible-sections.mjs: OK");
