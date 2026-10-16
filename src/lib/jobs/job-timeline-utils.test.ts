import assert from "node:assert";
import {
  isStrongDayTick,
  jobDaysUntilLabel,
  shouldShowDayNumber,
  shouldShowDayTick,
  urgencyDotClass,
} from "./job-timeline-utils";

assert.strictEqual(shouldShowDayTick(0, "month"), true);
assert.strictEqual(shouldShowDayTick(3, "year"), false);
assert.strictEqual(shouldShowDayTick(7, "year"), true);

assert.strictEqual(shouldShowDayNumber(0, "week", 48), true);
assert.strictEqual(shouldShowDayNumber(3, "quarter", 4), false);
assert.strictEqual(shouldShowDayNumber(5, "quarter", 4), true);

assert.strictEqual(isStrongDayTick(4), false);
assert.strictEqual(isStrongDayTick(5), true);

assert.ok(urgencyDotClass("overdue").includes("red"));
assert.ok(urgencyDotClass("soon").includes("orange"));
assert.ok(urgencyDotClass("future").includes("emerald"));
assert.ok(urgencyDotClass("done").includes("slate"));

const now = new Date("2026-10-16T12:00:00");
assert.match(
  jobDaysUntilLabel({ endDate: "2026-10-14" } as import("@/lib/job-list-filters").JobListRow, now),
  /po termínu/i
);
assert.match(
  jobDaysUntilLabel({ endDate: "2026-10-16" } as import("@/lib/job-list-filters").JobListRow, now),
  /dnes/i
);
assert.match(
  jobDaysUntilLabel({ endDate: "2026-10-19" } as import("@/lib/job-list-filters").JobListRow, now),
  /3/
);

console.log("job-timeline-utils.test.ts: OK");
