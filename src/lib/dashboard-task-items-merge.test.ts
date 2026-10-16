import {
  dedupeDashboardTasksByKey,
  selectMyOpenDashboardTasks,
  type DashboardTaskItem,
} from "@/lib/dashboard-task-items-merge";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base: DashboardTaskItem = {
  key: "org-1",
  source: "organization",
  taskId: "1",
  title: "A",
  note: "",
  priority: "medium",
  orgStatus: "open",
  assignedTo: null,
  assignedMode: "all",
};

const dup = { ...base, key: "org-1", title: "Duplicitní název" };
const deduped = dedupeDashboardTasksByKey([base, dup, { ...base, key: "org-2", taskId: "2" }]);
assert(deduped.length === 2, "dedupe by key");
assert(deduped[0]!.title === "A", "first wins");

const mine = selectMyOpenDashboardTasks(
  [base, { ...base, key: "org-3", taskId: "3", assignedMode: "single", assignedTo: "emp:x" }],
  "user-1",
  "e-other",
  "2026-10-16"
);
assert(mine.length === 1 && mine[0]!.key === "org-1", "only all-task for viewer");

console.log("ok dashboard-task-items-merge");
