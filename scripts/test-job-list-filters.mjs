import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const statusLib = read("src/lib/job-status.ts");
const filtersLib = read("src/lib/job-list-filters.ts");
const page = read("src/app/portal/jobs/page.tsx");
const controls = read("src/components/jobs/jobs-list-controls.tsx");
const view = read("src/components/jobs/jobs-list-view.tsx");

for (const token of [
  "JOB_STATUS_FILTER_OPTIONS",
  "pozastavená",
  "zrušená",
  "parseJobStatusFilterParam",
  "DEFAULT_JOB_STATUS_FILTER",
]) {
  if (!statusLib.includes(token)) throw new Error(`job-status.ts missing: ${token}`);
}

for (const token of [
  "applyJobListFilters",
  "computeJobListSummary",
  "sortJobs",
  "buildJobsListQueryString",
]) {
  if (!filtersLib.includes(token)) throw new Error(`job-list-filters.ts missing: ${token}`);
}

for (const token of [
  "JobsListControls",
  "JobsListView",
  "syncJobsListUrl",
  "displayJobs",
  'params.set("status"',
]) {
  if (!page.includes(token)) throw new Error(`jobs page missing: ${token}`);
}

if (!controls.includes("Aktivní zakázky")) {
  throw new Error("summary cards missing");
}
if (!view.includes("Poslední aktivita")) {
  throw new Error("desktop table missing last activity column");
}
if (!view.includes("dark")) {
  throw new Error("mobile card view missing");
}

console.log("test-job-list-filters.mjs: OK");
