import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const jobMediaSection = read("src/components/jobs/job-media-section.tsx");
if (jobMediaSection.includes("CustomerMediaAnnotationViewer")) {
  failures.push("job-media-section.tsx still references CustomerMediaAnnotationViewer");
}

const customerJobView = read("src/components/customer/customer-job-view.tsx");
if (!customerJobView.includes("buildCustomerJobMediaAnnotateHref")) {
  failures.push("customer-job-view.tsx missing customer annotate navigation");
}
if (customerJobView.includes("onAnnotatePhoto={() => {}}")) {
  failures.push("customer-job-view.tsx still has empty onAnnotatePhoto");
}

const employeePage = read("src/app/portal/employee/jobs/[jobId]/page.tsx");
if (!employeePage.includes("buildEmployeeJobMediaAnnotateHref")) {
  failures.push("employee job page missing shared annotate route helper");
}

const customerAnnotatePage = read("src/app/portal/customer/jobs/[jobId]/annotate/page.tsx");
if (!customerAnnotatePage.includes("customerAnnotationShell")) {
  failures.push("customer annotate page missing customerAnnotationShell");
}

const jobDetail = read("src/app/portal/jobs/job-detail-page-content.tsx");
if (!jobDetail.includes("isStandaloneMediaAnnotationRoute")) {
  failures.push("job-detail-page-content.tsx missing media annotation shell route");
}
if (!jobDetail.includes("UnifiedAnnotationEditor")) {
  failures.push("job-detail-page-content.tsx missing UnifiedAnnotationEditor");
}

const annotateRoute = read("src/lib/job-media-annotate-route.ts");
if (!annotateRoute.includes("buildCustomerJobMediaAnnotateHref")) {
  failures.push("job-media-annotate-route.ts incomplete");
}

if (failures.length) {
  console.error("FAIL job media annotate unification:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

console.log("OK job media annotate unification checks passed");
